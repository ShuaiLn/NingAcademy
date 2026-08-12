"use client";

import { useState, useTransition } from "react";
import { archiveExam, unarchiveExam } from "@/app/actions/exams";

// Archiving does not revoke an already-visible score from a student who
// could already see it -- it only declutters the teacher's active list and
// blocks addStudentsToExam(). unarchiveExam() restores it to the active list
// and re-enables adding students.
export function ExamActionsPanel({ examId, archived }: { examId: string; archived: boolean }) {
  const [isArchived, setIsArchived] = useState(archived);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const result = isArchived ? await unarchiveExam(examId) : await archiveExam(examId);
      if (result.ok) {
        setIsArchived(!isArchived);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <span className={isArchived ? "text-sm text-slate-400" : "text-sm text-green-700"}>
        {isArchived ? "已归档" : "进行中"}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={handleToggle}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-slate-400 disabled:opacity-50"
      >
        {pending ? "处理中…" : isArchived ? "取消归档" : "归档考试"}
      </button>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
}
