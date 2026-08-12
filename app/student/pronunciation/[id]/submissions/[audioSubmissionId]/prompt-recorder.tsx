"use client";

import { useRouter } from "next/navigation";
import { AudioRecorder } from "@/app/_components/audio-recorder";

export function PromptRecorder({
  audioSubmissionId,
  taskWordId,
  textPrompt,
  existingUrls,
}: {
  audioSubmissionId: string;
  taskWordId: string;
  textPrompt: string;
  existingUrls: string[];
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
      <p className="text-sm font-medium">{textPrompt}</p>
      {existingUrls.map((url, i) => (
        <audio key={i} controls src={url} className="w-full" />
      ))}
      <AudioRecorder audioSubmissionId={audioSubmissionId} taskWordId={taskWordId} onUploaded={() => router.refresh()} />
    </div>
  );
}
