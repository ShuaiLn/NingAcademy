"use client";

import { useState } from "react";

// Given a stored UTC ISO string, builds the datetime-local value from the
// Date object's *local* getters (getFullYear/getMonth/getDate/getHours/
// getMinutes -- already local-timezone-adjusted by the JS spec, unlike the
// getUTC* family). Naively slicing the first 16 characters of the ISO
// string would display the UTC wall-clock time mislabeled as local, wrong
// for any viewer not in UTC.
function isoToLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The visible datetime-local input carries NO `name` attribute at all --
// only the hidden input does. If both carried the same name, FormData would
// pick up whichever the browser orders last, non-deterministically
// defeating the UTC conversion below; keeping the visible control name-less
// makes it purely a local UI widget whose value is read via onChange, never
// submitted directly. Conversion happens in the browser -- the only place
// that knows the visitor's real timezone -- so the Server Action always
// receives a ready-to-use UTC ISO string (or "" to clear the due date).
export function DueDateInput({
  label = "截止时间（可选）",
  defaultValue,
}: {
  label?: string;
  defaultValue?: string | null;
}) {
  const [localValue, setLocalValue] = useState(defaultValue ? isoToLocalInputValue(defaultValue) : "");
  const [isoValue, setIsoValue] = useState(defaultValue ?? "");

  function handleChange(next: string) {
    setLocalValue(next);
    if (!next) {
      // new Date("").toISOString() throws (Invalid Date) -- clearing the
      // visible input must write "" directly, never attempt the conversion.
      setIsoValue("");
      return;
    }
    setIsoValue(new Date(next).toISOString());
  }

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-700">{label}</span>
      <input
        type="datetime-local"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
      />
      <input type="hidden" name="due_at" value={isoValue} />
    </label>
  );
}
