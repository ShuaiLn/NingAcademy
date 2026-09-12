"use client";

import { useState, useTransition } from "react";
import { archivePersonalWord } from "@/app/actions/personal-words";

type WordCardProps = {
  word: {
    id: string;
    term: string;
    meaning: string | null;
  };
};

export function WordCard({ word }: WordCardProps) {
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (archived) return null;

  return (
    <article className="flex items-start justify-between gap-4 rounded-md border border-slate-200 p-4">
      <div className="min-w-0">
        <h3 className="break-words font-medium">{word.term}</h3>
        {word.meaning ? (
          <p className="mt-1 break-words text-sm text-slate-600">
            {word.meaning}
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-400">暂无释义</p>
        )}
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await archivePersonalWord(word.id);
            if (result.ok) setArchived(true);
            else setError(result.error);
          });
        }}
        className="shrink-0 rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:border-slate-400 disabled:opacity-50"
      >
        {pending ? "归档中…" : "归档"}
      </button>
    </article>
  );
}
