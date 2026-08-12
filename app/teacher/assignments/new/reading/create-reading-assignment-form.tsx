"use client";

import { useActionState } from "react";
import {
  createAndPublishPronunciationTask,
  type CreateAndPublishPronunciationTaskResult,
} from "@/app/actions/pronunciation";
import { DueDateInput } from "@/app/_components/due-date-input";
import { TargetPicker } from "./target-picker";

const initialState: CreateAndPublishPronunciationTaskResult = { ok: false, error: "" };

export function CreateReadingAssignmentForm({
  classes,
  students,
}: {
  classes: { id: string; name: string }[];
  students: { id: string; fullName: string }[];
}) {
  const [state, formAction, pending] = useActionState(createAndPublishPronunciationTask, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">作业标题</span>
        <input
          name="title"
          type="text"
          required
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">说明（可选）</span>
        <textarea
          name="description"
          rows={3}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <DueDateInput />
      <TargetPicker classes={classes} students={students} />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "发布中…" : "发布作业"}
      </button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
