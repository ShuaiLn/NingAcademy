"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type GradeSubmissionResult = { ok: true } | { ok: false; error: string };

// submissions has no UPDATE RLS reach at all while submitted_at is null
// (see submissions_teacher_update_graded_fields) -- a still-open draft
// comes back as a 0-row RLS mismatch here, same shape as setStudentActive's
// ownership check. The UI is responsible for disabling "批改" on a draft so
// a teacher does not hit an unexplained no-op.
export async function gradeSubmission(
  submissionId: string,
  score: number | null,
  feedbackText: string
): Promise<GradeSubmissionResult> {
  if (score !== null && (Number.isNaN(score) || score < 0)) {
    return { ok: false, error: "分数格式不正确" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("submissions")
    .update({ score, feedback_text: feedbackText || null }, { count: "exact" })
    .eq("id", submissionId);

  if (error || !count) {
    return { ok: false, error: "批改失败，该提交可能尚未提交" };
  }

  revalidatePath("/teacher/assignments");
  return { ok: true };
}

export type GradeAudioSubmissionResult = { ok: true } | { ok: false; error: string };

export async function gradeAudioSubmission(
  audioSubmissionId: string,
  score: number | null,
  feedbackText: string
): Promise<GradeAudioSubmissionResult> {
  if (score !== null && (Number.isNaN(score) || score < 0)) {
    return { ok: false, error: "分数格式不正确" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("audio_submissions")
    .update({ score, feedback_text: feedbackText || null }, { count: "exact" })
    .eq("id", audioSubmissionId);

  if (error || !count) {
    return { ok: false, error: "批改失败，该提交可能尚未提交" };
  }

  revalidatePath("/teacher/pronunciation");
  return { ok: true };
}
