"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addStudentsToLessonSummary } from "@/app/actions/summaries";
import { getClassRoster } from "@/app/actions/classes";

type ClassOption = { id: string; name: string };
type StudentOption = { id: string; fullName: string };

// Post-creation variant of app/teacher/summaries/new/target-picker.tsx --
// see app/teacher/exams/[id]/add-students-form.tsx for the shared design
// rationale (excludes already-targeted students from both sections).
export function AddStudentsForm({
  summaryId,
  classes,
  students,
  existingStudentIds,
}: {
  summaryId: string;
  classes: ClassOption[];
  students: StudentOption[];
  existingStudentIds: string[];
}) {
  const router = useRouter();
  const existing = new Set(existingStudentIds);
  const availableStudents = students.filter((s) => !existing.has(s.id));

  const [usedClassIds, setUsedClassIds] = useState<string[]>([]);
  const [checkedStudentIds, setCheckedStudentIds] = useState<string[]>([]);
  const [loadingClassId, setLoadingClassId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
        for (const s of result.students) if (!existing.has(s.id)) next.add(s.id);
        return [...next];
      });
    });
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await addStudentsToLessonSummary(summaryId, checkedStudentIds, usedClassIds);
      if (result.ok) {
        setUsedClassIds([]);
        setCheckedStudentIds([]);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-4">
      <h2 className="font-medium">添加学生</h2>
      <div className="flex flex-col gap-2">
        <span className="text-sm text-slate-700">从班级快速选择（可选）</span>
        {classes.length === 0 ? (
          <p className="text-sm text-slate-400">还没有班级。</p>
        ) : (
          classes.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={usedClassIds.includes(c.id)} onChange={() => toggleClass(c.id)} />
              {c.name}
              {loadingClassId === c.id ? <span className="text-xs text-slate-400">加载中…</span> : null}
            </label>
          ))
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm text-slate-700">学生名单</span>
        {availableStudents.length > 0 ? (
          availableStudents.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={checkedStudentIds.includes(s.id)} onChange={() => toggleStudent(s.id)} />
              {s.fullName}
            </label>
          ))
        ) : (
          <p className="text-sm text-slate-400">所有学生都已添加。</p>
        )}
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={pending || checkedStudentIds.length === 0}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "处理中…" : "添加选中的学生"}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
