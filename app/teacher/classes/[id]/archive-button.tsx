"use client";

import { useState, useTransition } from "react";
import { archiveClass } from "@/app/actions/classes";

export function ArchiveButton({ classId, archived }: { classId: string; archived: boolean }) {
  const [isArchived, setIsArchived] = useState(archived);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isArchived) {
    return <p className="text-sm text-slate-400">该班级已归档。</p>;
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await archiveClass(classId);
            if (result.ok) setIsArchived(true);
            else setError(result.error);
          });
        }}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-slate-400 disabled:opacity-50"
      >
        {pending ? "处理中…" : "归档班级"}
      </button>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
}
