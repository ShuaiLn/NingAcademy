"use client";

import { useActionState } from "react";
import { updateClassName, type UpdateClassResult } from "@/app/actions/classes";

const initialState: UpdateClassResult = { ok: false, error: "" };

export function RenameForm({ classId, currentName }: { classId: string; currentName: string }) {
  const [state, formAction, pending] = useActionState(updateClassName, initialState);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">班级名称</h2>
      <form action={formAction} className="flex items-end gap-3">
        <input type="hidden" name="classId" value={classId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">名称</span>
          <input
            name="name"
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
