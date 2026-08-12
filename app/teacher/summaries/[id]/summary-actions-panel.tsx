"use client";

import { useState, useTransition } from "react";
import { archiveLessonSummary, unarchiveLessonSummary } from "@/app/actions/summaries";

export function SummaryActionsPanel({ summaryId, archived }: { summaryId: string; archived: boolean }) {
  const [isArchived, setIsArchived] = useState(archived);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const result = isArchived ? await unarchiveLessonSummary(summaryId) : await archiveLessonSummary(summaryId);
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
        {pending ? "处理中…" : isArchived ? "取消归档" : "归档总结"}
      </button>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
}
