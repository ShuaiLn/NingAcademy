"use client";

import { useActionState } from "react";
import { setupTeacher, type SetupTeacherResult } from "@/app/actions/setup";

const initialState: SetupTeacherResult = { ok: false, error: "" };

export default function SetupPage() {
  const [state, formAction, pending] = useActionState(setupTeacher, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">创建教师账号</h1>
        <p className="mt-2 text-sm text-slate-600">
          仅用于首次部署时创建教师账号（最多 3 个），需要部署密钥（SETUP_TOKEN）。
        </p>
      </div>
      <form action={formAction} className="flex flex-col gap-4">
        <Field label="部署密钥 (SETUP_TOKEN)" name="setupToken" type="password" required />
        <Field
          label="用户名"
          name="username"
          type="text"
          required
          pattern="[A-Za-z0-9_-]{3,30}"
          autoComplete="username"
        />
        <Field label="姓名" name="fullName" type="text" required autoComplete="name" />
        <Field
          label="密码"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-white transition-opacity disabled:opacity-50"
        >
          {pending ? "创建中…" : "创建教师账号"}
        </button>
      </form>
    </main>
  );
}

function Field({
  label,
  name,
  type,
  required,
  pattern,
  minLength,
  autoComplete,
}: {
  label: string;
  name: string;
  type: string;
  required?: boolean;
  pattern?: string;
  minLength?: number;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        pattern={pattern}
        minLength={minLength}
        autoComplete={autoComplete}
        className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
      />
    </label>
  );
}
