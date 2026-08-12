"use client";

import { useActionState, useState, useTransition } from "react";
import {
  updateVocabularyWord,
  archiveVocabularyWord,
  deleteVocabularyWord,
  type UpdateVocabularyWordResult,
} from "@/app/actions/vocabulary";

const initialState: UpdateVocabularyWordResult = { ok: false, error: "" };

// 归档 (soft) and 删除 (hard) are two distinct actions, not aliases -- 删除
// is always shown enabled (nothing legally queryable would tell this page
// in advance whether it would succeed) and only fails, with a friendly
// message, if the word has already been snapshotted into a practice
// session -- see deleteVocabularyWord's comment.
export function WordRow({
  setId,
  word,
}: {
  setId: string;
  word: { id: string; term: string; meaning: string; image_url: string | null; archived_at: string | null };
}) {
  const [state, formAction, pending] = useActionState(updateVocabularyWord, initialState);
  const [archivePending, startArchiveTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  if (word.archived_at) {
    return (
      <tr className="border-b border-slate-100 text-slate-400">
        <td className="py-2" colSpan={2}>
          {word.term} / {word.meaning}
        </td>
        <td className="py-2">已归档</td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-slate-100">
      <td colSpan={3} className="py-2">
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="wordId" value={word.id} />
          <input type="hidden" name="setId" value={setId} />
          <input
            name="term"
            type="text"
            defaultValue={word.term}
            className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
          />
          <input
            name="meaning"
            type="text"
            defaultValue={word.meaning}
            className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
          />
          <input
            name="imageUrl"
            type="text"
            defaultValue={word.image_url ?? ""}
            placeholder="图片链接（可选）"
            className="w-48 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {pending ? "保存中…" : "保存"}
          </button>
          <button
            type="button"
            disabled={archivePending}
            onClick={() => {
              setActionError(null);
              startArchiveTransition(async () => {
                const result = await archiveVocabularyWord(word.id, setId);
                if (!result.ok) setActionError(result.error);
              });
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:border-slate-400 disabled:opacity-50"
          >
            归档
          </button>
          <button
            type="button"
            disabled={deletePending}
            onClick={() => {
              setActionError(null);
              startDeleteTransition(async () => {
                const result = await deleteVocabularyWord(word.id, setId);
                if (!result.ok) setActionError(result.error);
              });
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-red-600 hover:border-red-400 disabled:opacity-50"
          >
            删除
          </button>
        </form>
        {state.error ? <p className="mt-1 text-sm text-red-600">{state.error}</p> : null}
        {actionError ? <p className="mt-1 text-sm text-red-600">{actionError}</p> : null}
      </td>
    </tr>
  );
}
