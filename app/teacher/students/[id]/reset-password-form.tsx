"use client";

import { useActionState } from "react";
import { resetStudentPassword, type ResetPasswordResult } from "@/app/actions/students";

const initialState: ResetPasswordResult = { ok: false, error: "" };

export function ResetPasswordForm({ studentId }: { studentId: string }) {
  const [state, formAction, pending] = useActionState(resetStudentPassword, initialState);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">重设密码</h2>
      <p className="text-sm text-slate-600">
        会生成一个新的临时密码，学生下次登录时会被要求重新设置密码。
      </p>
      <form action={formAction}>
        <input type="hidden" name="studentId" value={studentId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? "处理中…" : "重设密码"}
        </button>
      </form>
      {state.ok === false && state.error ? (
        <p className="text-sm text-red-600">{state.error}</p>
      ) : null}
      {state.ok === true ? (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          新临时密码：<strong className="font-mono">{state.tempPassword}</strong>
          。请立即告知学生，此密码只显示这一次。
        </p>
      ) : null}
    </div>
  );
}
