import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

type ReviewWord = {
  word_id: string;
  source_sort_order: number;
  prompt_term: string | null;
  prompt_meaning: string | null;
  input_mode: string;
  prompt_question: string | null;
};

// Per-question review for one practice session, linked from the 练习情况
// stats table. Calls get_vocabulary_session_words_review() for the prompt
// labels -- the sanctioned read path: practice_session_words has no direct
// grant to `authenticated` and holds correct_answers, which must never
// reach a student directly, so this RPC (teacher-or-owning-student scoped)
// is the only legal way to read prompt labels for a session. Correctness
// data comes from a plain select on vocabulary_attempts, which is already
// table-wide select-granted and RLS-scoped. Works uniformly for a v1 or a
// v2 session -- get_vocabulary_session_words_review has no engine guard,
// and every v1 session now also carries real prompt_term/prompt_meaning/
// input_mode/correct_answers (see the B-ADD migration).
export default async function SessionReviewPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("practice_sessions")
    .select("id, set_id, student_id, completed_at, total_words, audio_word_count, practice_engine_version, students(profiles(full_name))")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session || session.set_id !== id) {
    notFound();
  }

  const [reviewWordsRes, attemptsRes, audioSubmissionRes, tabEventsRes] = await Promise.all([
    supabase.rpc("get_vocabulary_session_words_review", { p_session_id: sessionId }),
    supabase
      .from("vocabulary_attempts")
      .select("word_id, attempt_no, is_correct, submitted_spelling, correct_answers")
      .eq("session_id", sessionId)
      .order("attempt_no", { ascending: true }),
    session.audio_word_count > 0
      ? supabase.from("vocabulary_audio_submissions").select("id").eq("session_id", sessionId).maybeSingle()
      : Promise.resolve({ data: null as { id: string } | null }),
    supabase
      .from("practice_session_tab_events")
      .select("event_type, occurred_at")
      .eq("session_id", sessionId)
      .order("occurred_at", { ascending: true }),
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

  const studentName = session.students?.profiles?.full_name ?? "未知学生";

  // Pairs consecutive hidden/visible rows into away-intervals. Must tolerate
  // missing/unpaired rows (a failed network call, a beacon that never
  // arrived, a session that ended mid-away) rather than assuming strict
  // alternation: a second back-to-back 'hidden' flushes the still-open
  // interval first, and a trailing unmatched 'hidden' becomes
  // returnedAt: null instead of crashing or mis-pairing. A stray 'visible'
  // with no pending 'hidden' can't happen from the client logic, but is
  // simply ignored rather than assumed impossible.
  type TabEventPair = { leftAt: string; returnedAt: string | null };
  const tabEvents = (tabEventsRes.data ?? []) as { event_type: "hidden" | "visible"; occurred_at: string }[];
  const tabEventPairs: TabEventPair[] = [];
  let pendingLeftAt: string | null = null;
  for (const e of tabEvents) {
    if (e.event_type === "hidden") {
      if (pendingLeftAt) tabEventPairs.push({ leftAt: pendingLeftAt, returnedAt: null });
      pendingLeftAt = e.occurred_at;
    } else if (pendingLeftAt) {
      tabEventPairs.push({ leftAt: pendingLeftAt, returnedAt: e.occurred_at });
      pendingLeftAt = null;
    }
  }
  if (pendingLeftAt) tabEventPairs.push({ leftAt: pendingLeftAt, returnedAt: null });

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link href={`/teacher/vocabulary/${id}`} className="text-sm text-slate-500 hover:underline">
          ← 返回作业详情
        </Link>
        <h1 className="text-2xl font-semibold">{studentName} 的练习详情</h1>
        <p className="text-sm text-slate-500">
          共 {session.total_words} 个，{session.completed_at ? "已结束" : "进行中"}
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
        <h2 className="font-medium">标签页切换记录（共 {tabEventPairs.length} 次离开）</h2>
        {tabEventPairs.length === 0 ? (
          <p className="text-sm text-slate-400">未检测到离开记录。</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {tabEventPairs.map((pair, i) => {
              const durationSeconds = pair.returnedAt
                ? Math.round((new Date(pair.returnedAt).getTime() - new Date(pair.leftAt).getTime()) / 1000)
                : null;
              return (
                <li key={i} className="text-slate-600">
                  离开 {formatTime(pair.leftAt)} → {pair.returnedAt ? `返回 ${formatTime(pair.returnedAt)}（${durationSeconds} 秒）` : "尚未返回"}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {reviewWords.map((w) => {
          const attempts = attemptsByWord.get(w.word_id) ?? [];
          const first = attempts.find((a) => a.attempt_no === 1);
          const retries = attempts.filter((a) => a.attempt_no > 1);
          const isAudio = w.input_mode === "audio";
          const label =
            w.input_mode === "multiple_choice"
              ? w.prompt_question || "（未命名）"
              : [w.prompt_term, w.prompt_meaning].filter(Boolean).join(" / ") || "（未命名）";

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
