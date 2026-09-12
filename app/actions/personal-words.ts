"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type AddPersonalWordResult =
  | { ok: true; wordId: string }
  | { ok: false; error: string };

// These are deliberately two RPC round-trips. If the provenance call fails,
// the normalized word upsert has already committed and is safe to retry.
export async function addPersonalWord(
  _prevState: AddPersonalWordResult,
  formData: FormData
): Promise<AddPersonalWordResult> {
  const term = String(formData.get("term") ?? "").trim();
  const meaning = String(formData.get("meaning") ?? "").trim();

  if (!term) {
    return { ok: false, error: "请填写英文单词或短语" };
  }

  if (term.length > 100) {
    return { ok: false, error: "英文单词或短语不能超过 100 个字符" };
  }

  if (meaning.length > 1000) {
    return { ok: false, error: "中文释义不能超过 1000 个字符" };
  }

  const supabase = await createClient();
  const { data: wordId, error: upsertError } = await supabase.rpc(
    "upsert_personal_word_v1",
    {
      p_term: term,
      ...(meaning ? { p_meaning: meaning } : {}),
    }
  );

  if (upsertError || !wordId) {
    return { ok: false, error: "添加失败，请稍后重试" };
  }

  const { error: attachError } = await supabase.rpc(
    "attach_personal_word_source_v1",
    {
      p_personal_word_id: wordId,
      p_source_type: "self_added",
    }
  );

  if (attachError) {
    revalidatePath("/student/personal-english");
    return { ok: false, error: "单词已保存，但记录来源失败，请重试" };
  }

  revalidatePath("/student/personal-english");
  return { ok: true, wordId };
}

export type ArchivePersonalWordResult =
  | { ok: true }
  | { ok: false; error: string };

export async function archivePersonalWord(
  wordId: string
): Promise<ArchivePersonalWordResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_personal_word_v1", {
    p_personal_word_id: wordId,
  });

  if (error) {
    return { ok: false, error: "归档失败，请稍后重试" };
  }

  revalidatePath("/student/personal-english");
  return { ok: true };
}
