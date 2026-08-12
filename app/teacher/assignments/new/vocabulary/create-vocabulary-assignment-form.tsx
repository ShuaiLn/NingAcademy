"use client";

import { useActionState, useMemo, useState } from "react";
import { createAndPublishVocabularySetV2, type CreateAndPublishVocabularySetV2Result } from "@/app/actions/vocabulary";
import { DueDateInput } from "@/app/_components/due-date-input";
import { TargetPicker } from "./target-picker";

const initialState: CreateAndPublishVocabularySetV2Result = { ok: false, error: "" };

type InputMode = "type_english" | "type_chinese" | "audio";

// Every set created through this form is version 2 (create_and_publish_
// vocabulary_set_v2). Display content is multi-select -- any combination of
// show English / show Chinese / play audio / show image is legal except
// showing a field as plain text while also grading it, which this form
// coerces away client-side for instant feedback (the database CHECK
// constraints are the authoritative enforcement -- see the migration).
export function CreateVocabularyAssignmentForm({ students }: { students: { id: string; fullName: string }[] }) {
  const [state, formAction, pending] = useActionState(createAndPublishVocabularySetV2, initialState);
  const [inputMode, setInputMode] = useState<InputMode>("type_english");
  const [showEnglish, setShowEnglish] = useState(false);
  const [showChinese, setShowChinese] = useState(true);
  const [showImage, setShowImage] = useState(true);
  const [playAudio, setPlayAudio] = useState(false);
  const [autoplayAudio, setAutoplayAudio] = useState(false);
  const [allowOrderChoice, setAllowOrderChoice] = useState(false);

  // Self-defeating-combo coercion, mirroring the server-side CHECK
  // constraints: a word's graded field is never also shown as plain text.
  const effectiveShowEnglish = inputMode === "type_english" ? false : showEnglish;
  const effectiveShowChinese = inputMode === "type_chinese" ? false : showChinese;
  const effectivePlayAudio = inputMode === "audio" ? false : playAudio;
  const effectiveAutoplay = effectivePlayAudio ? autoplayAudio : false;

  const hasAnyCue = useMemo(
    () => effectiveShowEnglish || effectiveShowChinese || effectivePlayAudio || showImage,
    [effectiveShowEnglish, effectiveShowChinese, effectivePlayAudio, showImage]
  );

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
          <span className="text-sm font-medium text-slate-700">输入方式</span>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="inputMode"
              value="type_english"
              checked={inputMode === "type_english"}
              onChange={() => setInputMode("type_english")}
            />
            拼写英文单词
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="inputMode"
              value="type_chinese"
              checked={inputMode === "type_chinese"}
              onChange={() => setInputMode("type_chinese")}
            />
            填写中文释义
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="inputMode"
              value="audio"
              checked={inputMode === "audio"}
              onChange={() => setInputMode("audio")}
            />
            朗读并录音
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">显示内容</span>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="displayShowEnglish"
              checked={effectiveShowEnglish}
              disabled={inputMode === "type_english"}
              onChange={(e) => setShowEnglish(e.target.checked)}
            />
            显示英文
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="displayShowChinese"
              checked={effectiveShowChinese}
              disabled={inputMode === "type_chinese"}
              onChange={(e) => setShowChinese(e.target.checked)}
            />
            显示中文
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="showImage" checked={showImage} onChange={(e) => setShowImage(e.target.checked)} />
            允许显示图片
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="displayPlayAudio"
              checked={effectivePlayAudio}
              disabled={inputMode === "audio"}
              onChange={(e) => setPlayAudio(e.target.checked)}
            />
            朗读发音
          </label>
          {effectivePlayAudio ? (
            <label className="ml-6 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                name="displayAutoplayAudio"
                checked={effectiveAutoplay}
                onChange={(e) => setAutoplayAudio(e.target.checked)}
              />
              题目出现时自动朗读
            </label>
          ) : null}
          {!hasAnyCue ? <p className="text-xs text-red-600">请至少启用一种展示内容</p> : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
        <span className="text-sm font-medium text-slate-700">单词顺序</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="wordOrder" value="sequential" defaultChecked />
          按老师设定的顺序
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="wordOrder" value="random" />
          随机顺序
        </label>
        <label className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="allowStudentOrderChoice"
            checked={allowOrderChoice}
            onChange={(e) => setAllowOrderChoice(e.target.checked)}
          />
          允许学生自行选择顺序
        </label>
      </div>

      <DueDateInput />
      <TargetPicker students={students} />

      <button
        type="submit"
        disabled={pending || !hasAnyCue}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "发布中…" : "发布作业"}
      </button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
