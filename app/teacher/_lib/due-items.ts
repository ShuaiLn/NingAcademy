import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/supabase/database.types";

export type ItemType = "vocabulary" | "assignment" | "pronunciation";

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
  student_id: string;
  set_id: string;
  completed_at: string | null;
  total_words: number;
  vocabulary_attempts: { is_correct: boolean }[];
};
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
  let assignmentsQuery = supabase.from("assignments").select("id, title, due_at").is("archived_at", null).not("due_at", "is", null);
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
            .select("student_id, set_id, completed_at, total_words, vocabulary_attempts(is_correct)")
            .in("set_id", setIds)
            .eq("student_id", opts.studentId)
        : supabase.from("practice_sessions").select("student_id, set_id, completed_at, total_words, vocabulary_attempts(is_correct)").in("set_id", setIds);
  const submissionsQuery =
    assignmentIds.length === 0
      ? Promise.resolve({ data: [] as SubmissionRow[], error: null })
      : opts.studentId
        ? supabase.from("submissions").select("student_id, assignment_id, submitted_at").in("assignment_id", assignmentIds).eq("student_id", opts.studentId)
        : supabase.from("submissions").select("student_id, assignment_id, submitted_at").in("assignment_id", assignmentIds);
  const audioQuery =
    taskIds.length === 0
      ? Promise.resolve({ data: [] as AudioRow[], error: null })
      : opts.studentId
        ? supabase.from("audio_submissions").select("student_id, task_id, submitted_at").in("task_id", taskIds).eq("student_id", opts.studentId)
        : supabase.from("audio_submissions").select("student_id, task_id, submitted_at").in("task_id", taskIds);

  const [sessionsRes, submissionsRes, audioRes] = await Promise.all([sessionsQuery, submissionsQuery, audioQuery]);
  if (sessionsRes.error || submissionsRes.error || audioRes.error) {
    console.error("due-items: completion query failed", sessionsRes.error, submissionsRes.error, audioRes.error);
    return FAIL;
  }

  const vocabAgg = new Map<string, { completedFull: boolean; correct: number; total: number }>();
  for (const s of sessionsRes.data ?? []) {
    const key = `${s.student_id}:${s.set_id}`;
    const attempts = s.vocabulary_attempts ?? [];
    const entry = vocabAgg.get(key) ?? { completedFull: false, correct: 0, total: 0 };
    if (s.completed_at && attempts.length === s.total_words) entry.completedFull = true;
    entry.correct += attempts.filter((a) => a.is_correct).length;
    entry.total += attempts.length;
    vocabAgg.set(key, entry);
  }
  const vocabDone = (studentId: string, setId: string) => {
    const agg = vocabAgg.get(`${studentId}:${setId}`);
    return !!agg && agg.completedFull && agg.total > 0 && agg.correct / agg.total >= 0.6;
  };
  const doneByAssignment = new Map<string, Set<string>>();
  for (const s of submissionsRes.data ?? []) {
    if (s.submitted_at) doneByAssignment.set(s.assignment_id, (doneByAssignment.get(s.assignment_id) ?? new Set()).add(s.student_id));
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
      type: "assignment",
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
