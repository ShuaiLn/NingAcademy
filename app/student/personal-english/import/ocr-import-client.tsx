"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { confirmOcrWordsBulk } from "@/app/actions/personal-word-ocr";
import type { ImportStage, ConfirmedWord, ReviewCandidate, ReviewResult } from "@/app/_lib/ocr-import/contracts";
import { validateConfirmation } from "@/app/_lib/ocr-import/validation";
import { createBrowserModelCache } from "@/app/_lib/local-ai/model-cache";
type Row = { candidate: ReviewCandidate; term: string; meaning: string; exampleSentence: string; selected: boolean };
const stages: Record<ImportStage, string> = { checking: "检查设备与图片", decoding: "在设备上处理图片", ocr: "在设备上识别文字", ner: "在设备上检查隐私", privacy: "准备可供审核的生词" };
const states = { normal: "可选生词", confirm: "请确认识别结果", must_review: "识别把握较低，请仔细修改", possible_typo: "可能是拼写错误或专有名词" };
const dictionaryStates = { known: "词典已收录", known_inflected: "词典已收录其词形", unknown: "词典未收录" };
const control = "min-h-11 rounded border border-slate-400 px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";
export function OcrImportClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [stage, setStage] = useState<ImportStage | "saving" | null>(null);
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [removed, setRemoved] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  const active = useRef<AbortController | null>(null); const mounted = useRef(true);
  const retry = useRef<{ id: string; payload: string } | null>(null);
  const saving = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const clear = () => {
      active.current?.abort(); active.current = null; retry.current = null;
      if (fileInput.current) fileInput.current.value = "";
      setRows(null); setStage(null); setError(""); setMessage(""); setRemoved(0);
    };
    window.addEventListener("pagehide", clear);
    return () => { mounted.current = false; active.current?.abort(); retry.current = null; window.removeEventListener("pagehide", clear); };
  }, []);
  const reviewing = rows !== null;
  useEffect(() => { if (reviewing) heading.current?.focus(); }, [reviewing]);
  function reset() {
    active.current?.abort(); active.current = null; retry.current = null;
    setRows(null); setStage(null); setError(""); setMessage(""); setRemoved(0);
    if (fileInput.current) fileInput.current.value = "";
  }
  async function process() {
    if (active.current || saving.current) return;
    const files = fileInput.current?.files;
    if (!files || files.length !== 1) { setError("请选择一张 JPEG、PNG 或 WebP 图片。"); return; }
    const file = files[0]; if (fileInput.current) fileInput.current.value = "";
    const controller = new AbortController(); active.current = controller;
    retry.current = null; setRows(null); setError(""); setMessage(""); setStage("checking");
    try {
      // Loading the OCR pipeline is itself part of the explicit import action.
      const { importPhoto } = await import("@/app/_lib/ocr-import/pipeline");
      const result: ReviewResult = await importPhoto(file, controller.signal, value => {
        if (!controller.signal.aborted && mounted.current) setStage(value);
      });
      if (controller.signal.aborted || !mounted.current) return;
      setRows(result.candidates.map(candidate => ({ candidate, term: candidate.term, meaning: "",
        exampleSentence: candidate.exampleSentence ?? "", selected: candidate.selected })));
      setRemoved(result.removedLineCount);
    } catch {
      if (!controller.signal.aborted && mounted.current) setError("本地识别或隐私检查未完成。请重试，或返回生词库手动添加。");
    } finally {
      if (active.current === controller) { active.current = null; if (mounted.current) setStage(null); }
    }
  }
  function edit(index: number, update: Partial<Omit<Row, "candidate">>) {
    retry.current = null; setError("");
    setRows(current => current?.map((row, i) => i === index ? { ...row, ...update } : row) ?? null);
  }
  async function confirm() {
    if (saving.current || stage || !rows) return;
    const words: ConfirmedWord[] = rows.filter(row => row.selected).map(row => ({ term: row.term, meaning: row.meaning || null,
      exampleSentence: row.candidate.disposition === "full_offer" ? row.exampleSentence || null : null }));
    const payload = JSON.stringify(words);
    const request = retry.current?.payload === payload ? retry.current : { id: crypto.randomUUID(), payload };
    if (!validateConfirmation(request.id, words)) { setError("请选择 1–100 个不重复的生词，检查字数并移除个人信息。"); return; }
    retry.current = request; saving.current = true; setStage("saving"); setError("");
    try {
      const result = await confirmOcrWordsBulk(request.id, words);
      if (!mounted.current) return;
      if (result.ok) { setRows(null); setRemoved(0); retry.current = null; setMessage(`已导入 ${result.count} 个生词。`); }
      else setError("导入未完成，请检查所选内容后重试。相同内容可安全重试。");
    } catch { if (mounted.current) setError("导入未完成，请重试。相同内容可安全重试。"); }
    finally { saving.current = false; if (mounted.current) setStage(null); }
  }
  const selected = rows?.filter(row => row.selected).length ?? 0;
  return <div className="space-y-5 pb-16">
    <h1 className="text-2xl font-semibold">拍照导入生词</h1>
    <p>图片和识别文字仅在此设备上处理。只有你确认的生词、释义和允许保留的例句才会保存到生词库。</p>
    <p className="text-sm text-slate-700">首次使用需下载本地识别资源。一次选择一张 JPEG、PNG 或 WebP 图片，最大 10 MiB。</p>
    <Link href="/student/personal-english" prefetch={false} className="inline-flex min-h-11 items-center text-blue-800 underline">返回生词库／手动添加</Link>
    <div aria-live="polite" role="status">{stage ? stage === "saving" ? "正在保存已确认的生词" : stages[stage] : message}</div>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {!rows && <div className="flex flex-col gap-3">
      <label htmlFor="ocr-photo">选择图片</label>
      <input ref={fileInput} id="ocr-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={!!stage} className={control} />
      <button type="button" onClick={() => void process()} disabled={!!stage} className={control}>开始本地识别</button>
    </div>}
    {stage && stage !== "saving" && <button type="button" onClick={reset} className={control}>取消并清除</button>}
    {rows && <section aria-labelledby="ocr-review-heading" className="space-y-4">
      <h2 id="ocr-review-heading" ref={heading} tabIndex={-1} className="text-xl font-semibold">确认要保存的生词</h2>
      <p>已选 {selected} / 100 个。{removed > 0 ? `已排除 ${removed} 行的完整内容。` : ""}请检查每个单词，移除不需要的内容。</p>
      {!rows.length && <p>没有可供审核的生词，请换一张清晰图片或手动添加。</p>}
      <fieldset disabled={!!stage} className="space-y-4">
        <legend className="sr-only">生词审核</legend>
        {rows.map((row, index) => <div key={row.candidate.id} className="space-y-3 rounded border border-slate-300 p-4">
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={row.selected}
            onChange={event => edit(index, { selected: event.target.checked })} className="h-5 w-5" />保存第 {index + 1} 个生词</label>
          <p className="text-sm text-slate-700">{states[row.candidate.state]}</p>
          <div className="flex flex-wrap gap-2 text-xs" aria-label={`第 ${index + 1} 个生词的识别信息`}>
            <span className="rounded bg-slate-100 px-2 py-1" aria-label={`OCR 置信度 ${row.candidate.confidence.toFixed(1)}`}>
              OCR {row.candidate.confidence.toFixed(1)}
            </span>
            <span className="rounded bg-slate-100 px-2 py-1" aria-label={`词典状态：${dictionaryStates[row.candidate.dictionary]}`}>
              {dictionaryStates[row.candidate.dictionary]}
            </span>
          </div>
          <label className="block">生词<input value={row.term} onChange={event => edit(index, { term: event.target.value })} className={control + " mt-1 block w-full"} autoComplete="off" spellCheck={false} /></label>
          <label className="block">释义（可选，最多 1000 字）<input value={row.meaning} onChange={event => edit(index, { meaning: event.target.value })} className={control + " mt-1 block w-full"} autoComplete="off" /></label>
          {row.candidate.disposition === "full_offer" && <label className="block">例句（可选，最多 2000 字）<textarea value={row.exampleSentence}
            onChange={event => edit(index, { exampleSentence: event.target.value })} className={control + " mt-1 block w-full"} autoComplete="off" spellCheck={false} /></label>}
          <button type="button" onClick={() => { retry.current = null; setRows(current => current?.filter((_, i) => i !== index) ?? null); }} className={control}>丢弃第 {index + 1} 个生词</button>
        </div>)}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => void confirm()} disabled={!!stage || selected < 1 || selected > 100} className={control}>确认并导入 {selected} 个生词</button>
        <button type="button" onClick={reset} disabled={stage === "saving"} className={control}>全部丢弃／换一张图片</button>
      </div>
    </section>}
    <button type="button" disabled={!!stage} className={control} onClick={() => {
      reset(); void Promise.all([createBrowserModelCache().clearModel("ocr"), createBrowserModelCache().clearModel("ner")])
        .then(() => { if (mounted.current) setMessage("已清除本地识别资源缓存。"); })
        .catch(() => { if (mounted.current) setError("缓存清除未完成，请在浏览器设置中重试。"); });
    }}>清除本地识别资源缓存</button>
  </div>;
}
