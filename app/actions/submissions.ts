"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export type CreateSubmissionResult = { ok: false; error: string };

// create_submission() is idempotent: it resumes an already-open draft for
// this (student, assignment) instead of creating a second one, so this same
// action covers both "开始提交" and "继续编辑草稿" -- mirrors
// startPracticeSession().
export async function createSubmission(assignmentId: string, note: string): Promise<CreateSubmissionResult> {
  const supabase = await createClient();
  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("assignment_kind")
    .eq("id", assignmentId)
    .maybeSingle();

  // Defense in depth for direct Server Action calls: a game assignment
  // cannot be routed into the legacy plain-submission RPC.
  if (assignmentError || !assignment || assignment.assignment_kind !== "plain") {
    return { ok: false, error: "这个作业不使用普通提交" };
  }

  const { data: submissionId, error } = await supabase.rpc("create_submission", {
    p_assignment_id: assignmentId,
    p_note: note,
  });

  if (error || !submissionId) {
    return { ok: false, error: "无法创建提交，请确认作业仍然有效" };
  }

  redirect(`/student/assignments/${assignmentId}/submissions/${submissionId}`);
}

export type FinishSubmissionResult = { ok: true } | { ok: false; error: string };

export async function finishSubmission(submissionId: string): Promise<FinishSubmissionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finish_submission", { p_submission_id: submissionId });

  if (error) {
    return { ok: false, error: "提交失败，请稍后重试" };
  }

  return { ok: true };
}
