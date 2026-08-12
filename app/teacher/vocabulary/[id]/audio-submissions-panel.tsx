import { createClient } from "@/utils/supabase/server";
import { AudioGradingForm } from "./audio-grading-form";

// Mirrors pronunciation's submissions-panel.tsx. Labels each recording by
// calling get_vocabulary_session_words_review(submission.session_id) and
// joining client-side on word_id against the already-selectable
// vocabulary_audio_submission_files rows -- never live vocabulary_words, so
// a later word edit never relabels history, and never a raw
// practice_session_words query, which isn't reachable directly (no grant
// to authenticated). One aggregate score/feedback header per submission,
// plain word + <audio> list beneath it -- never a per-row score, so the UI
// can't be misread as per-word grading.
export async function AudioSubmissionsPanel({ setId }: { setId: string }) {
  const supabase = await createClient();
  const { data: submissions } = await supabase
    .from("vocabulary_audio_submissions")
    .select(
      "id, session_id, attempt_no, note, submitted_at, score, feedback_text, students(profiles(full_name)), vocabulary_audio_submission_files(id, word_id, file_name, storage_object_key)"
    )
    .eq("set_id", setId)
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false });

  if (!submissions || submissions.length === 0) {
    return <p className="text-sm text-slate-400">还没有学生提交跟读录音。</p>;
  }

  const submissionsWithDetails = await Promise.all(
    submissions.map(async (s) => {
      const { data: reviewWords } = await supabase.rpc("get_vocabulary_session_words_review", {
        p_session_id: s.session_id,
      });
      const labelByWordId = new Map((reviewWords ?? []).map((w) => [w.word_id, [w.prompt_term, w.prompt_meaning].filter(Boolean).join(" / ") || "（未命名）"]));

      const files = await Promise.all(
        (s.vocabulary_audio_submission_files ?? []).map(async (f) => {
          const { data } = await supabase.storage.from("attachments").createSignedUrl(f.storage_object_key, 600);
          return { ...f, label: labelByWordId.get(f.word_id) ?? "（未知单词）", url: data?.signedUrl ?? null };
        })
      );
      return { ...s, files };
    })
  );

  return (
    <div className="flex flex-col gap-4">
      {submissionsWithDetails.map((s) => (
        <div key={s.id} className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium">{s.students?.profiles?.full_name ?? "未知学生"}</p>
            <p className="text-xs text-slate-400">第 {s.attempt_no} 次提交</p>
          </div>
          {s.note ? <p className="text-sm text-slate-600">{s.note}</p> : null}
          <div className="flex flex-col gap-2">
            {s.files.length === 0 ? (
              <p className="text-sm text-slate-400">还没有录音。</p>
            ) : (
              s.files.map((f) => (
                <div key={f.id} className="flex flex-col gap-1">
                  <p className="text-sm text-slate-700">{f.label}</p>
                  {f.url ? (
                    <audio controls src={f.url} className="w-full" />
                  ) : (
                    <p className="text-sm text-slate-400">{f.file_name}（链接生成失败）</p>
                  )}
                </div>
              ))
            )}
          </div>
          <AudioGradingForm vocabularyAudioSubmissionId={s.id} score={s.score} feedbackText={s.feedback_text} />
        </div>
      ))}
    </div>
  );
}
