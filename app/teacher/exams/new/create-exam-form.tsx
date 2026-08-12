"use client";

import { useActionState } from "react";
import { createExamWithStudents, type CreateExamResult } from "@/app/actions/exams";
import { TargetPicker } from "./target-picker";

const initialState: CreateExamResult = { ok: false, error: "" };

export function CreateExamForm({
  classes,
  students,
}: {
  classes: { id: string; name: string }[];
  students: { id: string; fullName: string }[];
}) {
  const [state, formAction, pending] = useActionState(createExamWithStudents, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">考试名称</span>
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
      <div className="flex gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">考试日期</span>
          <input
            name="examDate"
            type="date"
            required
            className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">满分（可选）</span>
          <input
            name="fullMarks"
            type="number"
            min="0"
            step="0.1"
            className="w-28 rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          />
        </label>
      </div>
      <TargetPicker classes={classes} students={students} />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "创建中…" : "创建考试"}
      </button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
