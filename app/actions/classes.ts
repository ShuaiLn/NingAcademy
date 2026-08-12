"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type CreateClassResult = { ok: false; error: string };

// Plain INSERT (unlike vocabulary_sets, there is no nested child-row to
// create atomically alongside it) -- classes has an INSERT RLS policy and
// INSERT grant to authenticated, scoped to teacher_id = caller.
export async function createClass(
  _prevState: CreateClassResult,
  formData: FormData
): Promise<CreateClassResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "请先登录" };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { ok: false, error: "请填写班级名称" };
  }

  const { data: created, error } = await supabase
    .from("classes")
    .insert({ teacher_id: user.id, name })
    .select("id")
    .single();

  if (error || !created) {
    return { ok: false, error: "创建失败，请稍后重试" };
  }

  revalidatePath("/teacher/classes");
  redirect(`/teacher/classes/${created.id}`);
}

export type UpdateClassResult = { ok: false; error: string };

export async function updateClassName(
  _prevState: UpdateClassResult,
  formData: FormData
): Promise<UpdateClassResult> {
  const classId = String(formData.get("classId") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return { ok: false, error: "班级名称不能为空" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("classes")
    .update({ name }, { count: "exact" })
    .eq("id", classId);

  if (error || !count) {
    return { ok: false, error: "保存失败，请稍后重试" };
  }

  revalidatePath(`/teacher/classes/${classId}`);
  redirect(`/teacher/classes/${classId}`);
}

export type ArchiveClassResult = { ok: true } | { ok: false; error: string };

export async function archiveClass(classId: string): Promise<ArchiveClassResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("classes")
    .update({ archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", classId)
    .is("archived_at", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/classes/${classId}`);
  revalidatePath("/teacher/classes");
  return { ok: true };
}

export type EnrollResult = { ok: true } | { ok: false; error: string };

// enrollments has no INSERT grant to authenticated at all -- this always
// goes through enroll_students_in_class(), which enforces "class must not
// be archived" and per-student ownership at the database layer.
export async function enrollStudentsInClass(classId: string, studentIds: string[]): Promise<EnrollResult> {
  if (studentIds.length === 0) {
    return { ok: false, error: "请至少选择一位学生" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("enroll_students_in_class", {
    p_class_id: classId,
    p_student_ids: studentIds,
  });

  if (error) {
    return { ok: false, error: "添加失败，请确认班级未归档" };
  }

  revalidatePath(`/teacher/classes/${classId}`);
  return { ok: true };
}

export type ClassRosterResult =
  | { ok: true; students: { id: string; fullName: string }[] }
  | { ok: false; error: string };

// Read-only helper for client components that need a class's *current*
// roster on demand (e.g. the exam/lesson-summary target-picker resolving a
// selected class into individual student checkboxes at pick time -- see
// app/teacher/exams/new/target-picker.tsx). Same query app/teacher/classes/
// [id]/page.tsx already runs; RLS (enrollments_teacher_select) already scopes
// this to the caller's own classes, so no new grant is needed.
export async function getClassRoster(classId: string): Promise<ClassRosterResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrollments")
    .select("student_id, students(profiles(full_name))")
    .eq("class_id", classId)
    .is("unenrolled_at", null);

  if (error) {
    return { ok: false, error: "无法获取班级学生名单" };
  }

  return {
    ok: true,
    students: (data ?? []).map((e) => ({
      id: e.student_id,
      fullName: e.students?.profiles?.full_name ?? "",
    })),
  };
}

export type UnenrollResult = { ok: true } | { ok: false; error: string };

export async function unenrollStudentFromClass(classId: string, studentId: string): Promise<UnenrollResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("enrollments")
    .update({ unenrolled_at: new Date().toISOString() }, { count: "exact" })
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .is("unenrolled_at", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/classes/${classId}`);
  return { ok: true };
}
