"use client";

import { useState } from "react";

type StudentOption = { id: string; fullName: string };

// Colocated, not shared -- duplicated per creation form that needs it,
// matching the existing WordRowsEditor-style colocated-reuse scope. This
// variant has no classes section: vocabulary_targets has no class_id
// column at all, unlike assignment_targets/pronunciation_targets.
export function TargetPicker({ students }: { students: StudentOption[] }) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-slate-700">指定学生</span>
      {students.length === 0 ? (
        <p className="text-sm text-slate-400">还没有学生。</p>
      ) : (
        <div className="flex flex-col gap-1">
          {students.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
              {s.fullName}
            </label>
          ))}
        </div>
      )}
      <input type="hidden" name="studentIds" value={JSON.stringify(selected)} />
    </div>
  );
}
