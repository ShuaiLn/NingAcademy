"use client";

import { useState, useTransition } from "react";
import { assignStudentsToSet, unassignStudentFromSet } from "@/app/actions/vocabulary";

type StudentOption = { id: string; fullName: string };

export function AssignPanel({
  setId,
  allStudents,
  assignedStudentIds,
}: {
  setId: string;
  allStudents: StudentOption[];
  assignedStudentIds: string[];
}) {
  const [assigned, setAssigned] = useState<string[]>(assignedStudentIds);
  const unassignedStudents = allStudents.filter((s) => !assigned.includes(s.id));
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleAssign() {
    setError(null);
    startTransition(async () => {
      const result = await assignStudentsToSet(setId, selected);
      if (result.ok) {
        setAssigned((prev) => [...prev, ...selected]);
        setSelected([]);
      } else {
        setError(result.error);
      }
    });
  }

  function handleUnassign(studentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await unassignStudentFromSet(setId, studentId);
      if (result.ok) {
        setAssigned((prev) => prev.filter((id) => id !== studentId));
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">指定学生</h2>
      {unassignedStudents.length > 0 ? (
        <div className="flex flex-col gap-2">
          {unassignedStudents.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
              {s.fullName}
            </label>
          ))}
          <button
            type="button"
            onClick={handleAssign}
            disabled={pending || selected.length === 0}
            className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {pending ? "处理中…" : "指定选中学生"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-400">所有学生都已被指定。</p>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
        <span className="text-sm text-slate-700">已指定</span>
        {assigned.length === 0 ? (
          <p className="text-sm text-slate-400">还没有指定任何学生。</p>
        ) : (
          allStudents
            .filter((s) => assigned.includes(s.id))
            .map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span>{s.fullName}</span>
                <button
                  type="button"
                  onClick={() => handleUnassign(s.id)}
                  disabled={pending}
                  className="rounded-md border border-slate-300 px-3 py-1 text-slate-600 hover:border-slate-400 disabled:opacity-50"
                >
                  取消指定
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
