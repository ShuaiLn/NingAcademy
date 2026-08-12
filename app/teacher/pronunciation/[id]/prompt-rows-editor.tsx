"use client";

import { useState } from "react";

// Mirrors app/teacher/vocabulary/word-rows-editor.tsx, kept separate (not
// shared) -- single text_prompt field per row instead of term/meaning/
// imageUrl. Serializes into one hidden `prompts` field as a plain JSON
// string array (see parsePromptsField in actions/pronunciation.ts).
export function PromptRowsEditor({ fieldName = "prompts" }: { fieldName?: string }) {
  const [prompts, setPrompts] = useState<string[]>([""]);

  function updatePrompt(index: number, value: string) {
    setPrompts((prev) => prev.map((p, i) => (i === index ? value : p)));
  }
  function addRow() {
    setPrompts((prev) => [...prev, ""]);
  }
  function removeRow(index: number) {
    setPrompts((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {prompts.map((prompt, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-slate-700">跟读内容</span>
            <input
              type="text"
              value={prompt}
              onChange={(e) => updatePrompt(i, e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
            />
          </label>
          <button
            type="button"
            onClick={() => removeRow(i)}
            disabled={prompts.length === 1}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-slate-400 disabled:opacity-40"
          >
            删除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:border-slate-400"
      >
        + 添加一条内容
      </button>
      <input type="hidden" name={fieldName} value={JSON.stringify(prompts)} />
    </div>
  );
}
