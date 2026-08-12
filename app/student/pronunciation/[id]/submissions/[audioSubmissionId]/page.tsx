import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { PromptRecorder } from "./prompt-recorder";
import { FinishAudioSubmissionButton } from "./finish-audio-submission-button";

export default async function AudioSubmissionDraftPage({
  params,
}: {
  params: Promise<{ id: string; audioSubmissionId: string }>;
}) {
  const { id, audioSubmissionId } = await params;
  const supabase = await createClient();

  const { data: submission } = await supabase
    .from("audio_submissions")
    .select("id, note, submitted_at, task_id")
    .eq("id", audioSubmissionId)
    .maybeSingle();

  if (!submission || submission.task_id !== id) {
    notFound();
  }

  const { data: words } = await supabase
    .from("pronunciation_task_words")
    .select("id, text_prompt")
    .eq("task_id", id)
    .is("archived_at", null)
    .order("sort_order", { ascending: true });

  const { data: files } = await supabase
    .from("audio_submission_files")
    .select("id, task_word_id, storage_object_key")
    .eq("audio_submission_id", audioSubmissionId);

  const wordRows = await Promise.all(
    (words ?? []).map(async (w) => {
      const wordFiles = (files ?? []).filter((f) => f.task_word_id === w.id);
      const urls = await Promise.all(
        wordFiles.map(async (f) => {
          const { data } = await supabase.storage.from("attachments").createSignedUrl(f.storage_object_key, 600);
          return data?.signedUrl ?? null;
        })
      );
      return { id: w.id, textPrompt: w.text_prompt, urls: urls.filter((u): u is string => !!u) };
    })
  );

  if (submission.submitted_at) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <h1 className="text-2xl font-semibold">提交详情</h1>
        <p className="text-sm text-slate-500">已提交</p>
        {wordRows.map((w) => (
          <div key={w.id} className="flex flex-col gap-1 rounded-md border border-slate-200 p-3">
            <p className="text-sm font-medium">{w.textPrompt}</p>
            {w.urls.length === 0 ? (
              <p className="text-xs text-slate-400">未录制</p>
            ) : (
              w.urls.map((url, i) => <audio key={i} controls src={url} className="w-full" />)
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">跟读录音</h1>
      {wordRows.length === 0 ? (
        <p className="text-sm text-slate-400">老师还未添加跟读内容。</p>
      ) : (
        wordRows.map((w) => (
          <PromptRecorder
            key={w.id}
            audioSubmissionId={audioSubmissionId}
            taskWordId={w.id}
            textPrompt={w.textPrompt}
            existingUrls={w.urls}
          />
        ))
      )}
      <FinishAudioSubmissionButton audioSubmissionId={audioSubmissionId} taskId={id} />
    </div>
  );
}
