"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  addPersonalWord,
  type AddPersonalWordResult,
} from "@/app/actions/personal-words";

const initialState: AddPersonalWordResult = { ok: false, error: "" };

export function WordForm() {
  const [state, formAction, pending] = useActionState(
    addPersonalWord,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-4 rounded-md border border-slate-200 p-4"
    >
      <h2 className="font-medium">添加生词</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">英文单词或短语</span>
          <input
            name="term"
            type="text"
            required
            maxLength={100}
            autoComplete="off"
            className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">中文释义（选填）</span>
          <input
            name="meaning"
            type="text"
            maxLength={1000}
            autoComplete="off"
            aria-describedby="personal-word-meaning-help"
            className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          />
          <span
            id="personal-word-meaning-help"
            className="text-xs text-slate-500"
          >
            重复添加同一个词时，留空会保留已有释义。
          </span>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? "添加中…" : "添加到生词库"}
        </button>
        <p aria-live="polite" className="text-sm">
          {state.ok ? (
            <span className="text-green-700">已保存。</span>
          ) : state.error ? (
            <span className="text-red-600">{state.error}</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
