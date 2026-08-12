"use client";

import { useState, useTransition } from "react";
import { publishVocabularySet, archiveVocabularySet } from "@/app/actions/vocabulary";

export function SetActionsPanel({
  setId,
  published,
  archived,
}: {
  setId: string;
  published: boolean;
  archived: boolean;
}) {
  const [isPublished, setIsPublished] = useState(published);
  const [isArchived, setIsArchived] = useState(archived);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isArchived) {
    return <p className="text-sm text-slate-400">该作业已归档。</p>;
  }

  return (
    <div className="flex items-center gap-3">
      {!isPublished ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await publishVocabularySet(setId);
              if (result.ok) {
                setIsPublished(true);
              } else {
                setError(result.error);
              }
            });
          }}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? "发布中…" : "发布作业"}
        </button>
      ) : (
        <span className="text-sm text-green-700">已发布</span>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await archiveVocabularySet(setId);
            if (result.ok) {
              setIsArchived(true);
            } else {
              setError(result.error);
            }
          });
        }}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-slate-400 disabled:opacity-50"
      >
        {pending ? "处理中…" : "归档作业"}
      </button>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
}
