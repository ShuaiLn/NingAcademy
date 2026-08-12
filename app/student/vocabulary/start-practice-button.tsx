"use client";

import { useState, useTransition } from "react";
import { startPracticeSession } from "@/app/actions/practice";

// start_practice_session() is idempotent server-side, so this same button
// covers both "开始练习" and "继续练习" -- on success it redirects and this
// component never sees a resolved value.
export function StartPracticeButton({ setId, resuming }: { setId: string; resuming: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await startPracticeSession(setId);
            if (!result.ok) {
              setError(result.error);
            }
          });
        }}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "加载中…" : resuming ? "继续练习" : "开始练习"}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
