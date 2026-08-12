"use client";

import { useActionState } from "react";
import { updateAssignmentDetails, type UpdateAssignmentResult } from "@/app/actions/assignments";
import { DueDateInput } from "@/app/_components/due-date-input";

const initialState: UpdateAssignmentResult = { ok: false, error: "" };

export function EditAssignmentForm({
  assignment,
}: {
  assignment: { id: string; title: string; description: string | null; due_at: string | null };
}) {
  const [state, formAction, pending] = useActionState(updateAssignmentDetails, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">基本信息</h2>
      <input type="hidden" name="assignmentId" value={assignment.id} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">作业标题</span>
        <input
          name="title"
          type="text"
          required
          defaultValue={assignment.title}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">说明（可选）</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={assignment.description ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <DueDateInput defaultValue={assignment.due_at} />
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
