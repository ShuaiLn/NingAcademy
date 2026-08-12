"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export type CreateAudioSubmissionResult = { ok: false; error: string };

// create_audio_submission() is idempotent: it resumes an already-open draft
// for this (student, task) instead of creating a second one -- mirrors
// createSubmission()/startPracticeSession().
export async function createAudioSubmission(taskId: string, note: string): Promise<CreateAudioSubmissionResult> {
  const supabase = await createClient();
  const { data: audioSubmissionId, error } = await supabase.rpc("create_audio_submission", {
    p_task_id: taskId,
    p_note: note,
  });

  if (error || !audioSubmissionId) {
    return { ok: false, error: "无法创建提交，请确认跟读任务仍然有效" };
  }

  redirect(`/student/pronunciation/${taskId}/submissions/${audioSubmissionId}`);
}

export type FinishAudioSubmissionResult = { ok: true } | { ok: false; error: string };

// finish_audio_submission() requires at least one attached audio file --
// see the migration comment on that RPC.
export async function finishAudioSubmission(audioSubmissionId: string): Promise<FinishAudioSubmissionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finish_audio_submission", {
    p_audio_submission_id: audioSubmissionId,
  });

  if (error) {
    return { ok: false, error: "提交失败，请确认至少已录制一段音频" };
  }

  return { ok: true };
}
