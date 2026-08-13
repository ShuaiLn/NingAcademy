import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getLastSignInTime } from "@/utils/supabase/admin";
import { getDueItemsWithIncompleteStudents } from "@/app/teacher/_lib/due-items";
import { StudentActiveToggle } from "../student-active-toggle";
import { RenameForm } from "./rename-form";
import { ResetPasswordForm } from "./reset-password-form";
import { LastSignInBadge } from "../last-sign-in-badge";
import { VocabularyStatsSection, type VocabStatRow } from "./vocabulary-stats-section";
import { WorkStatsSection, type WorkStatRow, type WorkStatus } from "./work-stats-section";
import { ExamScoresSection, type ExamScoreRow } from "./exam-scores-section";
import { RecentSummariesSection, type SummaryRow } from "./recent-summaries-section";
import { IncompleteItemsSection } from "./incomplete-items-section";
import { computeVocabularySessionCompletion } from "@/app/_lib/vocabulary-completion";

function submissionStatus(sub: { submitted_at: string | null; score: number | null } | undefined): WorkStatus {
  if (!sub) return "未提交";
  if (!sub.submitted_at) return "草稿中";
  if (sub.score === null) return "已提交待批改";
  return "已批改";
}

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: student } = await supabase
    .from("students")
    .select("id, created_at, profiles(username, full_name, is_active)")
    .eq("id", id)
    .maybeSingle();

  if (!student || !student.profiles) {
    notFound();
  }

  // Everything below is called only after the ownership-verified fetch
  // above succeeded, so `id` is already proven to be a real UUID this
  // teacher's RLS policies allow them to see -- required both for the
  // service_role last-sign-in lookup and for the raw string interpolation
  // in due-items.ts's/this page's `.or()` clauses.
  const now = Date.now();

  const [
    sessionsRes,
    vocabTargetsRes,
    enrollmentsRes,
    submissionsRes,
    audioSubmissionsRes,
    examScoresRes,
    summaryTargetsRes,
    dueResult,
    lastSignIn,
  ] = await Promise.all([
    supabase
      .from("practice_sessions")
      .select("id, set_id, completed_at, total_words, audio_word_count, vocabulary_attempts(word_id, attempt_no, is_correct), vocabulary_sets(title)")
      .eq("student_id", id),
    supabase.from("vocabulary_targets").select("set_id, vocabulary_sets(title)").eq("student_id", id).is("revoked_at", null),
    supabase.from("enrollments").select("class_id").eq("student_id", id).is("unenrolled_at", null),
    supabase
      .from("submissions")
      .select("assignment_id, attempt_no, submitted_at, score, feedback_text")
      .eq("student_id", id)
      .order("attempt_no", { ascending: false }),
    supabase
      .from("audio_submissions")
      .select("task_id, attempt_no, submitted_at, score, feedback_text")
      .eq("student_id", id)
      .order("attempt_no", { ascending: false }),
    supabase
      .from("exam_scores")
      .select("id, exam_id, score, feedback_text, exams(title, exam_date, full_marks, archived_at)")
      .eq("student_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("lesson_summary_targets")
      .select("lesson_summaries(id, title, content, session_date, archived_at)")
      .eq("student_id", id),
    getDueItemsWithIncompleteStudents(supabase, { studentId: id }),
    getLastSignInTime(id),
  ]);

  const classIds = (enrollmentsRes.data ?? []).map((e) => e.class_id);
  const orClause = ["student_id.eq." + id, ...(classIds.length ? [`class_id.in.(${classIds.join(",")})`] : [])].join(",");

  const [assignmentTargetsRes, pronunciationTargetsRes] = await Promise.all([
    supabase.from("assignment_targets").select("assignment_id").is("revoked_at", null).or(orClause),
    supabase.from("pronunciation_targets").select("task_id").is("revoked_at", null).or(orClause),
  ]);

  const allAssignmentIds = [
    ...new Set([
      ...(assignmentTargetsRes.data ?? []).map((t) => t.assignment_id),
      ...(submissionsRes.data ?? []).map((s) => s.assignment_id),
    ]),
  ];
  const allTaskIds = [
    ...new Set([
      ...(pronunciationTargetsRes.data ?? []).map((t) => t.task_id),
      ...(audioSubmissionsRes.data ?? []).map((s) => s.task_id),
    ]),
  ];

  const [assignmentRowsRes, taskRowsRes] = await Promise.all([
    allAssignmentIds.length
      ? supabase.from("assignments").select("id, title, due_at, archived_at").in("id", allAssignmentIds)
      : Promise.resolve({ data: [] as { id: string; title: string; due_at: string | null; archived_at: string | null }[], error: null }),
    allTaskIds.length
      ? supabase.from("pronunciation_tasks").select("id, title, due_at, archived_at").in("id", allTaskIds)
      : Promise.resolve({ data: [] as { id: string; title: string; due_at: string | null; archived_at: string | null }[], error: null }),
  ]);

  // 1. 词汇作业统计 -- title sourced from the sessions query first (reliable
  // regardless of target status), falling back to the targets query's title
  // only for sets with zero sessions (assigned but never opened). This
  // avoids a set with real session history losing its title if its target
  // was later revoked. 完整完成次数 uses the shared completion formula
  // (app/_lib/vocabulary-completion.ts), not "every word attempted."
  const sessionIds = (sessionsRes.data ?? []).map((s) => s.id);
  const audioSubsRes =
    sessionIds.length === 0
      ? { data: [] as { id: string; session_id: string }[], error: null }
      : await supabase.from("vocabulary_audio_submissions").select("id, session_id").in("session_id", sessionIds);
  const audioSubmissionIds = (audioSubsRes.data ?? []).map((a) => a.id);
  const audioFilesRes =
    audioSubmissionIds.length === 0
      ? { data: [] as { word_id: string; vocabulary_audio_submission_id: string }[], error: null }
      : await supabase
          .from("vocabulary_audio_submission_files")
          .select("word_id, vocabulary_audio_submission_id")
          .in("vocabulary_audio_submission_id", audioSubmissionIds);
  const sessionIdBySubmissionId = new Map((audioSubsRes.data ?? []).map((a) => [a.id, a.session_id]));
  const audioWordIdsBySession = new Map<string, string[]>();
  for (const f of audioFilesRes.data ?? []) {
    const sid = sessionIdBySubmissionId.get(f.vocabulary_audio_submission_id);
    if (!sid) continue;
    audioWordIdsBySession.set(sid, [...(audioWordIdsBySession.get(sid) ?? []), f.word_id]);
  }

  const vocabFailed = !!sessionsRes.error || !!vocabTargetsRes.error || !!audioSubsRes.error || !!audioFilesRes.error;
  const vocabMap = new Map<string, VocabStatRow>();
  for (const session of sessionsRes.data ?? []) {
    const entry = vocabMap.get(session.set_id) ?? {
      setId: session.set_id,
      title: session.vocabulary_sets?.title ?? "",
      started: 0,
      completed: 0,
      correct: 0,
      total: 0,
    };
    const attempts = session.vocabulary_attempts ?? [];
    if (attempts.length > 0) entry.started += 1;
    const completion = computeVocabularySessionCompletion(
      { totalWords: session.total_words, audioWordCount: session.audio_word_count, completedAt: session.completed_at },
      attempts.map((a) => ({ wordId: a.word_id, attemptNo: a.attempt_no, isCorrect: a.is_correct })),
      audioWordIdsBySession.get(session.id) ?? []
    );
    if (completion.completedFull) entry.completed += 1;
    entry.correct += attempts.filter((a) => a.is_correct).length;
    entry.total += attempts.length;
    vocabMap.set(session.set_id, entry);
  }
  for (const t of vocabTargetsRes.data ?? []) {
    if (!vocabMap.has(t.set_id)) {
      vocabMap.set(t.set_id, { setId: t.set_id, title: t.vocabulary_sets?.title ?? "", started: 0, completed: 0, correct: 0, total: 0 });
    }
  }
  const vocabRows = [...vocabMap.values()];

  // 2. 普通作业统计 -- latest attempt (highest attempt_no, per the explicit
  // ordering above) per assignment_id determines status.
  const assignmentFailed = !!enrollmentsRes.error || !!assignmentTargetsRes.error || !!submissionsRes.error || !!assignmentRowsRes.error;
  const latestSubmissionByAssignment = new Map<string, { submitted_at: string | null; score: number | null; feedback_text: string | null }>();
  for (const s of submissionsRes.data ?? []) {
    if (!latestSubmissionByAssignment.has(s.assignment_id)) latestSubmissionByAssignment.set(s.assignment_id, s);
  }
  const assignmentRows: WorkStatRow[] = (assignmentRowsRes.data ?? []).map((a) => {
    const latest = latestSubmissionByAssignment.get(a.id);
    return {
      id: a.id,
      title: a.title,
      dueAt: a.due_at,
      archived: !!a.archived_at,
      status: submissionStatus(latest),
      score: latest?.score ?? null,
      feedbackText: latest?.feedback_text ?? null,
    };
  });

  // 3. 朗读作业统计 -- identical shape/fixes against pronunciation_targets /
  // audio_submissions / pronunciation_tasks.
  const pronunciationFailed = !!enrollmentsRes.error || !!pronunciationTargetsRes.error || !!audioSubmissionsRes.error || !!taskRowsRes.error;
  const latestAudioByTask = new Map<string, { submitted_at: string | null; score: number | null; feedback_text: string | null }>();
  for (const s of audioSubmissionsRes.data ?? []) {
    if (!latestAudioByTask.has(s.task_id)) latestAudioByTask.set(s.task_id, s);
  }
  const pronunciationRows: WorkStatRow[] = (taskRowsRes.data ?? []).map((t) => {
    const latest = latestAudioByTask.get(t.id);
    return {
      id: t.id,
      title: t.title,
      dueAt: t.due_at,
      archived: !!t.archived_at,
      status: submissionStatus(latest),
      score: latest?.score ?? null,
      feedbackText: latest?.feedback_text ?? null,
    };
  });

  // 4. 考试成绩概览
  const examFailed = !!examScoresRes.error;
  const examRows: ExamScoreRow[] = (examScoresRes.data ?? [])
    .filter((row) => row.exams)
    .map((row) => ({
      id: row.id,
      examId: row.exam_id,
      examTitle: row.exams!.title,
      examDate: row.exams!.exam_date,
      fullMarks: row.exams!.full_marks,
      archived: !!row.exams!.archived_at,
      score: row.score,
      feedbackText: row.feedback_text,
    }));

  // 5. 最近课堂总结 -- top 5, sorted desc by session_date.
  const summariesFailed = !!summaryTargetsRes.error;
  const summaryRows: SummaryRow[] = (summaryTargetsRes.data ?? [])
    .map((row) => row.lesson_summaries)
    .filter((s): s is NonNullable<typeof s> => !!s)
    .sort((a, b) => (a.session_date < b.session_date ? 1 : -1))
    .slice(0, 5)
    .map((s) => ({
      id: s.id,
      title: s.title,
      sessionDate: s.session_date,
      archived: !!s.archived_at,
      excerpt: s.content.length > 60 ? `${s.content.slice(0, 60)}…` : s.content,
    }));

  // 6. 未完成/临期事项
  const dueFailed = !dueResult.ok;
  const incompleteItems = dueResult.ok ? dueResult.items.filter((i) => i.incompleteStudentIds.length > 0) : [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">{student.profiles.full_name}</h1>
          <p className="text-sm text-slate-500">用户名：{student.profiles.username}</p>
          <p className="text-sm text-slate-500">
            最近登录：<LastSignInBadge lookup={lastSignIn} />
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-md border border-slate-200 p-4">
          <span className="text-sm text-slate-700">账号状态</span>
          <StudentActiveToggle studentId={student.id} initialActive={student.profiles.is_active} />
        </div>
        <RenameForm studentId={student.id} currentName={student.profiles.full_name} />
        <ResetPasswordForm studentId={student.id} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">未完成/临期事项</h2>
        <IncompleteItemsSection failed={dueFailed} items={incompleteItems} now={now} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">词汇 / 朗读作业统计</h2>
        <VocabularyStatsSection
          vocabFailed={vocabFailed}
          pronunciationFailed={pronunciationFailed}
          vocabRows={vocabRows}
          pronunciationRows={pronunciationRows}
          now={now}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">普通作业统计</h2>
        <WorkStatsSection failed={assignmentFailed} rows={assignmentRows} emptyLabel="还没有分配任何普通作业。" hrefPrefix="/teacher/assignments" now={now} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">考试成绩概览</h2>
        <ExamScoresSection failed={examFailed} rows={examRows} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">最近课堂总结</h2>
        <RecentSummariesSection failed={summariesFailed} rows={summaryRows} />
      </section>
    </div>
  );
}
