"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finishAudioSubmission } from "@/app/actions/audio-submissions";

export function FinishAudioSubmissionButton({
  audioSubmissionId,
  taskId,
}: {
  audioSubmissionId: string;
  taskId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await finishAudioSubmission(audioSubmissionId);
            if (result.ok) {
              router.push(`/student/pronunciation/${taskId}`);
              router.refresh();
            } else {
              setError(result.error);
            }
          });
        }}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "提交中…" : "提交跟读"}
      </button>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
}
