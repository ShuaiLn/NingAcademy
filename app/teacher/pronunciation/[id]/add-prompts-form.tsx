"use client";

import { useActionState } from "react";
import { addPronunciationTaskWords, type AddPronunciationTaskWordsResult } from "@/app/actions/pronunciation";
import { PromptRowsEditor } from "./prompt-rows-editor";

const initialState: AddPronunciationTaskWordsResult = { ok: false, error: "" };

export function AddPromptsForm({ taskId }: { taskId: string }) {
  const [state, formAction, pending] = useActionState(addPronunciationTaskWords, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">添加跟读内容</h2>
      <input type="hidden" name="taskId" value={taskId} />
      <PromptRowsEditor />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "添加中…" : "添加"}
      </button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
