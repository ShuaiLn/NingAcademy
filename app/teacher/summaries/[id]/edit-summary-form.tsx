"use client";

import { useActionState } from "react";
import { updateLessonSummaryContent, type UpdateLessonSummaryResult } from "@/app/actions/summaries";

const initialState: UpdateLessonSummaryResult = { ok: false, error: "" };

export function EditSummaryForm({
  summary,
}: {
  summary: { id: string; title: string | null; content: string; session_date: string };
}) {
  const [state, formAction, pending] = useActionState(updateLessonSummaryContent, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">基本信息</h2>
      <input type="hidden" name="summaryId" value={summary.id} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">标题（可选）</span>
        <input
          name="title"
          type="text"
          defaultValue={summary.title ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">总结内容</span>
        <textarea
          name="content"
          rows={5}
          required
          defaultValue={summary.content}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">课程日期</span>
        <input
          name="sessionDate"
          type="date"
          required
          defaultValue={summary.session_date}
          className="w-fit rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
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
