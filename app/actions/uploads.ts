"use server";

import { createClient } from "@/utils/supabase/server";

export type UploadPurpose =
  | "assignment_file"
  | "submission_file"
  | "audio_submission_file"
  | "exam_score_file"
  | "lesson_summary_file"
  | "vocabulary_audio_submission_file";

export type BeginUploadResult =
  | { ok: true; intentId: string; storageObjectKey: string }
  | { ok: false; error: string };

// Metadata only -- the actual File never reaches this Server Action or any
// Next.js server code. Next.js caps Server Action request bodies at 1MB by
// default (node_modules/next/dist/docs/.../serverActions.md), far below
// what an assignment/submission/audio attachment can be. The calling client
// component uploads directly to Supabase Storage using
// utils/supabase/client.ts's browser client with the { intentId,
// storageObjectKey } this returns:
//
//   const { data } = await supabase.storage
//     .from("attachments")
//     .createSignedUploadUrl(storageObjectKey);
//   await supabase.storage.from("attachments").uploadToSignedUrl(data.path, data.token, file);
//   await finalizeUpload(intentId);
//
// See the classes_assignments_reading migration header for the full
// two-phase flow and its known limitations.
// purpose === "vocabulary_audio_submission_file" is the only branch that
// calls begin_upload_v2() (routing wordId to p_vocabulary_word_id); every
// other existing purpose keeps calling the original, completely unmodified
// begin_upload() exactly as today -- this branch is the only change to this
// function's existing behavior.
export async function beginUpload(
  purpose: UploadPurpose,
  subjectId: string,
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  wordId?: string
): Promise<BeginUploadResult> {
  const supabase = await createClient();

  const { data, error } =
    purpose === "vocabulary_audio_submission_file"
      ? await supabase.rpc("begin_upload_v2", {
          p_purpose: purpose,
          p_subject_id: subjectId,
          p_file_name: fileName,
          p_mime_type: mimeType,
          p_size_bytes: sizeBytes,
          // Generated Args type is `p_vocabulary_word_id?: string`
          // (undefined, not null) -- same PostgREST/supabase-js generator
          // quirk noted in 20260810234822_vocabulary_normalize_empty_description.
          p_vocabulary_word_id: wordId,
        })
      : await supabase.rpc("begin_upload", {
          p_purpose: purpose,
          p_subject_id: subjectId,
          p_file_name: fileName,
          p_mime_type: mimeType,
          p_size_bytes: sizeBytes,
          p_task_word_id: wordId,
        });

  const row = data?.[0];
  if (error || !row) {
    return { ok: false, error: "无法开始上传，请稍后重试" };
  }

  return { ok: true, intentId: row.intent_id, storageObjectKey: row.storage_object_key };
}

export type FinalizeUploadResult = { ok: true; fileId: string } | { ok: false; error: string };

// Idempotent on the server side: calling this again for an already-
// finalized intent returns the same fileId rather than erroring, so a
// client retry after a network timeout gets a definitive answer instead of
// "not sure if that worked." purpose must match whichever of
// begin_upload()/begin_upload_v2() minted this intent -- the original
// finalize_upload() has no branch for vocabulary_audio_submission_file, so
// routing here mirrors beginUpload()'s branch exactly.
export async function finalizeUpload(purpose: UploadPurpose, intentId: string): Promise<FinalizeUploadResult> {
  const supabase = await createClient();
  const { data: fileId, error } =
    purpose === "vocabulary_audio_submission_file"
      ? await supabase.rpc("finalize_upload_v2", { p_intent_id: intentId })
      : await supabase.rpc("finalize_upload", { p_intent_id: intentId });

  if (error || !fileId) {
    return { ok: false, error: "上传确认失败，请重试" };
  }

  return { ok: true, fileId };
}

export type CancelUploadResult = { ok: true } | { ok: false; error: string };

export async function cancelUpload(intentId: string): Promise<CancelUploadResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_upload", { p_intent_id: intentId });

  if (error) {
    return { ok: false, error: "取消失败，请稍后重试" };
  }

  return { ok: true };
}
