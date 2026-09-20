import worksheets from "./worksheets.json";
import { OcrRuntime } from "../../../app/_lib/local-ai/models/ocr-runtime";
import { ensureVerifiedStudyAssets } from "./verified-assets";
import type { HostToWorkerMessage, WorkerToHostMessage } from "../../../app/_lib/local-ai/worker-protocol";
import type { NerLineEvidence } from "../../../app/_lib/local-ai/models/ner-lines";
import { inspectStudyImage, resizedStudyDimensions } from "../../../app/_lib/local-ai/models/study-image";
import { PHASE2_LIMITS } from "../../../app/_lib/local-ai/phase2-limits.generated";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sheet = byId<HTMLSelectElement>("sheet");
const observer = byId<HTMLSelectElement>("observer");
const canvas = byId<HTMLCanvasElement>("worksheet");
const rows = byId("rows");
const review = byId("review");
const status = byId("status");
const ocrButton = byId<HTMLButtonElement>("ocr");
const manualButton = byId<HTMLButtonElement>("manual");
let generation = 0;
let controller: AbortController | null = null;
let ocr: OcrRuntime | null = null;
let ner: Worker | null = null;
let started = 0;
let mode: "ocr" | "manual" = "manual";
let stages: Record<string, number> = {};
let allowedWords: Set<string> = new Set();
const records: object[] = [];

worksheets.forEach(item => sheet.add(new Option(`${item.id} · ${item.topic} · ${item.words.length} 词`, item.id)));
function current() { return worksheets.find(item => item.id === sheet.value)!; }
function draw() {
  canvas.width = 2400; canvas.height = 3000;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#162033"; context.font = "92px Arial";
  current().words.forEach((word, i) => {
    const columns = current().layout === "columns";
    const x = columns ? 220 + (i % 2) * 1050 : 260;
    const y = columns ? 340 + Math.floor(i / 2) * 460 : 220 + i * 260;
    context.fillText(word, x, y);
  });
}
function lock(value: boolean) {
  sheet.disabled = value; observer.disabled = value;
  ocrButton.disabled = value; manualButton.disabled = value;
}
function clearCaptured() {
  generation++; controller?.abort(); controller = null;
  ner?.terminate(); ner = null;
  const active = ocr; ocr = null; void active?.dispose();
  rows.replaceChildren(); review.hidden = true; allowedWords.clear(); stages = {};
  canvas.width = 0; canvas.height = 0;
  lock(false);
}
function message(text: string) { status.textContent = text; }
function addRow(term: string, confidence?: number) {
  const row = document.createElement("div"); row.className = "row";
  const check = document.createElement("input"); check.type = "checkbox";
  check.checked = confidence === undefined || confidence >= 90;
  check.setAttribute("aria-label", "选择此词");
  const input = document.createElement("input"); input.type = "text"; input.value = term;
  input.maxLength = 100; input.setAttribute("aria-label", `单词 ${rows.children.length + 1}`);
  const badge = document.createElement("span"); badge.className = "badge";
  badge.textContent = confidence === undefined ? "手动输入" : `OCR ${Math.round(confidence)} · 待校对`;
  const discard = document.createElement("button"); discard.textContent = "丢弃";
  discard.onclick = () => { row.remove(); byId("confirm").focus(); };
  row.append(check, input, badge, discard); rows.append(row);
}
function showReview() { review.hidden = false; byId("review-title").focus(); }
function request(worker: Worker, body: HostToWorkerMessage, expected: WorkerToHostMessage["type"], signal: AbortSignal) {
  return new Promise<WorkerToHostMessage>((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Cancelled")); return; }
    const timeout = setTimeout(fail, 60_000);
    function cleanup() {
      clearTimeout(timeout); worker.removeEventListener("message", receive);
      worker.removeEventListener("error", fail); worker.removeEventListener("messageerror", fail);
      signal.removeEventListener("abort", fail);
    }
    function fail() { cleanup(); reject(new Error("Local NER unavailable")); }
    function receive(event: MessageEvent<WorkerToHostMessage>) {
      const response = event.data;
      if (response.requestId !== body.requestId || response.generation !== body.generation) return;
      if (response.type === "progress") return;
      if (response.type !== expected) { fail(); return; }
      cleanup(); resolve(response);
    }
    worker.addEventListener("message", receive); worker.addEventListener("error", fail);
    worker.addEventListener("messageerror", fail); signal.addEventListener("abort", fail, { once: true });
    worker.postMessage(body);
  });
}
async function phase<T>(name: string, run: () => Promise<T>) {
  const start = performance.now(); const result = await run(); stages[name] = performance.now() - start; return result;
}
async function beginOcr() {
  clearCaptured(); draw(); lock(true); mode = "ocr"; started = performance.now();
  const ownGeneration = generation; const abort = new AbortController(); controller = abort;
  const fresh = () => { if (abort.signal.aborted || ownGeneration !== generation) throw new Error("Cancelled"); };
  let bitmap: ImageBitmap | null = null;
  try {
    message("正在检查本地能力…");
    await phase("preflightMs", async () => {
      if (!globalThis.Worker || !globalThis.createImageBitmap || !globalThis.caches || !globalThis.indexedDB ||
          !navigator.storage?.estimate || !globalThis.WebAssembly) throw new Error("Unsupported");
    });
    // Input is constructed here; there is deliberately no arbitrary-file input before policy approval.
    let picture: Blob | null = await phase("fixtureEncodeMs", () => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png")));
    fresh(); if (!picture || picture.size > PHASE2_LIMITS.maxEncodedBytes) throw new Error("Invalid fixture");
    const header = inspectStudyImage(new Uint8Array(await picture.arrayBuffer()));
    const dimensions = resizedStudyDimensions(header);
    bitmap = await phase("decodeMs", () => createImageBitmap(picture!, {
      imageOrientation: "from-image", resizeWidth: dimensions.width, resizeHeight: dimensions.height, resizeQuality: "high",
    }));
    picture = null; fresh();
    const resized = new OffscreenCanvas(bitmap.width, bitmap.height);
    resized.getContext("2d")!.drawImage(bitmap, 0, 0); bitmap.close(); bitmap = null;
    let input: Blob | null = await phase("resizedEncodeMs", () => resized.convertToBlob({ type: "image/png" }));
    resized.width = 0; resized.height = 0; canvas.width = 0; canvas.height = 0;
    ocr = new OcrRuntime(); const activeOcr = ocr;
    message("正在准备并运行 OCR…");
    await phase("ocrAssetMs", () => ensureVerifiedStudyAssets("ocr", abort.signal)); fresh();
    await phase("ocrInitMs", () => activeOcr.initialize(abort.signal)); fresh();
    let page = await phase("ocrInferenceMs", () => activeOcr.recognizeImage(input!, abort.signal)); input = null;
    await phase("ocrTeardownMs", () => activeOcr.dispose()); ocr = null; fresh();
    const lines = (page.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
    // Detach minimal evidence; do not retain Tesseract's cyclic page graph.
    const evidence = lines.map((line, i) => ({ id: `line-${i}`, text: line.text.normalize("NFKC").replace(/\s+/g, " ").trim(),
      words: line.words.map(word => ({ text: word.text, confidence: word.confidence })) }));
    page = null as unknown as typeof page;
    if (!evidence.length) throw new Error("No OCR lines");
    message("正在运行必需的本地 NER…");
    await phase("nerAssetMs", () => ensureVerifiedStudyAssets("ner", abort.signal)); fresh();
    const activeNer = new Worker("/ner.worker.js", { type: "module", name: "ning-study-ner" }); ner = activeNer;
    const envelope = () => ({ generation: ownGeneration, requestId: crypto.randomUUID() });
    await phase("nerInitMs", () => request(activeNer, { ...envelope(), type: "initialize", kind: "ner" }, "ready", abort.signal)); fresh();
    const result = await phase("nerInferenceMs", () => request(activeNer, { ...envelope(), type: "analyze-lines",
      lines: evidence.map(({ id, text }) => ({ id, text })) }, "ner-lines", abort.signal)); fresh();
    if (result.type !== "ner-lines") throw new Error("Invalid NER response");
    const classified: readonly NerLineEvidence[] = result.lines;
    if (classified.length !== evidence.length || classified.some((line, i) => !line.didRun || line.id !== evidence[i].id)) {
      throw new Error("Mandatory NER did not run");
    }
    await phase("nerTeardownMs", async () => { activeNer.terminate(); ner = null; });
    const reviewStarted = performance.now();
    // Study restriction, NOT a dictionary or production privacy classifier.
    // Only exact words from the current fictional worksheet can reach the prototype review.
    allowedWords = new Set(current().words);
    const seen = new Set<string>();
    evidence.forEach((line, i) => {
      if (classified[i].tokens.some(token => /PERSON|PER\b/.test(token.label))) return;
      line.words.forEach(word => {
        const term = word.text.toLowerCase().trim();
        if (!allowedWords.has(term) || seen.has(term) || !Number.isFinite(word.confidence) || word.confidence < 0 || word.confidence > 100) return;
        seen.add(term); addRow(term, word.confidence);
      });
    });
    stages.studyRestrictionMs = performance.now() - reviewStarted;
    stages.toReviewMs = performance.now() - started;
    if (!rows.children.length) throw new Error("No study candidates");
    message("请校对并选择单词；本次 NER 已完成。此原型未运行完整隐私策略。"); showReview();
  } catch {
    if (ownGeneration === generation) {
      clearCaptured(); message("本地处理未完成，内容已清除。请重试。"); ocrButton.focus();
    }
  } finally { bitmap?.close(); }
}
ocrButton.onclick = () => { void beginOcr(); };
manualButton.onclick = () => {
  clearCaptured(); draw(); lock(true); mode = "manual"; started = performance.now();
  allowedWords = new Set(current().words);
  current().words.forEach(() => addRow("")); showReview(); message("请根据练习纸手动输入，再确认本地结果。");
};
byId("confirm").onclick = () => {
  const selected = [...rows.children].filter(row => row.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked)
    .map(row => row.querySelector<HTMLInputElement>("input[type=text]")!.value.trim().toLowerCase());
  if (!selected.length || selected.some(word => !allowedWords.has(word)) || new Set(selected).size !== selected.length) {
    message("请选择练习纸中的单词，检查拼写及重复项。"); return;
  }
  records.push({ worksheetId: current().id, mode, observer: observer.value, endpoint: "local-confirmation",
    selectedCount: selected.length, expectedCount: current().words.length,
    localConfirmationMs: performance.now() - started, databaseSaveMs: null, ...stages });
  byId("results").textContent = JSON.stringify(records, null, 2);
  clearCaptured(); message("本地研究结果已确认；未向服务器保存单词。内容已清除。"); ocrButton.focus();
};
byId("cancel").onclick = () => { clearCaptured(); message("已取消，内容已清除。"); ocrButton.focus(); };
byId("clear-results").onclick = () => { records.length = 0; byId("results").textContent = "[]"; };
sheet.onchange = () => { clearCaptured(); draw(); };
window.addEventListener("pagehide", () => { clearCaptured(); records.length = 0; byId("results").textContent = "[]"; });
draw();
