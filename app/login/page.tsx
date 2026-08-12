"use client";

import { useActionState } from "react";
import { login, type LoginResult } from "@/app/actions/auth";

const initialState: LoginResult = { ok: false, error: "" };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">NingAcademy</h1>
        <p className="mt-2 text-sm text-slate-600">请输入用户名和密码登录。</p>
      </div>
      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">用户名</span>
          <input
            name="username"
            type="text"
            required
            autoComplete="username"
            className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">密码</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          />
        </label>
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-white transition-opacity disabled:opacity-50"
        >
          {pending ? "登录中…" : "登录"}
        </button>
      </form>
    </main>
  );
}
