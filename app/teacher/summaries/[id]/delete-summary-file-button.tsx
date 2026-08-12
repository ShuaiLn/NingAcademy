"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteLessonSummaryFile } from "@/app/actions/summaries";

// Revoke-access-now, reclaim-bytes-later -- see delete_lesson_summary_file()'s
// comment in the migration. The Storage object itself is only actually
// removed by the periodic cleanup Edge Function.
export function DeleteSummaryFileButton({
  summaryId,
  fileId,
  fileName,
}: {
  summaryId: string;
  fileId: string;
  fileName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteLessonSummaryFile(summaryId, fileId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={handleDelete}
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
      >
        删除「{fileName}」
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
