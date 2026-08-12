import { createClient } from "@/utils/supabase/server";
import { GradingForm } from "./grading-form";

// Audio playback: signed URLs generated server-side per page load, ~10 min
// TTL -- see attached-files-list.tsx's comment in app/teacher/assignments/
// for the precise security property this relies on (RLS gates generation,
// not access after issuance).
export async function SubmissionsPanel({ taskId }: { taskId: string }) {
  const supabase = await createClient();
  const { data: submissions } = await supabase
    .from("audio_submissions")
    .select(
      "id, attempt_no, note, submitted_at, score, feedback_text, students(profiles(full_name)), audio_submission_files(id, task_word_id, file_name, storage_object_key)"
    )
    .eq("task_id", taskId)
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false });

  if (!submissions || submissions.length === 0) {
    return <p className="text-sm text-slate-400">还没有学生提交。</p>;
  }

  const { data: taskWords } = await supabase
    .from("pronunciation_task_words")
    .select("id, text_prompt")
    .eq("task_id", taskId);
  const promptByWordId = new Map((taskWords ?? []).map((w) => [w.id, w.text_prompt]));

  const submissionsWithUrls = await Promise.all(
    submissions.map(async (s) => {
      const files = await Promise.all(
        (s.audio_submission_files ?? []).map(async (f) => {
          const { data } = await supabase.storage.from("attachments").createSignedUrl(f.storage_object_key, 600);
          return {
            ...f,
            prompt: f.task_word_id ? (promptByWordId.get(f.task_word_id) ?? null) : null,
            url: data?.signedUrl ?? null,
          };
        })
      );
      return { ...s, files };
    })
  );

  return (
    <div className="flex flex-col gap-4">
      {submissionsWithUrls.map((s) => (
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
                  {f.prompt ? <p className="text-sm text-slate-700">{f.prompt}</p> : null}
                  {f.url ? (
                    <audio controls src={f.url} className="w-full" />
                  ) : (
                    <p className="text-sm text-slate-400">{f.file_name}（链接生成失败）</p>
                  )}
                </div>
              ))
            )}
          </div>
          <GradingForm audioSubmissionId={s.id} score={s.score} feedbackText={s.feedback_text} />
        </div>
      ))}
    </div>
  );
}
