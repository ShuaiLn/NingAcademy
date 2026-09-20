"use client";

import { useState } from "react";
import { ModelDownloadProgress } from "@/app/_components/local-ai/model-download-progress";
import { requiredBytesFor } from "@/app/_lib/local-ai/asset-catalog";
import type { LocalModelKind } from "@/app/_lib/local-ai/contracts";
import { useLocalAiRuntime } from "@/app/_hooks/use-local-ai-runtime";

const kinds: readonly LocalModelKind[] = ["ocr", "ner", "tts"];

export function DiagnosticsClient() {
  const runtime = useLocalAiRuntime();
  const [log, setLog] = useState<string[]>([]);

  async function run(kind: LocalModelKind) {
    try {
      const result = await runtime.runDiagnostic(kind);
      setLog((items) => [...items, `${kind}: ${result.initializedMs.toFixed(1)} ms init, ${result.inferenceMs.toFixed(1)} ms inference`]);
    } catch (error) {
      setLog((items) => [...items, `${kind}: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  async function runSequence() {
    for (const kind of ["ocr", "tts", "ner", "ocr"] as const) await run(kind);
    await runtime.release();
  }

  function exportEvidence() {
    const evidence = {
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      capabilities: runtime.capabilities,
      decisions: runtime.decisions,
      snapshot: runtime.snapshot,
      inventory: runtime.inventory,
      lastTiming: runtime.lastResult
        ? {
            kind: runtime.lastResult.kind,
            initializedMs: runtime.lastResult.initializedMs,
            inferenceMs: runtime.lastResult.inferenceMs,
          }
        : null,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "phase0-local-runtime-evidence.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function simulateQuota(kind: LocalModelKind) {
    const result = await runtime.simulateQuotaRejection(kind);
    setLog((items) => [...items, `${kind} artificial quota: ${result.status} before download (${result.requiredBytes} required)`]);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">本地模型 Phase 0 诊断</h1>
        <p className="mt-1 text-sm text-slate-600">仅用于运行时、隐私、缓存和部署验证，不是学习功能。</p>
      </header>

      <ModelDownloadProgress snapshot={runtime.snapshot} label="本地模型状态" onCancel={() => void runtime.cancel()} />

      <section className="flex flex-wrap gap-2" aria-label="真实模型诊断">
        {kinds.map((kind) => (
          <button key={kind} type="button" onClick={() => void run(kind)} className="min-h-11 rounded border px-4 py-2">
            运行 {kind.toUpperCase()}
          </button>
        ))}
        <button type="button" onClick={() => void runSequence()} className="min-h-11 rounded border px-4 py-2">运行互斥序列</button>
        <button type="button" onClick={() => void runtime.cancel()} className="min-h-11 rounded border px-4 py-2">注入取消</button>
      </section>

      <section>
        <h2 className="font-medium">设备与策略</h2>
        <pre className="mt-2 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify({ capabilities: runtime.capabilities, decisions: runtime.decisions }, null, 2)}</pre>
      </section>

      <section>
        <h2 className="font-medium">缓存与配额模拟</h2>
        <p className="text-sm text-slate-600">1 字节人工余量会在写入前拒绝；不会修改浏览器真实配额。</p>
        <pre className="mt-2 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify({ requiredBytes: Object.fromEntries(kinds.map((kind) => [kind, requiredBytesFor(kind)])), inventory: runtime.inventory }, null, 2)}</pre>
        <div className="mt-2 flex flex-wrap gap-2">
          {kinds.map((kind) => <button key={`quota-${kind}`} type="button" onClick={() => void simulateQuota(kind)} className="min-h-11 rounded border px-4 py-2">模拟 {kind.toUpperCase()} 配额拒绝</button>)}
          {kinds.map((kind) => <button key={kind} type="button" onClick={() => void runtime.clearModel(kind)} className="min-h-11 rounded border px-4 py-2">清除 {kind.toUpperCase()}</button>)}
          <button type="button" onClick={() => void runtime.clearAll()} className="min-h-11 rounded border px-4 py-2">全部清除</button>
          <button type="button" onClick={exportEvidence} className="min-h-11 rounded border px-4 py-2">导出无内容证据</button>
        </div>
      </section>

      <section>
        <h2 className="font-medium">运行记录</h2>
        <pre className="mt-2 min-h-20 overflow-auto rounded bg-slate-100 p-3 text-xs">{log.join("\n")}</pre>
      </section>
    </div>
  );
}
