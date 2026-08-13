"use client";

import { useActionState } from "react";
import { addVocabularyWords, type AddVocabularyWordsResult } from "@/app/actions/vocabulary";
import { WordRowsEditor } from "../word-rows-editor";

const initialState: AddVocabularyWordsResult = { ok: false, error: "" };

export function AddWordsForm({ setId, isV2, inputMode }: { setId: string; isV2: boolean; inputMode: string }) {
  const [state, formAction, pending] = useActionState(addVocabularyWords, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">添加单词</h2>
      <input type="hidden" name="setId" value={setId} />
      <WordRowsEditor isV2={isV2} inputMode={inputMode} />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "添加中…" : "添加"}
      </button>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
