"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

// Mirrors parseIdsField in actions/exams.ts.
function parseIdsField(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id ?? "")).filter((id) => id.length > 0);
  } catch {
    return [];
  }
}

export type CreateLessonSummaryResult = { ok: false; error: string };

// create_lesson_summary_with_students() inserts the summary and its
// lesson_summary_targets rows (identical shared content for every targeted
// student) in the same transaction, and rejects an empty student list
// outright. p_student_ids is the exact, final, teacher-confirmed list the
// target-picker resolved client-side.
export async function createLessonSummaryWithStudents(
  _prevState: CreateLessonSummaryResult,
  formData: FormData
): Promise<CreateLessonSummaryResult> {
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const sessionDate = String(formData.get("sessionDate") ?? "").trim();
  const studentIds = parseIdsField(formData.get("studentIds"));
  const sourceClassIds = parseIdsField(formData.get("sourceClassIds"));

  if (!content) {
    return { ok: false, error: "请填写总结内容" };
  }
  if (!sessionDate) {
    return { ok: false, error: "请选择课程日期" };
  }
  if (studentIds.length === 0) {
    return { ok: false, error: "请至少选择一位学生" };
  }

  const supabase = await createClient();
  const { data: summaryId, error } = await supabase.rpc("create_lesson_summary_with_students", {
    p_title: title,
    p_content: content,
    p_session_date: sessionDate,
    p_student_ids: studentIds,
    p_source_class_ids: sourceClassIds,
  });

  if (error || !summaryId) {
    return { ok: false, error: "创建失败，请稍后重试" };
  }

  revalidatePath("/teacher/summaries");
  redirect(`/teacher/summaries/${summaryId}`);
}

export type UpdateLessonSummaryResult = { ok: false; error: string };

export async function updateLessonSummaryContent(
  _prevState: UpdateLessonSummaryResult,
  formData: FormData
): Promise<UpdateLessonSummaryResult> {
  const summaryId = String(formData.get("summaryId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const sessionDate = String(formData.get("sessionDate") ?? "").trim();

  if (!content) {
    return { ok: false, error: "总结内容不能为空" };
  }
  if (!sessionDate) {
    return { ok: false, error: "请选择课程日期" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("lesson_summaries")
    .update({ title: title || null, content, session_date: sessionDate }, { count: "exact" })
    .eq("id", summaryId);

  if (error || !count) {
    return { ok: false, error: "保存失败，请稍后重试" };
  }

  revalidatePath(`/teacher/summaries/${summaryId}`);
  redirect(`/teacher/summaries/${summaryId}`);
}

export type ArchiveLessonSummaryResult = { ok: true } | { ok: false; error: string };

export async function archiveLessonSummary(summaryId: string): Promise<ArchiveLessonSummaryResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("lesson_summaries")
    .update({ archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", summaryId)
    .is("archived_at", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/summaries/${summaryId}`);
  revalidatePath("/teacher/summaries");
  return { ok: true };
}

export async function unarchiveLessonSummary(summaryId: string): Promise<ArchiveLessonSummaryResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("lesson_summaries")
    .update({ archived_at: null }, { count: "exact" })
    .eq("id", summaryId)
    .not("archived_at", "is", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/summaries/${summaryId}`);
  revalidatePath("/teacher/summaries");
  return { ok: true };
}

export type AddStudentsToLessonSummaryResult = { ok: true } | { ok: false; error: string };

// lesson_summary_targets has no INSERT grant to authenticated at all -- this
// always goes through add_students_to_lesson_summary(), which locks the
// lesson_summaries row before checking archived_at and no-ops on a student
// already targeted.
export async function addStudentsToLessonSummary(
  summaryId: string,
  studentIds: string[],
  sourceClassIds: string[]
): Promise<AddStudentsToLessonSummaryResult> {
  if (studentIds.length === 0) {
    return { ok: false, error: "请至少选择一位学生" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_students_to_lesson_summary", {
    p_summary_id: summaryId,
    p_student_ids: studentIds,
    p_source_class_ids: sourceClassIds,
  });

  if (error) {
    return { ok: false, error: "添加失败，请确认总结未归档" };
  }

  revalidatePath(`/teacher/summaries/${summaryId}`);
  return { ok: true };
}

export type DeleteSummaryTargetResult = { ok: true } | { ok: false; error: string };

// Plain hard delete, no FK-guard branch needed -- lesson_summary_files
// references lesson_summaries directly, never this target row (see
// migration header), so this always succeeds even with shared photos
// already attached.
export async function deleteSummaryTarget(summaryId: string, studentId: string): Promise<DeleteSummaryTargetResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("lesson_summary_targets")
    .delete({ count: "exact" })
    .eq("summary_id", summaryId)
    .eq("student_id", studentId);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/summaries/${summaryId}`);
  return { ok: true };
}

export type DeleteLessonSummaryFileResult = { ok: true } | { ok: false; error: string };

// Revoke-access-now, reclaim-bytes-later -- see delete_lesson_summary_file()'s
// comment in the migration.
export async function deleteLessonSummaryFile(
  summaryId: string,
  fileId: string
): Promise<DeleteLessonSummaryFileResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_lesson_summary_file", { p_file_id: fileId });

  if (error) {
    return { ok: false, error: "删除失败，请稍后重试" };
  }

  revalidatePath(`/teacher/summaries/${summaryId}`);
  return { ok: true };
}
