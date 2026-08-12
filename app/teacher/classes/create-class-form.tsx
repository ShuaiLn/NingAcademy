"use client";

import { useActionState } from "react";
import { createClass, type CreateClassResult } from "@/app/actions/classes";

const initialState: CreateClassResult = { ok: false, error: "" };

export function CreateClassForm() {
  const [state, formAction, pending] = useActionState(createClass, initialState);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">新建班级</h2>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">班级名称</span>
          <input
            name="name"
            type="text"
            required
            className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? "创建中…" : "创建班级"}
        </button>
      </form>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </div>
  );
}
