"use client";

import { useState, useTransition } from "react";
import { enrollStudentsInClass, unenrollStudentFromClass } from "@/app/actions/classes";

type StudentOption = { id: string; fullName: string };

// Mirrors app/teacher/vocabulary/[id]/assign-panel.tsx -- unenrollStudentFromClass
// takes (classId, studentId) directly, so optimistic client state works
// here without needing router.refresh() the way assignment_targets does.
export function RosterPanel({
  classId,
  allStudents,
  enrolledStudentIds,
}: {
  classId: string;
  allStudents: StudentOption[];
  enrolledStudentIds: string[];
}) {
  const [enrolled, setEnrolled] = useState<string[]>(enrolledStudentIds);
  const unenrolledStudents = allStudents.filter((s) => !enrolled.includes(s.id));
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleEnroll() {
    setError(null);
    startTransition(async () => {
      const result = await enrollStudentsInClass(classId, selected);
      if (result.ok) {
        setEnrolled((prev) => [...prev, ...selected]);
        setSelected([]);
      } else {
        setError(result.error);
      }
    });
  }

  function handleUnenroll(studentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await unenrollStudentFromClass(classId, studentId);
      if (result.ok) {
        setEnrolled((prev) => prev.filter((id) => id !== studentId));
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">班级成员</h2>
      {unenrolledStudents.length > 0 ? (
        <div className="flex flex-col gap-2">
          {unenrolledStudents.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
              {s.fullName}
            </label>
          ))}
          <button
            type="button"
            onClick={handleEnroll}
            disabled={pending || selected.length === 0}
            className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {pending ? "处理中…" : "加入选中学生"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-400">所有学生都已在班级中。</p>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
        <span className="text-sm text-slate-700">班级成员</span>
        {enrolled.length === 0 ? (
          <p className="text-sm text-slate-400">还没有学生。</p>
        ) : (
          allStudents
            .filter((s) => enrolled.includes(s.id))
            .map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span>{s.fullName}</span>
                <button
                  type="button"
                  onClick={() => handleUnenroll(s.id)}
                  disabled={pending}
                  className="rounded-md border border-slate-300 px-3 py-1 text-slate-600 hover:border-slate-400 disabled:opacity-50"
                >
                  移出班级
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
