"use client";

import { useActionState } from "react";
import { updateExamDetails, type UpdateExamResult } from "@/app/actions/exams";

const initialState: UpdateExamResult = { ok: false, error: "" };

export function EditExamForm({
  exam,
}: {
  exam: { id: string; title: string; description: string | null; exam_date: string; full_marks: number | null };
}) {
  const [state, formAction, pending] = useActionState(updateExamDetails, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">基本信息</h2>
      <input type="hidden" name="examId" value={exam.id} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">考试名称</span>
        <input
          name="title"
          type="text"
          required
          defaultValue={exam.title}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">说明（可选）</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={exam.description ?? ""}
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
            defaultValue={exam.exam_date}
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
            defaultValue={exam.full_marks ?? ""}
            className="w-28 rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          />
        </label>
      </div>
      <p className="text-xs text-slate-400">修改日期不会重新计算已添加的学生名单。</p>
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
