"use client";

import { useActionState } from "react";
import { createLessonSummaryWithStudents, type CreateLessonSummaryResult } from "@/app/actions/summaries";
import { TargetPicker } from "./target-picker";

const initialState: CreateLessonSummaryResult = { ok: false, error: "" };

export function CreateSummaryForm({
  classes,
  students,
}: {
  classes: { id: string; name: string }[];
  students: { id: string; fullName: string }[];
}) {
  const [state, formAction, pending] = useActionState(createLessonSummaryWithStudents, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">标题（可选）</span>
        <input
          name="title"
          type="text"
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">总结内容</span>
        <textarea
          name="content"
          rows={5}
          required
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">课程日期</span>
        <input
          name="sessionDate"
          type="date"
          required
          className="w-fit rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <TargetPicker classes={classes} students={students} />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "创建中…" : "创建总结"}
      </button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
