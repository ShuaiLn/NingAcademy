"use client";

import { useState, useTransition } from "react";
import { getClassRoster } from "@/app/actions/classes";

type ClassOption = { id: string; name: string };
type StudentOption = { id: string; fullName: string };

// Same shape as app/teacher/exams/new/target-picker.tsx -- see that file's
// comment for why class targeting is a one-time roster-resolution
// convenience rather than a persistent binding.
export function TargetPicker({ classes, students }: { classes: ClassOption[]; students: StudentOption[] }) {
  const [usedClassIds, setUsedClassIds] = useState<string[]>([]);
  const [checkedStudentIds, setCheckedStudentIds] = useState<string[]>([]);
  const [loadingClassId, setLoadingClassId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggleStudent(id: string) {
    setCheckedStudentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleClass(classId: string) {
    if (usedClassIds.includes(classId)) {
      setUsedClassIds((prev) => prev.filter((x) => x !== classId));
      return;
    }
    setUsedClassIds((prev) => [...prev, classId]);
    setError(null);
    setLoadingClassId(classId);
    startTransition(async () => {
      const result = await getClassRoster(classId);
      setLoadingClassId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCheckedStudentIds((prev) => {
        const next = new Set(prev);
        for (const s of result.students) next.add(s.id);
        return [...next];
      });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700">从班级快速选择（可选）</span>
        {classes.length === 0 ? (
          <p className="text-sm text-slate-400">还没有班级。</p>
        ) : (
          <div className="flex flex-col gap-1">
            {classes.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={usedClassIds.includes(c.id)} onChange={() => toggleClass(c.id)} />
                {c.name}
                {loadingClassId === c.id ? <span className="text-xs text-slate-400">加载中…</span> : null}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700">学生名单</span>
        {students.length === 0 ? (
          <p className="text-sm text-slate-400">还没有学生。</p>
        ) : (
          <div className="flex flex-col gap-1">
            {students.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checkedStudentIds.includes(s.id)}
                  onChange={() => toggleStudent(s.id)}
                />
                {s.fullName}
              </label>
            ))}
          </div>
        )}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <input type="hidden" name="studentIds" value={JSON.stringify(checkedStudentIds)} />
      <input type="hidden" name="sourceClassIds" value={JSON.stringify(usedClassIds)} />
    </div>
  );
}
