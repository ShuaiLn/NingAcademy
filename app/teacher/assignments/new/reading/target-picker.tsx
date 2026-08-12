"use client";

import { useState } from "react";

type ClassOption = { id: string; name: string };
type StudentOption = { id: string; fullName: string };

// Colocated, not shared -- kept separate from the plain/vocabulary variants
// even though this one is byte-for-byte identical to plain/target-picker.tsx,
// matching this codebase's existing colocated-reuse convention.
export function TargetPicker({ classes, students }: { classes: ClassOption[]; students: StudentOption[] }) {
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);

  function toggleClass(id: string) {
    setSelectedClasses((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleStudent(id: string) {
    setSelectedStudents((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="flex flex-col gap-3 sm:grid sm:grid-cols-2 sm:gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700">指定班级</span>
        {classes.length === 0 ? (
          <p className="text-sm text-slate-400">还没有班级。</p>
        ) : (
          <div className="flex flex-col gap-1">
            {classes.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedClasses.includes(c.id)} onChange={() => toggleClass(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700">指定学生</span>
        {students.length === 0 ? (
          <p className="text-sm text-slate-400">还没有学生。</p>
        ) : (
          <div className="flex flex-col gap-1">
            {students.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedStudents.includes(s.id)}
                  onChange={() => toggleStudent(s.id)}
                />
                {s.fullName}
              </label>
            ))}
          </div>
        )}
      </div>
      <input type="hidden" name="classIds" value={JSON.stringify(selectedClasses)} />
      <input type="hidden" name="studentIds" value={JSON.stringify(selectedStudents)} />
    </div>
  );
}
