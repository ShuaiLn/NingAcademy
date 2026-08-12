"use client";

import { useState, useTransition } from "react";
import { createSubmission } from "@/app/actions/submissions";

// createSubmission() redirects to the new draft's page on success -- Next.js
// server actions can call redirect() whether invoked via a <form action> or,
// as here, a plain async call from a client event handler; the thrown
// redirect is intercepted by the client runtime either way, same pattern as
// StartPracticeButton in app/student/vocabulary/.
export function StartSubmissionForm({ assignmentId }: { assignmentId: string }) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-700">备注（可选）</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
        />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await createSubmission(assignmentId, note);
            if (!result.ok) setError(result.error);
          });
        }}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "创建中…" : "开始提交"}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
