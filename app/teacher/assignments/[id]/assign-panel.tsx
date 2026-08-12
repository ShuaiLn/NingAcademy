"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignAssignmentToTargets, unassignAssignmentTarget } from "@/app/actions/assignments";

type ClassOption = { id: string; name: string };
type StudentOption = { id: string; fullName: string };
type TargetRow = { id: string; classId: string | null; studentId: string | null };

// Unlike vocabulary_targets (unassigned by student_id directly),
// assignment_targets rows carry either a class_id or a student_id and
// unassignAssignmentTarget() needs the target row's own id -- which
// assignAssignmentToTargets() doesn't return. router.refresh() after each
// mutation re-fetches the parent Server Component's `targets` prop (with
// real ids) instead of trying to track them optimistically client-side.
export function AssignPanel({
  assignmentId,
  allClasses,
  allStudents,
  targets,
}: {
  assignmentId: string;
  allClasses: ClassOption[];
  allStudents: StudentOption[];
  targets: TargetRow[];
}) {
  const router = useRouter();
  const assignedClassIds = new Set(targets.filter((t) => t.classId).map((t) => t.classId as string));
  const assignedStudentIds = new Set(targets.filter((t) => t.studentId).map((t) => t.studentId as string));
  const unassignedClasses = allClasses.filter((c) => !assignedClassIds.has(c.id));
  const unassignedStudents = allStudents.filter((s) => !assignedStudentIds.has(s.id));

  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleClass(id: string) {
    setSelectedClasses((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleStudent(id: string) {
    setSelectedStudents((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleAssign() {
    setError(null);
    startTransition(async () => {
      const result = await assignAssignmentToTargets(assignmentId, selectedClasses, selectedStudents);
      if (result.ok) {
        setSelectedClasses([]);
        setSelectedStudents([]);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleUnassign(targetId: string) {
    setError(null);
    startTransition(async () => {
      const result = await unassignAssignmentTarget(assignmentId, targetId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">指定班级/学生</h2>
      <div className="flex flex-col gap-3 sm:grid sm:grid-cols-2 sm:gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-slate-700">班级</span>
          {unassignedClasses.length > 0 ? (
            unassignedClasses.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedClasses.includes(c.id)} onChange={() => toggleClass(c.id)} />
                {c.name}
              </label>
            ))
          ) : (
            <p className="text-sm text-slate-400">所有班级都已被指定。</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-slate-700">学生</span>
          {unassignedStudents.length > 0 ? (
            unassignedStudents.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedStudents.includes(s.id)}
                  onChange={() => toggleStudent(s.id)}
                />
                {s.fullName}
              </label>
            ))
          ) : (
            <p className="text-sm text-slate-400">所有学生都已被指定。</p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={handleAssign}
        disabled={pending || (selectedClasses.length === 0 && selectedStudents.length === 0)}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "处理中…" : "指定选中项"}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
        <span className="text-sm text-slate-700">已指定</span>
        {targets.length === 0 ? (
          <p className="text-sm text-slate-400">还没有指定任何班级或学生。</p>
        ) : (
          targets.map((t) => {
            const label = t.classId
              ? (allClasses.find((c) => c.id === t.classId)?.name ?? "未知班级")
              : (allStudents.find((s) => s.id === t.studentId)?.fullName ?? "未知学生");
            return (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <span>
                  {label}
                  {t.classId ? <span className="ml-1 text-xs text-slate-400">（班级）</span> : null}
                </span>
                <button
                  type="button"
                  onClick={() => handleUnassign(t.id)}
                  disabled={pending}
                  className="rounded-md border border-slate-300 px-3 py-1 text-slate-600 hover:border-slate-400 disabled:opacity-50"
                >
                  取消指定
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
