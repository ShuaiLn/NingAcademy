"use client";

import { useActionState } from "react";
import { createStudent, type CreateStudentResult } from "@/app/actions/students";

const initialState: CreateStudentResult = { ok: false, error: "" };

export function CreateStudentForm() {
  const [state, formAction, pending] = useActionState(createStudent, initialState);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">添加学生</h2>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">用户名</span>
          <input
            name="username"
            type="text"
            required
            pattern="[A-Za-z0-9_-]{3,30}"
            className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">姓名</span>
          <input
            name="fullName"
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
          {pending ? "创建中…" : "创建学生"}
        </button>
      </form>
      {state.ok === false && state.error ? (
        <p className="text-sm text-red-600">{state.error}</p>
      ) : null}
      {state.ok === true ? (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          已创建学生 <strong>{state.username}</strong>，临时密码：
          <strong className="font-mono">{state.tempPassword}</strong>
          。请立即告知学生，此密码只显示这一次，学生首次登录后会被要求修改密码。
        </p>
      ) : null}
    </div>
  );
}
