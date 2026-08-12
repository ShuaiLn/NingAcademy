"use client";

import { useState, useTransition } from "react";
import { setStudentActive } from "@/app/actions/students";

export function StudentActiveToggle({
  studentId,
  initialActive,
}: {
  studentId: string;
  initialActive: boolean;
}) {
  const [active, setActive] = useState(initialActive);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await setStudentActive(studentId, !active);
            if (result.ok) {
              setActive(!active);
            } else {
              setError(result.error);
            }
          });
        }}
        className={`rounded-md px-3 py-1 text-sm ${
          active
            ? "border border-slate-300 text-slate-700 hover:border-slate-400"
            : "bg-slate-900 text-white"
        } disabled:opacity-50`}
      >
        {active ? "停用" : "启用"}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
