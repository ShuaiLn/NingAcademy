import { OcrRuntime } from "../local-ai/models/ocr-runtime";
import { NerRuntime } from "../local-ai/models/ner-runtime";
import { inspectStudyImage, resizedStudyDimensions } from "../local-ai/models/study-image";
import { LOCAL_AI_CACHE_NAME } from "../local-ai/model-cache";
import { PHASE2_LIMITS as limits } from "../local-ai/phase2-limits.generated";
import type { NerLineEvidence, NerLineInput } from "../local-ai/models/ner-lines";
import { EnglishDictionary } from "./dictionary";
import { DICTIONARY_ASSETS } from "./dictionary-assets.generated";
import { ensureVerifiedAssets } from "./verified-assets";
import { constructLines } from "./normalization";
import { classifyLineDisposition, computeLineSignals, countStructurallyValidNonblankLines, structuralReason } from "./policy";
import { extractReview } from "./candidates";
import type { ImportStage, NormalizedLine, ReviewResult } from "./contracts";
export function staticPreflight() {
  if (!globalThis.isSecureContext || typeof Worker === "undefined" || typeof WebAssembly === "undefined"
    || typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined" || !globalThis.crypto?.subtle
    || !globalThis.caches || !globalThis.indexedDB || !Intl.Segmenter) throw new Error("Unsupported local processing");
}
export function nerBatches(lines: readonly NormalizedLine[]): NerLineInput[][] {
  const batches: NerLineInput[][] = []; let batch: NerLineInput[] = []; let characters = 0;
  for (const line of lines) {
    if (!line.text || structuralReason(line)) continue;
    if (batch.length === limits.maxNerBatchLines || characters + line.text.length > limits.maxNerBatchCharacters) {
      batches.push(batch); batch = []; characters = 0;
    }
    batch.push({ id: line.id, text: line.text }); characters += line.text.length;
  }
  if (batch.length) batches.push(batch); return batches;
}
export async function importPhoto(file: File, signal: AbortSignal, stage: (stage: ImportStage) => void): Promise<ReviewResult> {
  let bitmap: ImageBitmap | null = null; let canvas: OffscreenCanvas | null = null; let image: Blob | null = null;
  let lines: NormalizedLine[] = []; const ocr = new OcrRuntime(), ner = new NerRuntime();
  const cancel = () => { void ocr.dispose(); ner.cancel(); bitmap?.close(); bitmap = null; if (canvas) { canvas.width = 0; canvas.height = 0; } };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    stage("checking"); signal.throwIfAborted(); staticPreflight();
    if (file.size > limits.maxEncodedBytes || !file.size) throw new Error("Invalid photo");
    const header = inspectStudyImage(new Uint8Array(await file.arrayBuffer()));
    if (file.type && file.type !== header.type) throw new Error("Invalid photo type");
    signal.throwIfAborted(); stage("decoding");
    const dimensions = resizedStudyDimensions(header);
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: dimensions.width, resizeHeight: dimensions.height, resizeQuality: "high" });
    signal.throwIfAborted();
    if (bitmap.width !== dimensions.width || bitmap.height !== dimensions.height) throw new Error("Unsupported resized decode");
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height); const context = canvas.getContext("2d");
    if (!context) throw new Error("Unsupported canvas");
    context.drawImage(bitmap, 0, 0); bitmap.close(); bitmap = null;
    image = await canvas.convertToBlob({ type: "image/png" }); canvas.width = 0; canvas.height = 0; canvas = null;
    signal.throwIfAborted(); stage("ocr");
    await ensureVerifiedAssets("ocr", signal); await ocr.initialize(signal);
    const result = await ocr.recognizeImage(image, signal); image = null;
    await ocr.dispose(); signal.throwIfAborted();
    lines = constructLines((result.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines)), dimensions);
    // Release raw recognition containers before creating the model runtime.
    result.text = ""; result.blocks = null;
    stage("ner"); await ensureVerifiedAssets("ner", signal); await ner.initialize(signal);
    const evidence = new Map<string, NerLineEvidence>();
    for (const batch of nerBatches(lines)) {
      const responses = await ner.analyzeLines(batch, signal);
      if (responses.length !== batch.length || responses.some((response, i) => response.id !== batch[i].id)) throw new Error("Invalid NER response");
      for (const response of responses) evidence.set(response.id, response);
    }
    await ner.dispose(); signal.throwIfAborted(); stage("privacy");
    const cache = await caches.open(LOCAL_AI_CACHE_NAME);
    const buffers = await Promise.all(DICTIONARY_ASSETS.map(async asset => {
      const response = await cache.match(asset.url); if (!response) throw new Error("Missing dictionary");
      return new Uint8Array(await response.arrayBuffer());
    }));
    const dictionary = new EnglishDictionary(buffers[0], buffers[1]);
    const count = countStructurallyValidNonblankLines(lines);
    const decisions = lines.filter(line => line.text).map(line => {
      const reason = structuralReason(line);
      if (reason) return { line, decision: { disposition: "never_offer" as const, reason, suppressedWordIds: line.words.map(word => word.id) } };
      const observed = evidence.get(line.id); if (!observed) throw new Error("Missing mandatory NER");
      return { line, decision: classifyLineDisposition(computeLineSignals(line, observed, count, word => dictionary.lookup(word))) };
    });
    signal.throwIfAborted(); return extractReview(decisions, word => dictionary.lookup(word));
  } finally {
    signal.removeEventListener("abort", cancel); cancel(); lines.length = 0; image = null;
    await Promise.allSettled([ocr.dispose(), ner.dispose()]);
  }
}
