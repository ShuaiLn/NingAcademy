"use client";

import { useEffect, useState } from "react";

// Receives the raw ISO string as a prop and formats it via toLocaleString(),
// which uses the *viewer's* browser timezone automatically -- correct for a
// teacher and a student in different timezones viewing the same UTC
// instant. The overdue boolean itself is a timezone-agnostic instant
// comparison either way, so it is computed server-side by the caller and
// passed down as a prop -- only the human-readable label needs to be a
// client component.
//
// "use client" doesn't mean browser-only -- this is still SSR'd then
// hydrated, and toLocaleString() depends on the runtime's local timezone
// (server vs. viewer's browser can differ), so formatting is deferred to a
// post-mount effect to avoid a hydration mismatch.
export function DueDateBadge({ dueAt, overdue }: { dueAt: string; overdue: boolean }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(new Date(dueAt).toLocaleString("zh-CN"));
  }, [dueAt]);

  return (
    <span className={overdue ? "text-red-600" : "text-slate-500"}>
      截止：{label ?? "…"}
      {overdue ? "（已逾期）" : ""}
    </span>
  );
}
