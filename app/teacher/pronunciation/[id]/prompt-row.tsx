"use client";

import { useActionState, useState, useTransition } from "react";
import {
  updatePronunciationTaskWord,
  archivePronunciationTaskWord,
  deletePronunciationTaskWord,
  type UpdatePronunciationTaskWordResult,
} from "@/app/actions/pronunciation";

const initialState: UpdatePronunciationTaskWordResult = { ok: false, error: "" };

// Mirrors app/teacher/vocabulary/[id]/word-row.tsx -- single text_prompt
// field, plus both 归档 (soft, always available) and 删除 (hard, only legal
// if never snapshotted into an audio_submission_files/upload_intents row --
// see deletePronunciationTaskWord's comment).
export function PromptRow({
  taskId,
  word,
}: {
  taskId: string;
  word: { id: string; text_prompt: string; archived_at: string | null };
}) {
  const [state, formAction, pending] = useActionState(updatePronunciationTaskWord, initialState);
  const [archivePending, startArchiveTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  if (word.archived_at) {
    return (
      <tr className="border-b border-slate-100 text-slate-400">
        <td className="py-2" colSpan={2}>
          {word.text_prompt}
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
          <input type="hidden" name="taskId" value={taskId} />
          <input
            name="textPrompt"
            type="text"
            defaultValue={word.text_prompt}
            className="w-64 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
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
                const result = await archivePronunciationTaskWord(word.id, taskId);
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
                const result = await deletePronunciationTaskWord(word.id, taskId);
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
