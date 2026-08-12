import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { WordRow } from "./word-row";
import { AddWordsForm } from "./add-words-form";
import { AssignPanel } from "./assign-panel";
import { EditSetForm } from "./edit-set-form";
import { SetActionsPanel } from "./set-actions-panel";
import { DueDateBadge } from "@/app/_components/due-date-badge";
import { StretchedRowLink } from "@/app/_components/stretched-row-link";

export default async function VocabularySetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: set } = await supabase
    .from("vocabulary_sets")
    .select("id, title, description, published_at, archived_at, prompt_field, show_image, audio_only, due_at")
    .eq("id", id)
    .maybeSingle();

  if (!set) {
    notFound();
  }

  const { data: words } = await supabase
    .from("vocabulary_words")
    .select("id, term, meaning, image_url, archived_at")
    .eq("set_id", id)
    .order("sort_order", { ascending: true });

  const { data: students } = await supabase
    .from("students")
    .select("id, profiles(full_name)")
    .order("created_at", { ascending: false });

  const allStudents = (students ?? []).map((s) => ({
    id: s.id,
    fullName: s.profiles?.full_name ?? "",
  }));

  const { data: targets } = await supabase
    .from("vocabulary_targets")
    .select("student_id")
    .eq("set_id", id)
    .is("revoked_at", null);

  const assignedStudentIds = (targets ?? []).map((t) => t.student_id);

  // 正确率 = correct attempts / total attempts across all the student's
  // sessions on this set (not per-session average); 开始次数 = distinct
  // sessions with >=1 recorded attempt; 完整完成次数 = sessions where
  // completed_at is not null AND attempt count equals total_words (an early
  // "结束练习" with partial answers does not count as complete).
  const { data: sessions } = await supabase
    .from("practice_sessions")
    .select("student_id, completed_at, total_words, vocabulary_attempts(is_correct)")
    .eq("set_id", id);

  const statsByStudent = new Map<
    string,
    { started: number; completed: number; correct: number; total: number }
  >();
  for (const session of sessions ?? []) {
    const attempts = session.vocabulary_attempts ?? [];
    const entry = statsByStudent.get(session.student_id) ?? { started: 0, completed: 0, correct: 0, total: 0 };
    if (attempts.length > 0) entry.started += 1;
    if (session.completed_at && attempts.length === session.total_words) entry.completed += 1;
    entry.correct += attempts.filter((a) => a.is_correct).length;
    entry.total += attempts.length;
    statsByStudent.set(session.student_id, entry);
  }

  const overdue = !!set.due_at && !set.archived_at && new Date(set.due_at) < new Date();
  const assignedStudents = allStudents.filter((s) => assignedStudentIds.includes(s.id));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{set.title}</h1>
        <p className="text-sm text-slate-500">
          {set.archived_at ? "已归档" : set.published_at ? "已发布" : "草稿"}
        </p>
        {set.due_at ? (
          <p className="text-sm">
            <DueDateBadge dueAt={set.due_at} overdue={overdue} />
          </p>
        ) : null}
      </div>

      <EditSetForm set={set} />

      <div className="rounded-md border border-slate-200 p-4">
        <SetActionsPanel setId={set.id} published={!!set.published_at} archived={!!set.archived_at} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">单词列表</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {words?.map((word) => <WordRow key={word.id} setId={set.id} word={word} />)}
            {!words || words.length === 0 ? (
              <tr>
                <td className="py-6 text-center text-slate-400">还没有单词。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <AddWordsForm setId={set.id} />
      </div>

      <AssignPanel setId={set.id} allStudents={allStudents} assignedStudentIds={assignedStudentIds} />

      {assignedStudents.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <h2 className="font-medium">练习情况</h2>
          <table className="hidden w-full border-collapse text-sm sm:table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2">学生</th>
                <th className="py-2">开始次数</th>
                <th className="py-2">完整完成次数</th>
                <th className="py-2">正确率</th>
              </tr>
            </thead>
            <tbody>
              {assignedStudents.map((s) => {
                const stat = statsByStudent.get(s.id) ?? { started: 0, completed: 0, correct: 0, total: 0 };
                const accuracy = stat.total === 0 ? "—" : `${Math.round((stat.correct / stat.total) * 100)}%`;
                return (
                  <tr key={s.id} className="relative border-b border-slate-100">
                    <td className="py-2">
                      <StretchedRowLink
                        href={`/teacher/students/${s.id}`}
                        label={`学生：${s.fullName}，开始 ${stat.started} 次，完成 ${stat.completed} 次，正确率 ${accuracy}`}
                      />
                      <span>{s.fullName}</span>
                    </td>
                    <td className="py-2">{stat.started}</td>
                    <td className="py-2">{stat.completed}</td>
                    <td className="py-2">{accuracy}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-col gap-2 sm:hidden">
            {assignedStudents.map((s) => {
              const stat = statsByStudent.get(s.id) ?? { started: 0, completed: 0, correct: 0, total: 0 };
              const accuracy = stat.total === 0 ? "—" : `${Math.round((stat.correct / stat.total) * 100)}%`;
              return (
                <div key={s.id} className="relative rounded-md border border-slate-100 p-3">
                  <StretchedRowLink
                    href={`/teacher/students/${s.id}`}
                    label={`学生：${s.fullName}，开始 ${stat.started} 次，完成 ${stat.completed} 次，正确率 ${accuracy}`}
                  />
                  <p className="font-medium">{s.fullName}</p>
                  <p className="text-sm text-slate-600">
                    开始 {stat.started} 次 · 完成 {stat.completed} 次 · 正确率 {accuracy}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
