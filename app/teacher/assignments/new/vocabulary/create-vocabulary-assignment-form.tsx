"use client";

import { useActionState, useState } from "react";
import { createAndPublishVocabularySet, type CreateAndPublishVocabularySetResult } from "@/app/actions/vocabulary";
import { DueDateInput } from "@/app/_components/due-date-input";
import { TargetPicker } from "./target-picker";

const initialState: CreateAndPublishVocabularySetResult = { ok: false, error: "" };

export function CreateVocabularyAssignmentForm({ students }: { students: { id: string; fullName: string }[] }) {
  const [state, formAction, pending] = useActionState(createAndPublishVocabularySet, initialState);
  const [promptField, setPromptField] = useState<"meaning" | "term">("meaning");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">作业标题</span>
        <input
          name="title"
          type="text"
          required
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">说明（可选）</span>
        <textarea
          name="description"
          rows={2}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>

      <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4 sm:grid sm:grid-cols-2 sm:gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">练习模式</span>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="promptField"
              value="meaning"
              checked={promptField === "meaning"}
              onChange={() => setPromptField("meaning")}
            />
            显示释义，拼写单词（默认）
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="promptField"
              value="term"
              checked={promptField === "term"}
              onChange={() => setPromptField("term")}
            />
            显示单词，填写释义
          </label>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">附加选项</span>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="showImage" defaultChecked />
            允许显示图片
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="audioOnly" />
            仅朗读提示（不显示文字，学生点击按钮朗读）
          </label>
        </div>
      </div>

      <DueDateInput />
      <TargetPicker students={students} />

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "发布中…" : "发布作业"}
      </button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
