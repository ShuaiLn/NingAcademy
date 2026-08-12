"use client";

import { useActionState, useState, useTransition } from "react";
import {
  updateVocabularyWord,
  archiveVocabularyWord,
  deleteVocabularyWord,
  type UpdateVocabularyWordResult,
} from "@/app/actions/vocabulary";
import { AltMeaningsEditor } from "./alt-meanings-editor";

const initialState: UpdateVocabularyWordResult = { ok: false, error: "" };

export type EditableWord = {
  id: string;
  term: string;
  meaning: string;
  image_url: string | null;
  archived_at: string | null;
  override_show_english: boolean | null;
  override_show_chinese: boolean | null;
  override_play_audio: boolean | null;
  override_show_image: boolean | null;
  override_autoplay_audio: boolean | null;
  override_input_mode: string | null;
  altMeanings: string[];
};

// Tri-state (继承/是/否) <select> for one override_* column -- an empty
// selection must submit as "" so updateVocabularyWord's parseTriState()
// writes SQL NULL ("inherit the set default"), not false.
function TriStateSelect({ name, defaultValue, label }: { name: string; defaultValue: boolean | null; label: string }) {
  return (
    <label className="flex items-center gap-1 text-xs text-slate-600">
      {label}
      <select
        name={name}
        defaultValue={defaultValue === null ? "" : String(defaultValue)}
        className="rounded border border-slate-300 px-1 py-0.5 text-xs outline-none focus:border-slate-500"
      >
        <option value="">继承</option>
        <option value="true">是</option>
        <option value="false">否</option>
      </select>
    </label>
  );
}

// 归档 (soft) and 删除 (hard) are two distinct actions, not aliases -- 删除
// is always shown enabled (nothing legally queryable would tell this page
// in advance whether it would succeed) and only fails, with a friendly
// message, if the word has already been snapshotted into a practice
// session -- see deleteVocabularyWord's comment. Per-word override
// controls and the alt-meanings editor only render for v2 sets --
// meaningless on a v1 set, and rendering them there would invite the same
// silent-no-op problem edit-set-form.tsx avoids at the set level.
export function WordRow({
  setId,
  word,
  isV2,
}: {
  setId: string;
  word: EditableWord;
  isV2: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateVocabularyWord, initialState);
  const [archivePending, startArchiveTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [showOverrides, setShowOverrides] = useState(false);

  if (word.archived_at) {
    return (
      <tr className="border-b border-slate-100 text-slate-400">
        <td className="py-2" colSpan={2}>
          {word.term} / {word.meaning}
        </td>
        <td className="py-2">已归档</td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-slate-100">
      <td colSpan={3} className="py-2">
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="wordId" value={word.id} />
          <input type="hidden" name="setId" value={setId} />
          <input
            name="term"
            type="text"
            defaultValue={word.term}
            className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
          />
          <input
            name="meaning"
            type="text"
            defaultValue={word.meaning}
            className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
          />
          <input
            name="imageUrl"
            type="text"
            defaultValue={word.image_url ?? ""}
            placeholder="图片链接（可选）"
            className="w-48 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
          />

          {isV2 ? (
            <button
              type="button"
              onClick={() => setShowOverrides((v) => !v)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-400"
            >
              {showOverrides ? "收起个性化设置" : "个性化设置"}
            </button>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {pending ? "保存中…" : "保存"}
          </button>
          <button
            type="button"
            disabled={archivePending}
            onClick={() => {
              setActionError(null);
              startArchiveTransition(async () => {
                const result = await archiveVocabularyWord(word.id, setId);
                if (!result.ok) setActionError(result.error);
              });
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:border-slate-400 disabled:opacity-50"
          >
            归档
          </button>
          <button
            type="button"
            disabled={deletePending}
            onClick={() => {
              setActionError(null);
              startDeleteTransition(async () => {
                const result = await deleteVocabularyWord(word.id, setId);
                if (!result.ok) setActionError(result.error);
              });
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-red-600 hover:border-red-400 disabled:opacity-50"
          >
            删除
          </button>

          {isV2 && showOverrides ? (
            <div className="flex w-full flex-col gap-2 rounded-md bg-slate-50 p-2">
              <p className="text-xs text-slate-500">未设置（继承）时使用作业的默认设置。这些控件属于上面同一个表单，点击"保存"一并生效。</p>
              <div className="flex flex-wrap gap-3">
                <TriStateSelect name="overrideShowEnglish" defaultValue={word.override_show_english} label="显示英文" />
                <TriStateSelect name="overrideShowChinese" defaultValue={word.override_show_chinese} label="显示中文" />
                <TriStateSelect name="overrideShowImage" defaultValue={word.override_show_image} label="显示图片" />
                <TriStateSelect name="overridePlayAudio" defaultValue={word.override_play_audio} label="朗读发音" />
                <TriStateSelect name="overrideAutoplayAudio" defaultValue={word.override_autoplay_audio} label="自动朗读" />
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  输入方式
                  <select
                    name="overrideInputMode"
                    defaultValue={word.override_input_mode ?? ""}
                    className="rounded border border-slate-300 px-1 py-0.5 text-xs outline-none focus:border-slate-500"
                  >
                    <option value="">继承</option>
                    <option value="type_english">拼写英文</option>
                    <option value="type_chinese">填写中文</option>
                    <option value="audio">朗读录音</option>
                  </select>
                </label>
              </div>
            </div>
          ) : null}
        </form>

        {isV2 && showOverrides ? (
          <div className="mt-2">
            <AltMeaningsEditor wordId={word.id} setId={setId} initialAltMeanings={word.altMeanings} />
          </div>
        ) : null}

        {state.error ? <p className="mt-1 text-sm text-red-600">{state.error}</p> : null}
        {actionError ? <p className="mt-1 text-sm text-red-600">{actionError}</p> : null}
      </td>
    </tr>
  );
}
