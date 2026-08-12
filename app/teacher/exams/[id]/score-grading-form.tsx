"use client";

import { useState, useTransition } from "react";
import { gradeExamScore } from "@/app/actions/exams";

// Mirrors app/teacher/assignments/[id]/grading-form.tsx. score IS NULL is
// always the "尚未评分" state -- a teacher can save feedback_text alone
// first (which still stamps graded_at server-side), that is an intentional
// intermediate state, not a bug -- see the exam_scores migration comment.
export function ScoreGradingForm({
  examScoreId,
  score,
  feedbackText,
}: {
  examScoreId: string;
  score: number | null;
  feedbackText: string | null;
}) {
  const [scoreValue, setScoreValue] = useState(score !== null ? String(score) : "");
  const [feedback, setFeedback] = useState(feedbackText ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const parsedScore = scoreValue.trim() === "" ? null : Number(scoreValue);
      const result = await gradeExamScore(examScoreId, parsedScore, feedback);
      if (result.ok) {
        setSaved(true);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">分数</span>
        <input
          type="number"
          min="0"
          step="0.1"
          value={scoreValue}
          onChange={(e) => setScoreValue(e.target.value)}
          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
        />
      </label>
      <label className="flex flex-1 flex-col gap-1 text-sm">
        <span className="text-slate-700">评语</span>
        <input
          type="text"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
        />
      </label>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={pending}
        className="rounded-md bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
      >
        {pending ? "保存中…" : "保存"}
      </button>
      {saved ? <span className="text-xs text-green-700">已保存</span> : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
