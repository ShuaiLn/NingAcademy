"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export type StartPracticeResult = { ok: false; error: string };

// start_practice_session() is idempotent: it resumes an already-open
// session for this (student, set) instead of creating a second one, so
// this same action covers both "开始练习" and "继续练习".
export async function startPracticeSession(setId: string): Promise<StartPracticeResult> {
  const supabase = await createClient();
  const { data: sessionId, error } = await supabase.rpc("start_practice_session", {
    p_set_id: setId,
  });

  if (error || !sessionId) {
    return { ok: false, error: "无法开始练习，请确认作业仍然有效" };
  }

  redirect(`/student/vocabulary/practice/${sessionId}`);
}

export type SubmitAttemptResult =
  | { ok: true; isCorrect: boolean; correctAnswer: string; wasAlreadyRecorded: boolean }
  | { ok: false; error: string };

export async function submitVocabularyAttempt(
  sessionId: string,
  wordId: string,
  submittedSpelling: string
): Promise<SubmitAttemptResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_vocabulary_attempt", {
    p_session_id: sessionId,
    p_word_id: wordId,
    p_submitted_spelling: submittedSpelling,
  });

  const row = data?.[0];
  if (error || !row) {
    return { ok: false, error: "提交失败，请稍后重试" };
  }

  return {
    ok: true,
    isCorrect: row.is_correct,
    correctAnswer: row.correct_answer,
    wasAlreadyRecorded: row.was_already_recorded,
  };
}

export type FinishPracticeResult = { ok: true } | { ok: false; error: string };

export async function finishPracticeSession(sessionId: string): Promise<FinishPracticeResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_practice_session", {
    p_session_id: sessionId,
  });

  if (error) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  return { ok: true };
}
