"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSummaryTarget } from "@/app/actions/summaries";

export function RemoveTargetButton({ summaryId, studentId }: { summaryId: string; studentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteSummaryTarget(summaryId, studentId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleRemove}
        disabled={pending}
        className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:border-slate-400 disabled:opacity-50"
      >
        {pending ? "处理中…" : "移除"}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
