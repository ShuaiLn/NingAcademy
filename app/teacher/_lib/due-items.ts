import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/supabase/database.types";
import { computeVocabularySessionCompletion } from "@/app/_lib/vocabulary-completion";
import { getGameAssignmentCompletion } from "@/app/_lib/game-main-site";

export type ItemType = "vocabulary" | "assignment" | "game" | "pronunciation";

export type DueItem = {
  id: string;
  type: ItemType;
  title: string;
  dueAt: string;
  href: string;
  incompleteStudentIds: string[];
};

export type DueItemsResult = { ok: true; items: DueItem[] } | { ok: false; error: string };

const FAIL: DueItemsResult = { ok: false, error: "无法加载到期提醒，请稍后重试" };

type VocabTargetRow = { set_id: string; student_id: string };
type ClassScopedTargetRow = { class_id: string | null; student_id: string | null };
type AssignmentTargetRow = ClassScopedTargetRow & { assignment_id: string };
type PronunciationTargetRow = ClassScopedTargetRow & { task_id: string };
type EnrollmentRow = { class_id: string; student_id: string };
type SessionRow = {
  id: string;
  student_id: string;
  set_id: string;
  completed_at: string | null;
  total_words: number;
  audio_word_count: number;
  vocabulary_attempts: { word_id: string; attempt_no: number; is_correct: boolean }[];
};
type AudioSubmissionRow = { id: string; session_id: string };
type AudioFileRow = { word_id: string; vocabulary_audio_submission_id: string };
type SubmissionRow = { student_id: string; assignment_id: string; submitted_at: string | null };
type AudioRow = { student_id: string; task_id: string; submitted_at: string | null };

// Every "recent state" surface in this app (see AGENTS.md) aggregates
// RLS-scoped reads in JS rather than through a dedicated RPC/view -- this
// helper follows the same shape. Every query below explicitly checks
// `error` (a failure here must never silently read as "nothing due"), and
// every `.in(column, ids)` call is guarded against an empty `ids` array.
export async function getDueItemsWithIncompleteStudents(
  supabase: SupabaseClient<Database>,
  opts: { studentId?: string; dueBefore?: string; dueSince?: string } = {}
): Promise<DueItemsResult> {
  let setsQuery = supabase.from("vocabulary_sets").select("id, title, due_at").is("archived_at", null).not("due_at", "is", null);
  let assignmentsQuery = supabase.from("assignments").select("id, title, due_at, assignment_kind").is("archived_at", null).not("due_at", "is", null);
  let tasksQuery = supabase.from("pronunciation_tasks").select("id, title, due_at").is("archived_at", null).not("due_at", "is", null);
  if (opts.dueBefore) {
    setsQuery = setsQuery.lte("due_at", opts.dueBefore);
    assignmentsQuery = assignmentsQuery.lte("due_at", opts.dueBefore);
    tasksQuery = tasksQuery.lte("due_at", opts.dueBefore);
  }
  if (opts.dueSince) {
    setsQuery = setsQuery.gte("due_at", opts.dueSince);
    assignmentsQuery = assignmentsQuery.gte("due_at", opts.dueSince);
    tasksQuery = tasksQuery.gte("due_at", opts.dueSince);
  }

  const [setsRes, assignmentsRes, tasksRes] = await Promise.all([setsQuery, assignmentsQuery, tasksQuery]);
  if (setsRes.error || assignmentsRes.error || tasksRes.error) {
    console.error("due-items: parent query failed", setsRes.error, assignmentsRes.error, tasksRes.error);
    return FAIL;
  }
  const sets = setsRes.data ?? [];
  const assignments = assignmentsRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const setIds = sets.map((s) => s.id);
  const assignmentIds = assignments.map((a) => a.id);
  const plainAssignmentIds = assignments.filter((a) => a.assignment_kind === "plain").map((a) => a.id);
  const gameAssignmentIds = assignments.filter((a) => a.assignment_kind === "game").map((a) => a.id);
  const taskIds = tasks.map((t) => t.id);
  if (setIds.length === 0 && assignmentIds.length === 0 && taskIds.length === 0) return { ok: true, items: [] };

  // Active-student check -- scoped to the one requested student when given.
  const activeRes = opts.studentId
    ? await supabase.from("students").select("id, profiles(is_active)").eq("id", opts.studentId)
    : await supabase.from("students").select("id, profiles(is_active)");
  if (activeRes.error) {
    console.error("due-items: active-student query failed", activeRes.error);
    return FAIL;
  }
  const activeIds = new Set((activeRes.data ?? []).filter((s) => s.profiles?.is_active).map((s) => s.id));

  // This student's current classes -- only fetched when scoping to one
  // student (needed to build their OR-clause below).
  let myClassIds: string[] = [];
  if (opts.studentId) {
    const { data, error } = await supabase
      .from("enrollments")
      .select("class_id")
      .eq("student_id", opts.studentId)
      .is("unenrolled_at", null);
    if (error) {
      console.error("due-items: enrollments query failed", error);
      return FAIL;
    }
    myClassIds = (data ?? []).map((e) => e.class_id);
  }

  const vocabTargetsQuery =
    setIds.length === 0
      ? Promise.resolve({ data: [] as VocabTargetRow[], error: null })
      : opts.studentId
        ? supabase.from("vocabulary_targets").select("set_id, student_id").in("set_id", setIds).eq("student_id", opts.studentId).is("revoked_at", null)
        : supabase.from("vocabulary_targets").select("set_id, student_id").in("set_id", setIds).is("revoked_at", null);

  function targetsQuery(table: "assignment_targets" | "pronunciation_targets", idColumn: "assignment_id" | "task_id", ids: string[]) {
    if (ids.length === 0) return Promise.resolve({ data: [] as ClassScopedTargetRow[], error: null });
    let q = supabase.from(table).select(`${idColumn}, class_id, student_id`).in(idColumn, ids).is("revoked_at", null);
    if (opts.studentId) {
      const clause = [
        "student_id.eq." + opts.studentId,
        ...(myClassIds.length ? [`class_id.in.(${myClassIds.join(",")})`] : []),
      ].join(",");
      q = q.or(clause);
    }
    return q;
  }

  const [vocabTargetsRes, assignmentTargetsRes, pronunciationTargetsRes] = await Promise.all([
    vocabTargetsQuery,
    targetsQuery("assignment_targets", "assignment_id", assignmentIds),
    targetsQuery("pronunciation_targets", "task_id", taskIds),
  ]);
  if (vocabTargetsRes.error || assignmentTargetsRes.error || pronunciationTargetsRes.error) {
    console.error("due-items: target query failed", vocabTargetsRes.error, assignmentTargetsRes.error, pronunciationTargetsRes.error);
    return FAIL;
  }
  const vocabTargets = vocabTargetsRes.data ?? [];
  const assignmentTargets = (assignmentTargetsRes.data ?? []) as AssignmentTargetRow[];
  const pronunciationTargets = (pronunciationTargetsRes.data ?? []) as PronunciationTargetRow[];

  const classIds = [
    ...new Set([
      ...assignmentTargets.filter((t) => t.class_id).map((t) => t.class_id as string),
      ...pronunciationTargets.filter((t) => t.class_id).map((t) => t.class_id as string),
    ]),
  ];
  const enrollmentsRes =
    classIds.length === 0
      ? { data: [] as EnrollmentRow[], error: null }
      : await supabase.from("enrollments").select("class_id, student_id").in("class_id", classIds).is("unenrolled_at", null);
  if (enrollmentsRes.error) {
    console.error("due-items: class-roster query failed", enrollmentsRes.error);
    return FAIL;
  }
  const classRoster = new Map<string, string[]>();
  for (const e of enrollmentsRes.data ?? []) classRoster.set(e.class_id, [...(classRoster.get(e.class_id) ?? []), e.student_id]);

  // When opts.studentId is set, targetsQuery's OR-clause already ensured
  // only this student's own/class-targeted rows came back, but expanding a
  // class target below still pulls in the whole class roster -- that's
  // fine, because activeIds (built above from the studentId-scoped query)
  // contains only this one id, so the final `.filter(activeIds.has(...))`
  // narrows every audience back down to just this student regardless.
  function resolveAudience(targets: ClassScopedTargetRow[]): string[] {
    const ids = new Set<string>();
    for (const t of targets) {
      if (t.student_id) ids.add(t.student_id);
      if (t.class_id) for (const sid of classRoster.get(t.class_id) ?? []) ids.add(sid);
    }
    return [...ids];
  }
  const resolveVocabAudience = (targets: VocabTargetRow[]) => [...new Set(targets.map((t) => t.student_id))];

  const sessionsQuery =
    setIds.length === 0
      ? Promise.resolve({ data: [] as SessionRow[], error: null })
      : opts.studentId
        ? supabase
            .from("practice_sessions")
            .select("id, student_id, set_id, completed_at, total_words, audio_word_count, vocabulary_attempts(word_id, attempt_no, is_correct)")
            .in("set_id", setIds)
            .eq("student_id", opts.studentId)
        : supabase
            .from("practice_sessions")
            .select("id, student_id, set_id, completed_at, total_words, audio_word_count, vocabulary_attempts(word_id, attempt_no, is_correct)")
            .in("set_id", setIds);
  const submissionsQuery =
    plainAssignmentIds.length === 0
      ? Promise.resolve({ data: [] as SubmissionRow[], error: null })
      : opts.studentId
        ? supabase.from("submissions").select("student_id, assignment_id, submitted_at").in("assignment_id", plainAssignmentIds).eq("student_id", opts.studentId)
        : supabase.from("submissions").select("student_id, assignment_id, submitted_at").in("assignment_id", plainAssignmentIds);
  const audioQuery =
    taskIds.length === 0
      ? Promise.resolve({ data: [] as AudioRow[], error: null })
      : opts.studentId
        ? supabase.from("audio_submissions").select("student_id, task_id, submitted_at").in("task_id", taskIds).eq("student_id", opts.studentId)
        : supabase.from("audio_submissions").select("student_id, task_id, submitted_at").in("task_id", taskIds);

  const [sessionsRes, submissionsRes, audioRes, gameCompletionRes] = await Promise.all([
    sessionsQuery,
    submissionsQuery,
    audioQuery,
    getGameAssignmentCompletion(supabase, gameAssignmentIds, opts.studentId ?? null),
  ]);
  if (sessionsRes.error || submissionsRes.error || audioRes.error || !gameCompletionRes.ok) {
    console.error("due-items: completion query failed", sessionsRes.error, submissionsRes.error, audioRes.error);
    return FAIL;
  }

  // Vocabulary audio recordings, needed by the shared completion formula's
  // audioPassed check -- fetched in two steps (submissions, then their
  // files) rather than a nested embed-filter, matching this file's existing
  // convention of merging RLS-scoped reads in JS.
  const sessionIds = (sessionsRes.data ?? []).map((s) => s.id);
  const audioSubsRes =
    sessionIds.length === 0
      ? { data: [] as AudioSubmissionRow[], error: null }
      : await supabase.from("vocabulary_audio_submissions").select("id, session_id").in("session_id", sessionIds);
  if (audioSubsRes.error) {
    console.error("due-items: vocabulary audio submissions query failed", audioSubsRes.error);
    return FAIL;
  }
  const audioSubmissionIds = (audioSubsRes.data ?? []).map((a) => a.id);
  const audioFilesRes =
    audioSubmissionIds.length === 0
      ? { data: [] as AudioFileRow[], error: null }
      : await supabase.from("vocabulary_audio_submission_files").select("word_id, vocabulary_audio_submission_id").in("vocabulary_audio_submission_id", audioSubmissionIds);
  if (audioFilesRes.error) {
    console.error("due-items: vocabulary audio files query failed", audioFilesRes.error);
    return FAIL;
  }
  const sessionIdBySubmissionId = new Map((audioSubsRes.data ?? []).map((a) => [a.id, a.session_id]));
  const audioWordIdsBySession = new Map<string, string[]>();
  for (const f of audioFilesRes.data ?? []) {
    const sessionId = sessionIdBySubmissionId.get(f.vocabulary_audio_submission_id);
    if (!sessionId) continue;
    audioWordIdsBySession.set(sessionId, [...(audioWordIdsBySession.get(sessionId) ?? []), f.word_id]);
  }

  // "some(session => completedFull)" per (student, set) pair -- once truly
  // completed once, it stays completed for reporting even if a later,
  // lower-scoring review session exists.
  const vocabDoneKeys = new Set<string>();
  for (const s of sessionsRes.data ?? []) {
    const attempts = (s.vocabulary_attempts ?? []).map((a) => ({ wordId: a.word_id, attemptNo: a.attempt_no, isCorrect: a.is_correct }));
    const completion = computeVocabularySessionCompletion(
      { totalWords: s.total_words, audioWordCount: s.audio_word_count, completedAt: s.completed_at },
      attempts,
      audioWordIdsBySession.get(s.id) ?? []
    );
    if (completion.completedFull) vocabDoneKeys.add(`${s.student_id}:${s.set_id}`);
  }
  const vocabDone = (studentId: string, setId: string) => vocabDoneKeys.has(`${studentId}:${setId}`);
  const doneByAssignment = new Map<string, Set<string>>();
  for (const s of submissionsRes.data ?? []) {
    if (s.submitted_at) doneByAssignment.set(s.assignment_id, (doneByAssignment.get(s.assignment_id) ?? new Set()).add(s.student_id));
  }
  for (const row of gameCompletionRes.rows) {
    if (row.completed) {
      doneByAssignment.set(
        row.assignmentId,
        (doneByAssignment.get(row.assignmentId) ?? new Set()).add(row.studentId)
      );
    }
  }
  const doneByTask = new Map<string, Set<string>>();
  for (const s of audioRes.data ?? []) {
    if (s.submitted_at) doneByTask.set(s.task_id, (doneByTask.get(s.task_id) ?? new Set()).add(s.student_id));
  }

  const items: DueItem[] = [];
  for (const s of sets) {
    const audience = resolveVocabAudience(vocabTargets.filter((t) => t.set_id === s.id));
    items.push({
      id: s.id,
      type: "vocabulary",
      title: s.title,
      dueAt: s.due_at!,
      href: `/teacher/vocabulary/${s.id}`,
      incompleteStudentIds: audience.filter((sid) => activeIds.has(sid) && !vocabDone(sid, s.id)),
    });
  }
  for (const a of assignments) {
    const audience = resolveAudience(assignmentTargets.filter((t) => t.assignment_id === a.id));
    const done = doneByAssignment.get(a.id) ?? new Set<string>();
    items.push({
      id: a.id,
      type: a.assignment_kind === "game" ? "game" : "assignment",
      title: a.title,
      dueAt: a.due_at!,
      href: `/teacher/assignments/${a.id}`,
      incompleteStudentIds: audience.filter((id) => activeIds.has(id) && !done.has(id)),
    });
  }
  for (const t of tasks) {
    const audience = resolveAudience(pronunciationTargets.filter((x) => x.task_id === t.id));
    const done = doneByTask.get(t.id) ?? new Set<string>();
    items.push({
      id: t.id,
      type: "pronunciation",
      title: t.title,
      dueAt: t.due_at!,
      href: `/teacher/pronunciation/${t.id}`,
      incompleteStudentIds: audience.filter((id) => activeIds.has(id) && !done.has(id)),
    });
  }
  return { ok: true, items };
}
