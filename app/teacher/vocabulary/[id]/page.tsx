import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { WordRow } from "./word-row";
import { AddWordsForm } from "./add-words-form";
import { AssignPanel } from "./assign-panel";
import { EditSetForm } from "./edit-set-form";
import { SetActionsPanel } from "./set-actions-panel";
import { AudioSubmissionsPanel } from "./audio-submissions-panel";
import { DueDateBadge } from "@/app/_components/due-date-badge";
import { StretchedRowLink } from "@/app/_components/stretched-row-link";
import { computeVocabularySessionCompletion } from "@/app/_lib/vocabulary-completion";

export default async function VocabularySetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: set } = await supabase
    .from("vocabulary_sets")
    .select(
      "id, title, description, published_at, archived_at, due_at, practice_engine_version, prompt_field, show_image, audio_only, display_show_english, display_show_chinese, display_play_audio, display_autoplay_audio, input_mode, word_order, allow_student_order_choice"
    )
    .eq("id", id)
    .maybeSingle();

  if (!set) {
    notFound();
  }

  const isV2 = set.practice_engine_version === 2;

  const { data: words } = await supabase
    .from("vocabulary_words")
    .select(
      "id, term, meaning, image_url, archived_at, override_show_english, override_show_chinese, override_play_audio, override_show_image, override_autoplay_audio, override_input_mode"
    )
    .eq("set_id", id)
    .order("sort_order", { ascending: true });

  const wordIds = (words ?? []).map((w) => w.id);
  const { data: altMeaningsRows } =
    isV2 && wordIds.length > 0
      ? await supabase.from("vocabulary_word_alt_meanings").select("word_id, alt_meaning").in("word_id", wordIds).order("sort_order", { ascending: true })
      : { data: [] as { word_id: string; alt_meaning: string }[] };
  const altMeaningsByWord = new Map<string, string[]>();
  for (const row of altMeaningsRows ?? []) {
    altMeaningsByWord.set(row.word_id, [...(altMeaningsByWord.get(row.word_id) ?? []), row.alt_meaning]);
  }

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
  // sessions on this set (any attempt_no); 开始次数 = distinct sessions with
  // >=1 recorded attempt; 完整完成次数 = sessions passing the shared
  // completion formula (app/_lib/vocabulary-completion.ts) -- every typed
  // word eventually correct AND first-attempt accuracy >=60% AND every
  // audio word recorded, not just "every word attempted."
  const { data: sessions } = await supabase
    .from("practice_sessions")
    .select("id, student_id, started_at, completed_at, total_words, audio_word_count, vocabulary_attempts(word_id, attempt_no, is_correct)")
    .eq("set_id", id);

  const sessionIds = (sessions ?? []).map((s) => s.id);
  const { data: audioSubs } =
    sessionIds.length > 0
      ? await supabase.from("vocabulary_audio_submissions").select("session_id, vocabulary_audio_submission_files(word_id)").in("session_id", sessionIds)
      : { data: [] as { session_id: string; vocabulary_audio_submission_files: { word_id: string }[] }[] };
  const audioWordIdsBySession = new Map<string, string[]>();
  for (const a of audioSubs ?? []) {
    audioWordIdsBySession.set(a.session_id, (a.vocabulary_audio_submission_files ?? []).map((f) => f.word_id));
  }

  const statsByStudent = new Map<
    string,
    { started: number; completed: number; correct: number; total: number; latestSessionId: string | null; latestStartedAt: string }
  >();
  for (const session of sessions ?? []) {
    const attempts = session.vocabulary_attempts ?? [];
    const entry = statsByStudent.get(session.student_id) ?? {
      started: 0,
      completed: 0,
      correct: 0,
      total: 0,
      latestSessionId: null,
      latestStartedAt: "",
    };
    if (attempts.length > 0) entry.started += 1;
    const completion = computeVocabularySessionCompletion(
      { totalWords: session.total_words, audioWordCount: session.audio_word_count, completedAt: session.completed_at },
      attempts.map((a) => ({ wordId: a.word_id, attemptNo: a.attempt_no, isCorrect: a.is_correct })),
      audioWordIdsBySession.get(session.id) ?? []
    );
    if (completion.completedFull) entry.completed += 1;
    entry.correct += attempts.filter((a) => a.is_correct).length;
    entry.total += attempts.length;
    if (session.started_at > entry.latestStartedAt) {
      entry.latestStartedAt = session.started_at;
      entry.latestSessionId = session.id;
    }
    statsByStudent.set(session.student_id, entry);
  }

  const overdue = !!set.due_at && !set.archived_at && new Date(set.due_at) < new Date();
  const assignedStudents = allStudents.filter((s) => assignedStudentIds.includes(s.id));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{set.title}</h1>
        <p className="text-sm text-slate-500">
          {set.archived_at ? "已归档" : set.published_at ? "已发布" : "草稿"} · {isV2 ? "新版" : "旧版"}
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
            {words?.map((word) => (
              <WordRow key={word.id} setId={set.id} isV2={isV2} word={{ ...word, altMeanings: altMeaningsByWord.get(word.id) ?? [] }} />
            ))}
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

      {isV2 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">学生朗读提交</h2>
          <AudioSubmissionsPanel setId={set.id} />
        </div>
      ) : null}

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
                const stat = statsByStudent.get(s.id) ?? { started: 0, completed: 0, correct: 0, total: 0, latestSessionId: null, latestStartedAt: "" };
                const accuracy = stat.total === 0 ? "—" : `${Math.round((stat.correct / stat.total) * 100)}%`;
                const href = stat.latestSessionId ? `/teacher/vocabulary/${set.id}/sessions/${stat.latestSessionId}` : `/teacher/students/${s.id}`;
                return (
                  <tr key={s.id} className="relative border-b border-slate-100">
                    <td className="py-2">
                      <StretchedRowLink
                        href={href}
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
              const stat = statsByStudent.get(s.id) ?? { started: 0, completed: 0, correct: 0, total: 0, latestSessionId: null, latestStartedAt: "" };
              const accuracy = stat.total === 0 ? "—" : `${Math.round((stat.correct / stat.total) * 100)}%`;
              const href = stat.latestSessionId ? `/teacher/vocabulary/${set.id}/sessions/${stat.latestSessionId}` : `/teacher/students/${s.id}`;
              return (
                <div key={s.id} className="relative rounded-md border border-slate-100 p-3">
                  <StretchedRowLink
                    href={href}
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
