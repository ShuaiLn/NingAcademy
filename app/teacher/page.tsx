import { createClient } from "@/utils/supabase/server";
import { getDueItemsWithIncompleteStudents, type DueItem } from "./_lib/due-items";
import { DashboardStatTiles, type StatTile } from "./dashboard-stat-tiles";
import { DueRemindersSection } from "./due-reminders-section";
import { RecentActivityFeed, type FeedRow } from "./recent-activity-feed";

const FEED_LIMIT = 20;
const UPCOMING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
// Bounds the due-items call on both ends so it doesn't scan every
// non-archived overdue item ever created as historical data accumulates --
// see AGENTS.md's "known, accepted scale limit" note for this phase.
const LOOKBACK_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function tileValue(count: number | null, error: unknown): number | null {
  return error ? null : (count ?? 0);
}

export default async function TeacherHomePage() {
  const supabase = await createClient();
  const now = Date.now();
  const dueBefore = new Date(now + UPCOMING_WINDOW_MS).toISOString();
  const dueSince = new Date(now - LOOKBACK_WINDOW_MS).toISOString();

  const [
    studentsRes,
    classesRes,
    pendingAssignmentsRes,
    pendingPronunciationRes,
    pendingExamScoresRes,
    dueResult,
    vocabDoneRes,
    assignSubmittedRes,
    proSubmittedRes,
    assignGradedRes,
    proGradedRes,
    examGradedRes,
    summaryTargetsRes,
  ] = await Promise.all([
    supabase.from("students").select("id, profiles(full_name, is_active)"),
    supabase.from("classes").select("id", { count: "exact", head: true }).is("archived_at", null),
    supabase
      .from("submissions")
      .select("id, assignments!inner(archived_at)", { count: "exact", head: true })
      .not("submitted_at", "is", null)
      .is("score", null)
      .is("assignments.archived_at", null),
    supabase
      .from("audio_submissions")
      .select("id, pronunciation_tasks!inner(archived_at)", { count: "exact", head: true })
      .not("submitted_at", "is", null)
      .is("score", null)
      .is("pronunciation_tasks.archived_at", null),
    supabase
      .from("exam_scores")
      .select("id, exams!inner(archived_at)", { count: "exact", head: true })
      .is("score", null)
      .is("exams.archived_at", null),
    getDueItemsWithIncompleteStudents(supabase, { dueSince, dueBefore }),
    supabase
      .from("practice_sessions")
      .select(
        "id, student_id, set_id, completed_at, total_words, vocabulary_attempts(is_correct), vocabulary_sets(title), students(profiles(full_name))"
      )
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(FEED_LIMIT),
    supabase
      .from("submissions")
      .select("id, student_id, assignment_id, submitted_at, assignments(title), students(profiles(full_name))")
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(FEED_LIMIT),
    supabase
      .from("audio_submissions")
      .select("id, student_id, task_id, submitted_at, pronunciation_tasks(title), students(profiles(full_name))")
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(FEED_LIMIT),
    supabase
      .from("submissions")
      .select("id, student_id, assignment_id, graded_at, score, assignments(title), students(profiles(full_name))")
      .not("graded_at", "is", null)
      .not("score", "is", null)
      .order("graded_at", { ascending: false })
      .limit(FEED_LIMIT),
    supabase
      .from("audio_submissions")
      .select("id, student_id, task_id, graded_at, score, pronunciation_tasks(title), students(profiles(full_name))")
      .not("graded_at", "is", null)
      .not("score", "is", null)
      .order("graded_at", { ascending: false })
      .limit(FEED_LIMIT),
    supabase
      .from("exam_scores")
      .select("id, student_id, exam_id, graded_at, score, exams(title), students(profiles(full_name))")
      .not("graded_at", "is", null)
      .not("score", "is", null)
      .order("graded_at", { ascending: false })
      .limit(FEED_LIMIT),
    supabase
      .from("lesson_summary_targets")
      .select("student_id, summary_id, created_at, lesson_summaries(title), students(profiles(full_name))")
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
  ]);

  // Every tile/section below checks its own query's error explicitly and
  // renders a failure state for just that piece, rather than silently
  // defaulting to 0 -- a query failure must never read as "nothing here."
  const studentsFailed = !!studentsRes.error;
  if (studentsFailed) console.error("teacher dashboard: students query failed", studentsRes.error);
  const studentNames = new Map<string, string>();
  for (const s of studentsRes.data ?? []) studentNames.set(s.id, s.profiles?.full_name ?? "");

  const tiles: StatTile[] = [
    { label: "学生账号总数（含停用）", value: studentsFailed ? null : (studentsRes.data?.length ?? 0), href: "/teacher/students" },
    { label: "班级数量", value: tileValue(classesRes.count, classesRes.error), href: "/teacher/classes" },
    { label: "待批改·普通作业", value: tileValue(pendingAssignmentsRes.count, pendingAssignmentsRes.error), href: "/teacher/assignments" },
    { label: "待批改·朗读作业", value: tileValue(pendingPronunciationRes.count, pendingPronunciationRes.error), href: "/teacher/assignments" },
    { label: "未录入·考试成绩", value: tileValue(pendingExamScoresRes.count, pendingExamScoresRes.error), href: "/teacher/exams" },
  ];

  let overdueItems: DueItem[] = [];
  let upcomingItems: DueItem[] = [];
  if (dueResult.ok) {
    const withIncomplete = dueResult.items.filter((i) => i.incompleteStudentIds.length > 0);
    const byDueAtAsc = (a: DueItem, b: DueItem) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    overdueItems = withIncomplete.filter((i) => new Date(i.dueAt).getTime() < now).sort(byDueAtAsc);
    upcomingItems = withIncomplete.filter((i) => new Date(i.dueAt).getTime() >= now).sort(byDueAtAsc);
  }

  const feedRows: FeedRow[] = [];
  for (const s of vocabDoneRes.data ?? []) {
    const attempts = s.vocabulary_attempts ?? [];
    const correct = attempts.filter((a) => a.is_correct).length;
    feedRows.push({
      kind: "vocab_done",
      occurredAt: s.completed_at!,
      studentId: s.student_id,
      studentName: s.students?.profiles?.full_name ?? "",
      itemTitle: s.vocabulary_sets?.title ?? "",
      itemHref: `/teacher/vocabulary/${s.set_id}`,
      detail: attempts.length > 0 ? `正确 ${correct}/${attempts.length}` : undefined,
    });
  }
  for (const s of assignSubmittedRes.data ?? []) {
    feedRows.push({
      kind: "assignment_submitted",
      occurredAt: s.submitted_at!,
      studentId: s.student_id,
      studentName: s.students?.profiles?.full_name ?? "",
      itemTitle: s.assignments?.title ?? "",
      itemHref: `/teacher/assignments/${s.assignment_id}`,
    });
  }
  for (const s of proSubmittedRes.data ?? []) {
    feedRows.push({
      kind: "pronunciation_submitted",
      occurredAt: s.submitted_at!,
      studentId: s.student_id,
      studentName: s.students?.profiles?.full_name ?? "",
      itemTitle: s.pronunciation_tasks?.title ?? "",
      itemHref: `/teacher/pronunciation/${s.task_id}`,
    });
  }
  for (const s of assignGradedRes.data ?? []) {
    feedRows.push({
      kind: "assignment_graded",
      occurredAt: s.graded_at!,
      studentId: s.student_id,
      studentName: s.students?.profiles?.full_name ?? "",
      itemTitle: s.assignments?.title ?? "",
      itemHref: `/teacher/assignments/${s.assignment_id}`,
      detail: s.score !== null ? `${s.score} 分` : undefined,
    });
  }
  for (const s of proGradedRes.data ?? []) {
    feedRows.push({
      kind: "pronunciation_graded",
      occurredAt: s.graded_at!,
      studentId: s.student_id,
      studentName: s.students?.profiles?.full_name ?? "",
      itemTitle: s.pronunciation_tasks?.title ?? "",
      itemHref: `/teacher/pronunciation/${s.task_id}`,
      detail: s.score !== null ? `${s.score} 分` : undefined,
    });
  }
  for (const s of examGradedRes.data ?? []) {
    feedRows.push({
      kind: "exam_graded",
      occurredAt: s.graded_at!,
      studentId: s.student_id,
      studentName: s.students?.profiles?.full_name ?? "",
      itemTitle: s.exams?.title ?? "",
      itemHref: `/teacher/exams/${s.exam_id}`,
      detail: s.score !== null ? `${s.score} 分` : undefined,
    });
  }
  for (const s of summaryTargetsRes.data ?? []) {
    feedRows.push({
      kind: "summary_shared",
      occurredAt: s.created_at,
      studentId: s.student_id,
      studentName: s.students?.profiles?.full_name ?? "",
      itemTitle: s.lesson_summaries?.title ?? "（无标题）",
      itemHref: `/teacher/summaries/${s.summary_id}`,
    });
  }
  feedRows.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const feed = feedRows.slice(0, FEED_LIMIT);

  const feedErrors = [
    vocabDoneRes.error,
    assignSubmittedRes.error,
    proSubmittedRes.error,
    assignGradedRes.error,
    proGradedRes.error,
    examGradedRes.error,
    summaryTargetsRes.error,
  ];
  const partialFeedFailure = feedErrors.some(Boolean);
  if (partialFeedFailure) console.error("teacher dashboard: activity feed source(s) failed", feedErrors);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">仪表盘</h1>

      <DashboardStatTiles tiles={tiles} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">截止提醒</h2>
        <DueRemindersSection
          failed={!dueResult.ok}
          overdueItems={overdueItems}
          upcomingItems={upcomingItems}
          studentNames={studentNames}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">最近动态</h2>
        <RecentActivityFeed rows={feed} partialFailure={partialFeedFailure} />
      </section>
    </div>
  );
}
