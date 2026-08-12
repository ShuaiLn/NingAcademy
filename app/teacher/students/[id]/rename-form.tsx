"use client";

import { useActionState } from "react";
import { updateStudentName, type UpdateNameResult } from "@/app/actions/students";

const initialState: UpdateNameResult = { ok: false, error: "" };

export function RenameForm({ studentId, currentName }: { studentId: string; currentName: string }) {
  const [state, formAction, pending] = useActionState(updateStudentName, initialState);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">姓名</h2>
      <form action={formAction} className="flex items-end gap-3">
        <input type="hidden" name="studentId" value={studentId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">姓名</span>
          <input
            name="fullName"
            type="text"
            required
            defaultValue={currentName}
            className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存"}
        </button>
      </form>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </div>
  );
}
