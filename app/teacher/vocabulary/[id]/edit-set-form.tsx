"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import {
  updateVocabularySetDetails,
  updateVocabularySetDetailsV2,
  upgradeVocabularySetToV2,
  type UpdateVocabularySetResult,
  type UpdateVocabularySetV2Result,
} from "@/app/actions/vocabulary";
import { DueDateInput } from "@/app/_components/due-date-input";

const initialStateV1: UpdateVocabularySetResult = { ok: false, error: "" };
const initialStateV2: UpdateVocabularySetV2Result = { ok: false, error: "" };

export type EditableSet = {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  practice_engine_version: number;
  // v1 fields
  prompt_field: string;
  show_image: boolean;
  audio_only: boolean;
  // v2 fields
  display_show_english: boolean;
  display_show_chinese: boolean;
  display_play_audio: boolean;
  display_autoplay_audio: boolean;
  input_mode: string;
  word_order: string;
  allow_student_order_choice: boolean;
};

// Every set created before this feature shipped is practice_engine_version
// = 1; only the new creation form ever produces version 2. A v1 set's
// practice sessions run through the v1 engine, which has no concept of
// input_mode/per-word overrides/order randomization/audio -- so editing
// those fields on a v1 set and saving them through updateVocabularySetDetailsV2
// would succeed while having zero effect on how students actually practice
// it (v1 never reads those columns). This component renders one of two
// forms based on practice_engine_version specifically to make that
// silent-no-op impossible, not merely undocumented.
export function EditSetForm({ set }: { set: EditableSet }) {
  if (set.practice_engine_version === 2) {
    return <EditSetFormV2 set={set} />;
  }
  return <EditSetFormV1 set={set} />;
}

function EditSetFormV1({ set }: { set: EditableSet }) {
  const [state, formAction, pending] = useActionState(updateVocabularySetDetails, initialStateV1);
  const [promptField, setPromptField] = useState<"meaning" | "term">(set.prompt_field === "term" ? "term" : "meaning");
  const [upgradePending, startUpgradeTransition] = useTransition();
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
        <h2 className="font-medium">基本信息（旧版词汇作业）</h2>
        <input type="hidden" name="setId" value={set.id} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">作业标题</span>
          <input
            name="title"
            type="text"
            required
            defaultValue={set.title}
            className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-700">说明（可选）</span>
          <textarea
            name="description"
            rows={2}
            defaultValue={set.description ?? ""}
            className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          />
        </label>

        <div className="flex flex-col gap-3 sm:grid sm:grid-cols-2 sm:gap-4">
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
              显示释义，拼写单词
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
              <input type="checkbox" name="showImage" defaultChecked={set.show_image} />
              允许显示图片
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="audioOnly" defaultChecked={set.audio_only} />
              仅朗读提示（不显示文字，学生点击按钮朗读）
            </label>
          </div>
        </div>

        <DueDateInput defaultValue={set.due_at} />

        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存"}
        </button>
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      </form>

      <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">升级为新版可支持朗读录音、多译文匹配、乱序练习等新功能。</p>
        <button
          type="button"
          disabled={upgradePending}
          onClick={() => {
            setUpgradeError(null);
            startUpgradeTransition(async () => {
              const result = await upgradeVocabularySetToV2(set.id);
              if (!result.ok) setUpgradeError(result.error);
            });
          }}
          className="w-fit rounded-md bg-amber-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {upgradePending ? "升级中…" : "升级为新版（支持朗读录音、多译文、乱序练习等）"}
        </button>
        {upgradeError ? <p className="text-sm text-red-600">{upgradeError}</p> : null}
      </div>
    </div>
  );
}

type InputMode = "type_english" | "type_chinese" | "audio";

function EditSetFormV2({ set }: { set: EditableSet }) {
  const [state, formAction, pending] = useActionState(updateVocabularySetDetailsV2, initialStateV2);
  const [inputMode, setInputMode] = useState<InputMode>(
    set.input_mode === "type_chinese" || set.input_mode === "audio" ? (set.input_mode as InputMode) : "type_english"
  );
  const [showEnglish, setShowEnglish] = useState(set.display_show_english);
  const [showChinese, setShowChinese] = useState(set.display_show_chinese);
  const [showImage, setShowImage] = useState(set.show_image);
  const [playAudio, setPlayAudio] = useState(set.display_play_audio);
  const [autoplayAudio, setAutoplayAudio] = useState(set.display_autoplay_audio);
  const [allowOrderChoice, setAllowOrderChoice] = useState(set.allow_student_order_choice);

  const effectiveShowEnglish = inputMode === "type_english" ? false : showEnglish;
  const effectiveShowChinese = inputMode === "type_chinese" ? false : showChinese;
  const effectivePlayAudio = inputMode === "audio" ? false : playAudio;
  const effectiveAutoplay = effectivePlayAudio ? autoplayAudio : false;

  const hasAnyCue = useMemo(
    () => effectiveShowEnglish || effectiveShowChinese || effectivePlayAudio || showImage,
    [effectiveShowEnglish, effectiveShowChinese, effectivePlayAudio, showImage]
  );

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">基本信息</h2>
      <input type="hidden" name="setId" value={set.id} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">作业标题</span>
        <input
          name="title"
          type="text"
          required
          defaultValue={set.title}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">说明（可选）</span>
        <textarea
          name="description"
          rows={2}
          defaultValue={set.description ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>

      <div className="flex flex-col gap-3 sm:grid sm:grid-cols-2 sm:gap-4">
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

      <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
        <span className="text-sm font-medium text-slate-700">单词顺序</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="wordOrder" value="sequential" defaultChecked={set.word_order !== "random"} />
          按老师设定的顺序
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="wordOrder" value="random" defaultChecked={set.word_order === "random"} />
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

      <DueDateInput defaultValue={set.due_at} />

      <button
        type="submit"
        disabled={pending || !hasAnyCue}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "保存中…" : "保存"}
      </button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
