"use client";

import { useState, useTransition } from "react";
import { updateVocabularyWordAltMeanings } from "@/app/actions/vocabulary";

// Same "add/remove rows, save as one array" pattern as word-rows-editor.tsx,
// scoped to one word's alternative accepted Chinese translations (v2 sets,
// input_mode=type_chinese only -- rendered conditionally by word-row.tsx).
export function AltMeaningsEditor({
  wordId,
  setId,
  initialAltMeanings,
}: {
  wordId: string;
  setId: string;
  initialAltMeanings: string[];
}) {
  const [items, setItems] = useState<string[]>(initialAltMeanings.length > 0 ? initialAltMeanings : [""]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function updateItem(index: number, value: string) {
    setItems((prev) => prev.map((v, i) => (i === index ? value : v)));
    setSaved(false);
  }

  function addRow() {
    setItems((prev) => [...prev, ""]);
  }

  function removeRow(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateVocabularyWordAltMeanings(
        wordId,
        setId,
        items.map((v) => v.trim()).filter((v) => v.length > 0)
      );
      if (result.ok) {
        setSaved(true);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-slate-500">其他可接受的中文译文（可选，最多 10 个）</span>
      <div className="flex flex-wrap items-center gap-2">
        {items.map((value, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              type="text"
              value={value}
              onChange={(e) => updateItem(i, e.target.value)}
              className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={items.length === 1}
              className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-30"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          disabled={items.length >= 10}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-400 disabled:opacity-40"
        >
          + 添加
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存译文"}
        </button>
        {saved ? <span className="text-xs text-green-700">已保存</span> : null}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}
