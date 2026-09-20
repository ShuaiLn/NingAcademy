"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { validateConfirmation } from "../_lib/ocr-import/validation";
import { PERSONAL_WORD_OCR_ENABLED } from "../_lib/ocr-import/feature";
export type ConfirmOcrResult = { ok: true; count: number } | { ok: false; error: string };
export async function confirmOcrWordsBulk(importId: unknown, input: unknown): Promise<ConfirmOcrResult> {
  const failure = { ok: false as const, error: "导入未完成，请检查所选内容后重试。" };
  try {
    if (!PERSONAL_WORD_OCR_ENABLED) return failure;
    const words = validateConfirmation(importId, input); if (!words) return failure;
    const client = await createClient();
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return failure;
    const { data, error } = await client.rpc("upsert_personal_words_bulk_v1", { p_ocr_import_id: importId as string, p_words: words.map(word => ({ ...word })) });
    if (error || !data || data.length !== words.length) return failure;
    revalidatePath("/student/personal-english");
    return { ok: true, count: data.length };
  } catch { return failure; }
}
