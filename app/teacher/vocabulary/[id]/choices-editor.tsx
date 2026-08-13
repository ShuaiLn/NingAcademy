"use client";

import { useState, useTransition } from "react";
import { updateVocabularyWordChoices } from "@/app/actions/vocabulary";

type Choice = { choiceText: string; isCorrect: boolean };

// Same "add/remove rows, save whole array" shape as alt-answers-editor.tsx,
// but each row also carries a single-correct radio instead of being a
// plain list, and duplicate text is rejected client-side too (mirroring
// replace_vocabulary_word_choices' own rejection) so the teacher gets an
// immediate inline error instead of a round trip.
export function ChoicesEditor({
  wordId,
  setId,
  initialChoices,
}: {
  wordId: string;
  setId: string;
  initialChoices: Choice[];
}) {
  const [items, setItems] = useState<Choice[]>(
    initialChoices.length > 0
      ? initialChoices
      : [
          { choiceText: "", isCorrect: true },
          { choiceText: "", isCorrect: false },
        ]
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function updateText(index: number, value: string) {
    setItems((prev) => prev.map((c, i) => (i === index ? { ...c, choiceText: value } : c)));
    setSaved(false);
  }

  function setCorrect(index: number) {
    setItems((prev) => prev.map((c, i) => ({ ...c, isCorrect: i === index })));
    setSaved(false);
  }

  function addRow() {
    setItems((prev) => [...prev, { choiceText: "", isCorrect: false }]);
  }

  function removeRow(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  }

  function save() {
    setError(null);
    setSaved(false);

    const trimmed = items.map((c) => ({ choiceText: c.choiceText.trim(), isCorrect: c.isCorrect })).filter((c) => c.choiceText.length > 0);

    if (trimmed.length < 2) {
      setError("至少需要 2 个选项");
      return;
    }
    if (trimmed.length > 8) {
      setError("最多 8 个选项");
      return;
    }
    const seen = new Set<string>();
    for (const c of trimmed) {
      if (seen.has(c.choiceText)) {
        setError("选项内容不能重复");
        return;
      }
      seen.add(c.choiceText);
    }
    if (trimmed.filter((c) => c.isCorrect).length !== 1) {
      setError("必须恰好选择一个正确答案");
      return;
    }

    startTransition(async () => {
      const result = await updateVocabularyWordChoices(wordId, setId, trimmed);
      if (result.ok) {
        setSaved(true);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-slate-50 p-2 text-sm">
      <span className="text-slate-500">选项（2-8 个，选择一个为正确答案）</span>
      <div className="flex flex-col gap-2">
        {items.map((choice, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="radio"
              name={`vocabulary-word-choice-correct-${wordId}`}
              checked={choice.isCorrect}
              onChange={() => setCorrect(i)}
              aria-label="标记为正确答案"
            />
            <input
              type="text"
              value={choice.choiceText}
              onChange={(e) => updateText(i, e.target.value)}
              maxLength={300}
              className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={items.length <= 2}
              className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-30"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={addRow}
          disabled={items.length >= 8}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-400 disabled:opacity-40"
        >
          + 添加选项
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存选项"}
        </button>
        {saved ? <span className="text-xs text-green-700">已保存</span> : null}
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}
