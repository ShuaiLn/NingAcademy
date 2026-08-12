import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/supabase/database.types";
import { computeVocabularySessionCompletion } from "@/app/_lib/vocabulary-completion";

export type NextDueItem = {
  id: string;
  type: "vocabulary" | "assignment" | "pronunciation";
  title: string;
  dueAt: string;
  href: string;
};

export type NextDueItemResult = { ok: true; item: NextDueItem | null } | { ok: false; error: string };

const FAIL: NextDueItemResult = { ok: false, error: "无法加载到期提醒，请稍后重试" };

// Student-scoped sibling of app/teacher/_lib/due-items.ts's per-type query
// shape -- not a call into it, since that helper is teacher/multi-student
// shaped with teacher hrefs. students.id === profiles.id === auth.uid(),
// so every query below scopes directly to the caller's own id; RLS already
// restricts vocabulary_sets/assignments/pronunciation_tasks to what this
// student can see (assigned + published + not archived), so the parent
// queries need no explicit target join -- only the completion-check queries
// filter by student_id explicitly, for clarity (RLS would enforce it
// either way).
export async function getNextDueItem(supabase: SupabaseClient<Database>, studentId: string): Promise<NextDueItemResult> {
  const [setsRes, assignmentsRes, tasksRes] = await Promise.all([
    supabase.from("vocabulary_sets").select("id, title, due_at").is("archived_at", null).not("due_at", "is", null),
    supabase.from("assignments").select("id, title, due_at").is("archived_at", null).not("due_at", "is", null),
    supabase.from("pronunciation_tasks").select("id, title, due_at").is("archived_at", null).not("due_at", "is", null),
  ]);
  if (setsRes.error || assignmentsRes.error || tasksRes.error) {
    console.error("next-due-item: parent query failed", setsRes.error, assignmentsRes.error, tasksRes.error);
    return FAIL;
  }
  const sets = setsRes.data ?? [];
  const assignments = assignmentsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const setIds = sets.map((s) => s.id);
  const assignmentIds = assignments.map((a) => a.id);
  const taskIds = tasks.map((t) => t.id);
  if (setIds.length === 0 && assignmentIds.length === 0 && taskIds.length === 0) {
    return { ok: true, item: null };
  }

  const [sessionsRes, submissionsRes, audioRes] = await Promise.all([
    setIds.length === 0
      ? Promise.resolve({ data: [] as { id: string; set_id: string; completed_at: string | null; total_words: number; audio_word_count: number; vocabulary_attempts: { word_id: string; attempt_no: number; is_correct: boolean }[] }[], error: null })
      : supabase
          .from("practice_sessions")
          .select("id, set_id, completed_at, total_words, audio_word_count, vocabulary_attempts(word_id, attempt_no, is_correct)")
          .in("set_id", setIds)
          .eq("student_id", studentId),
    assignmentIds.length === 0
      ? Promise.resolve({ data: [] as { assignment_id: string; submitted_at: string | null }[], error: null })
      : supabase.from("submissions").select("assignment_id, submitted_at").in("assignment_id", assignmentIds).eq("student_id", studentId),
    taskIds.length === 0
      ? Promise.resolve({ data: [] as { task_id: string; submitted_at: string | null }[], error: null })
      : supabase.from("audio_submissions").select("task_id, submitted_at").in("task_id", taskIds).eq("student_id", studentId),
  ]);
  if (sessionsRes.error || submissionsRes.error || audioRes.error) {
    console.error("next-due-item: completion query failed", sessionsRes.error, submissionsRes.error, audioRes.error);
    return FAIL;
  }

  const sessionIds = (sessionsRes.data ?? []).map((s) => s.id);
  const audioSubsRes =
    sessionIds.length === 0
      ? { data: [] as { id: string; session_id: string }[], error: null }
      : await supabase.from("vocabulary_audio_submissions").select("id, session_id").in("session_id", sessionIds);
  if (audioSubsRes.error) {
    console.error("next-due-item: vocabulary audio submissions query failed", audioSubsRes.error);
    return FAIL;
  }
  const audioSubmissionIds = (audioSubsRes.data ?? []).map((a) => a.id);
  const audioFilesRes =
    audioSubmissionIds.length === 0
      ? { data: [] as { word_id: string; vocabulary_audio_submission_id: string }[], error: null }
      : await supabase
          .from("vocabulary_audio_submission_files")
          .select("word_id, vocabulary_audio_submission_id")
          .in("vocabulary_audio_submission_id", audioSubmissionIds);
  if (audioFilesRes.error) {
    console.error("next-due-item: vocabulary audio files query failed", audioFilesRes.error);
    return FAIL;
  }
  const sessionIdBySubmissionId = new Map((audioSubsRes.data ?? []).map((a) => [a.id, a.session_id]));
  const audioWordIdsBySession = new Map<string, string[]>();
  for (const f of audioFilesRes.data ?? []) {
    const sid = sessionIdBySubmissionId.get(f.vocabulary_audio_submission_id);
    if (!sid) continue;
    audioWordIdsBySession.set(sid, [...(audioWordIdsBySession.get(sid) ?? []), f.word_id]);
  }

  const vocabDoneSetIds = new Set<string>();
  for (const s of sessionsRes.data ?? []) {
    const attempts = (s.vocabulary_attempts ?? []).map((a) => ({ wordId: a.word_id, attemptNo: a.attempt_no, isCorrect: a.is_correct }));
    const completion = computeVocabularySessionCompletion(
      { totalWords: s.total_words, audioWordCount: s.audio_word_count, completedAt: s.completed_at },
      attempts,
      audioWordIdsBySession.get(s.id) ?? []
    );
    if (completion.completedFull) vocabDoneSetIds.add(s.set_id);
  }
  const assignmentDoneIds = new Set((submissionsRes.data ?? []).filter((s) => s.submitted_at).map((s) => s.assignment_id));
  const taskDoneIds = new Set((audioRes.data ?? []).filter((a) => a.submitted_at).map((a) => a.task_id));

  const items: NextDueItem[] = [
    ...sets.filter((s) => !vocabDoneSetIds.has(s.id)).map((s) => ({ id: s.id, type: "vocabulary" as const, title: s.title, dueAt: s.due_at!, href: `/student/vocabulary/${s.id}` })),
    ...assignments.filter((a) => !assignmentDoneIds.has(a.id)).map((a) => ({ id: a.id, type: "assignment" as const, title: a.title, dueAt: a.due_at!, href: `/student/assignments/${a.id}` })),
    ...tasks.filter((t) => !taskDoneIds.has(t.id)).map((t) => ({ id: t.id, type: "pronunciation" as const, title: t.title, dueAt: t.due_at!, href: `/student/pronunciation/${t.id}` })),
  ];

  items.sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0));

  return { ok: true, item: items[0] ?? null };
}
