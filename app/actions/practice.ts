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

// ============================================================================
// v2 -- retry-until-correct engine. get_practice_session_state_v2() /
// get_practice_words_v2() are deliberately NOT exposed here: both are
// called exactly once, server-side, by
// app/student/vocabulary/practice/[sessionId]/page.tsx's own Supabase
// client (mirroring exactly how v1's page.tsx already calls
// get_practice_words server-side) -- the retry queue lives entirely in
// client-side React state for the duration of one page visit, so there is
// nothing for a client action to fetch.
// ============================================================================

export type StartPracticeResultV2 = { ok: false; error: string };

export async function startPracticeSessionV2(setId: string): Promise<StartPracticeResultV2> {
  const supabase = await createClient();
  const { data: sessionId, error } = await supabase.rpc("start_practice_session_v2", {
    p_set_id: setId,
  });

  if (error || !sessionId) {
    return { ok: false, error: "无法开始练习，请确认作业仍然有效" };
  }

  redirect(`/student/vocabulary/practice/${sessionId}`);
}

export type SubmitAttemptV2Result =
  | { ok: true; isCorrect: boolean; correctAnswers: string[]; wasAlreadyRecorded: boolean; attemptNo: number | null }
  | { ok: false; error: string };

export async function submitVocabularyAttemptV2(
  sessionId: string,
  wordId: string,
  submittedSpelling: string
): Promise<SubmitAttemptV2Result> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_vocabulary_attempt_v2", {
    p_session_id: sessionId,
    p_word_id: wordId,
    p_submitted_spelling: submittedSpelling,
  });

  if (error) {
    console.error("record_vocabulary_attempt_v2 failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return { ok: false, error: "提交失败，请稍后重试" };
  }

  const row = data?.[0];
  if (!row) {
    return { ok: false, error: "提交失败，请稍后重试" };
  }

  return {
    ok: true,
    isCorrect: row.is_correct,
    correctAnswers: row.correct_answers,
    wasAlreadyRecorded: row.was_already_recorded,
    attemptNo: row.attempt_no,
  };
}

export type FinishPracticeResultV2 = { ok: true } | { ok: false; error: string };

export async function finishPracticeSessionV2(sessionId: string): Promise<FinishPracticeResultV2> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_practice_session_v2", {
    p_session_id: sessionId,
  });

  if (error) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  return { ok: true };
}

export type StartVocabularyAudioSubmissionResult =
  | { ok: true; audioSubmissionId: string }
  | { ok: false; error: string };

export async function startVocabularyAudioSubmission(sessionId: string): Promise<StartVocabularyAudioSubmissionResult> {
  const supabase = await createClient();
  const { data: audioSubmissionId, error } = await supabase.rpc("create_vocabulary_audio_submission", {
    p_session_id: sessionId,
  });

  if (error || !audioSubmissionId) {
    return { ok: false, error: "无法开始录音，请稍后重试" };
  }

  return { ok: true, audioSubmissionId };
}

export type SetPracticeSessionWordOrderResult = { ok: true } | { ok: false; error: string };

// Used exactly once per session, before the first word is presented -- the
// RPC itself refuses a second call.
export async function setPracticeSessionWordOrder(
  sessionId: string,
  order: "sequential" | "random"
): Promise<SetPracticeSessionWordOrderResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_practice_session_word_order", {
    p_session_id: sessionId,
    p_word_order: order,
  });

  if (error) {
    return { ok: false, error: "设置失败，请稍后重试" };
  }

  return { ok: true };
}
