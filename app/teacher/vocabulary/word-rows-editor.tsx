"use client";

import { useState } from "react";
import type { VocabularyWordInput } from "@/app/actions/vocabulary";

const emptyRow: VocabularyWordInput = { term: "", meaning: "", imageUrl: "", altAnswers: [] };

// Serializes its row state into one hidden `words` field as JSON -- FormData
// has no native array shape for a variable-length list of objects, so the
// server action parses it back out (see parseWordsField in actions/vocabulary.ts).
export function WordRowsEditor({
  fieldName = "words",
  isV2 = false,
  inputMode = "",
}: {
  fieldName?: string;
  isV2?: boolean;
  inputMode?: string;
}) {
  const [words, setWords] = useState<VocabularyWordInput[]>([{ ...emptyRow }]);

  function updateWord(index: number, field: "term" | "meaning" | "imageUrl", value: string) {
    setWords((prev) => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)));
  }

  function addRow() {
    setWords((prev) => [...prev, { ...emptyRow }]);
  }

  function removeRow(index: number) {
    setWords((prev) => prev.filter((_, i) => i !== index));
  }

  function updateAltAnswer(wordIndex: number, altIndex: number, value: string) {
    setWords((prev) =>
      prev.map((w, i) => (i === wordIndex ? { ...w, altAnswers: w.altAnswers.map((a, j) => (j === altIndex ? value : a)) } : w))
    );
  }

  function addAltAnswer(wordIndex: number) {
    setWords((prev) => prev.map((w, i) => (i === wordIndex ? { ...w, altAnswers: [...w.altAnswers, ""] } : w)));
  }

  function removeAltAnswer(wordIndex: number, altIndex: number) {
    setWords((prev) =>
      prev.map((w, i) => (i === wordIndex ? { ...w, altAnswers: w.altAnswers.filter((_, j) => j !== altIndex) } : w))
    );
  }

  const showAltAnswers = isV2 && inputMode !== "audio";
  const altAnswersLabel = inputMode === "type_chinese" ? "其他可接受的中文译文" : "其他可接受的英文拼写";

  return (
    <div className="flex flex-col gap-3">
      {words.map((word, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-700">单词</span>
            <input
              type="text"
              value={word.term}
              onChange={(e) => updateWord(i, "term", e.target.value)}
              className="w-40 rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-700">释义</span>
            <input
              type="text"
              value={word.meaning}
              onChange={(e) => updateWord(i, "meaning", e.target.value)}
              className="w-40 rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-700">图片链接（可选）</span>
            <input
              type="text"
              value={word.imageUrl}
              onChange={(e) => updateWord(i, "imageUrl", e.target.value)}
              placeholder="https://..."
              className="w-56 rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
            />
          </label>
          <button
            type="button"
            onClick={() => removeRow(i)}
            disabled={words.length === 1}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-slate-400 disabled:opacity-40"
          >
            删除
          </button>

          {showAltAnswers ? (
            <div className="flex w-full flex-col gap-1 text-sm">
              <span className="text-slate-500">
                {altAnswersLabel}（可选，最多 10 个）
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {word.altAnswers.map((value, j) => (
                  <div key={j} className="flex items-center gap-1">
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => updateAltAnswer(i, j, e.target.value)}
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => removeAltAnswer(i, j)}
                      className="text-xs text-slate-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addAltAnswer(i)}
                  disabled={word.altAnswers.length >= 10}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-400 disabled:opacity-40"
                >
                  + 添加
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:border-slate-400"
      >
        + 添加一个单词
      </button>
      <input type="hidden" name={fieldName} value={JSON.stringify(words)} />
    </div>
  );
}
