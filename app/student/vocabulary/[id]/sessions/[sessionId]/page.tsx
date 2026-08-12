import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

type ReviewWord = {
  word_id: string;
  source_sort_order: number;
  prompt_term: string | null;
  prompt_meaning: string | null;
  input_mode: string;
};

// Student-facing sibling of app/teacher/vocabulary/[id]/sessions/[sessionId]/
// page.tsx -- same query shape (get_vocabulary_session_words_review +
// vocabulary_attempts + vocabulary_audio_submission_files), reused as-is
// since the RPC is already teacher-or-owning-student scoped and
// vocabulary_attempts' RLS already covers "own attempts". Only the chrome
// differs: no student-name header, and the back link goes to this
// student's own set detail page instead of the teacher's set page.
export default async function StudentSessionReviewPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("practice_sessions")
    .select("id, set_id, completed_at, total_words, audio_word_count")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session || session.set_id !== id) {
    notFound();
  }

  const [reviewWordsRes, attemptsRes, audioSubmissionRes] = await Promise.all([
    supabase.rpc("get_vocabulary_session_words_review", { p_session_id: sessionId }),
    supabase
      .from("vocabulary_attempts")
      .select("word_id, attempt_no, is_correct, submitted_spelling, correct_answers")
      .eq("session_id", sessionId)
      .order("attempt_no", { ascending: true }),
    session.audio_word_count > 0
      ? supabase.from("vocabulary_audio_submissions").select("id").eq("session_id", sessionId).maybeSingle()
      : Promise.resolve({ data: null as { id: string } | null }),
  ]);

  const reviewWords = (reviewWordsRes.data ?? []) as ReviewWord[];
  const attemptsByWord = new Map<string, { attempt_no: number; is_correct: boolean; submitted_spelling: string; correct_answers: string[] }[]>();
  for (const a of attemptsRes.data ?? []) {
    attemptsByWord.set(a.word_id, [...(attemptsByWord.get(a.word_id) ?? []), a]);
  }

  const { data: audioFiles } = audioSubmissionRes.data
    ? await supabase.from("vocabulary_audio_submission_files").select("word_id").eq("vocabulary_audio_submission_id", audioSubmissionRes.data.id)
    : { data: [] as { word_id: string }[] };
  const recordedAudioWordIds = new Set((audioFiles ?? []).map((f) => f.word_id));

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link href={`/student/vocabulary/${id}`} className="text-sm text-slate-500 hover:underline">
          ← 返回作业详情
        </Link>
        <h1 className="text-2xl font-semibold">练习详情</h1>
        <p className="text-sm text-slate-500">
          共 {session.total_words} 个，{session.completed_at ? `完成于 ${new Date(session.completed_at).toLocaleString("zh-CN")}` : "进行中"}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {reviewWords.map((w) => {
          const attempts = attemptsByWord.get(w.word_id) ?? [];
          const first = attempts.find((a) => a.attempt_no === 1);
          const retries = attempts.filter((a) => a.attempt_no > 1);
          const isAudio = w.input_mode === "audio";
          const label = [w.prompt_term, w.prompt_meaning].filter(Boolean).join(" / ") || "（未命名）";

          return (
            <div key={w.word_id} className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
              <p className="font-medium">{label}</p>

              {isAudio ? (
                <p className={`text-sm ${recordedAudioWordIds.has(w.word_id) ? "text-green-700" : "text-slate-400"}`}>
                  {recordedAudioWordIds.has(w.word_id) ? "已录音" : "未录音"}
                </p>
              ) : first ? (
                <div className="flex flex-col gap-1">
                  <p className={`text-sm ${first.is_correct ? "text-green-700" : "text-red-600"}`}>
                    {first.is_correct ? "首次作答正确" : `首次作答错误：${first.submitted_spelling}`}
                  </p>
                  {!first.is_correct ? (
                    <p className="text-sm text-slate-600">正确答案：{first.correct_answers.join("、")}</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-400">未作答</p>
              )}

              {retries.length > 0 ? (
                <details className="text-sm text-slate-500">
                  <summary className="cursor-pointer">重试记录（{retries.length} 次）</summary>
                  <ul className="mt-1 flex flex-col gap-1 pl-4">
                    {retries.map((r, i) => (
                      <li key={i} className={r.is_correct ? "text-green-700" : "text-red-600"}>
                        第 {r.attempt_no} 次：{r.submitted_spelling}（{r.is_correct ? "正确" : "错误"}）
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          );
        })}
        {reviewWords.length === 0 ? <p className="text-sm text-slate-400">该作业暂无单词。</p> : null}
      </div>
    </div>
  );
}
