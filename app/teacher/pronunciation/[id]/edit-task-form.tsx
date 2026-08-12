"use client";

import { useActionState } from "react";
import { updatePronunciationTaskDetails, type UpdatePronunciationTaskResult } from "@/app/actions/pronunciation";
import { DueDateInput } from "@/app/_components/due-date-input";

const initialState: UpdatePronunciationTaskResult = { ok: false, error: "" };

export function EditTaskForm({
  task,
}: {
  task: { id: string; title: string; description: string | null; due_at: string | null };
}) {
  const [state, formAction, pending] = useActionState(updatePronunciationTaskDetails, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">基本信息</h2>
      <input type="hidden" name="taskId" value={task.id} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">任务标题</span>
        <input
          name="title"
          type="text"
          required
          defaultValue={task.title}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">说明（可选）</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={task.description ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <DueDateInput defaultValue={task.due_at} />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "保存中…" : "保存"}
      </button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
