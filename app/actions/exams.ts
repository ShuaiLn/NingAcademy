"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

// Mirrors parseIdsField in actions/assignments.ts -- the target-picker
// checkbox lists serialize into hidden JSON fields rather than repeated
// same-name checkbox inputs.
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

export type CreateExamResult = { ok: false; error: string };

// create_exam_with_students() inserts the exam and its exam_scores rows (one
// per targeted student, score starting NULL) in the same transaction, and
// rejects an empty student list outright -- unlike assignments/vocabulary
// sets there is no later "content added after creation" step distinct from
// targeting here. p_student_ids is the exact, final, teacher-confirmed list
// the target-picker resolved client-side -- the server never re-expands
// p_source_class_ids for targeting, only records them informationally.
export async function createExamWithStudents(
  _prevState: CreateExamResult,
  formData: FormData
): Promise<CreateExamResult> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const examDate = String(formData.get("examDate") ?? "").trim();
  const fullMarksRaw = String(formData.get("fullMarks") ?? "").trim();
  const studentIds = parseIdsField(formData.get("studentIds"));
  const sourceClassIds = parseIdsField(formData.get("sourceClassIds"));

  if (!title) {
    return { ok: false, error: "请填写考试名称" };
  }
  if (!examDate) {
    return { ok: false, error: "请选择考试日期" };
  }
  if (studentIds.length === 0) {
    return { ok: false, error: "请至少选择一位学生" };
  }
  const fullMarks = fullMarksRaw === "" ? null : Number(fullMarksRaw);
  if (fullMarks !== null && (Number.isNaN(fullMarks) || fullMarks <= 0)) {
    return { ok: false, error: "满分格式不正确" };
  }

  const supabase = await createClient();
  const { data: examId, error } = await supabase.rpc("create_exam_with_students", {
    p_title: title,
    p_description: description,
    p_exam_date: examDate,
    p_full_marks: fullMarks as unknown as number,
    p_student_ids: studentIds,
    p_source_class_ids: sourceClassIds,
  });

  if (error || !examId) {
    return { ok: false, error: "创建失败，请稍后重试" };
  }

  revalidatePath("/teacher/exams");
  redirect(`/teacher/exams/${examId}`);
}

export type UpdateExamResult = { ok: false; error: string };

export async function updateExamDetails(
  _prevState: UpdateExamResult,
  formData: FormData
): Promise<UpdateExamResult> {
  const examId = String(formData.get("examId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const examDate = String(formData.get("examDate") ?? "").trim();
  const fullMarksRaw = String(formData.get("fullMarks") ?? "").trim();

  if (!title) {
    return { ok: false, error: "考试名称不能为空" };
  }
  if (!examDate) {
    return { ok: false, error: "请选择考试日期" };
  }
  const fullMarks = fullMarksRaw === "" ? null : Number(fullMarksRaw);
  if (fullMarks !== null && (Number.isNaN(fullMarks) || fullMarks <= 0)) {
    return { ok: false, error: "满分格式不正确" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("exams")
    .update(
      { title, description: description || null, exam_date: examDate, full_marks: fullMarks },
      { count: "exact" }
    )
    .eq("id", examId);

  if (error?.code === "22023") {
    return { ok: false, error: "满分不能低于已录入的分数" };
  }
  if (error || !count) {
    return { ok: false, error: "保存失败，请稍后重试" };
  }

  revalidatePath(`/teacher/exams/${examId}`);
  redirect(`/teacher/exams/${examId}`);
}

export type ArchiveExamResult = { ok: true } | { ok: false; error: string };

export async function archiveExam(examId: string): Promise<ArchiveExamResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("exams")
    .update({ archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", examId)
    .is("archived_at", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/exams/${examId}`);
  revalidatePath("/teacher/exams");
  return { ok: true };
}

export async function unarchiveExam(examId: string): Promise<ArchiveExamResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("exams")
    .update({ archived_at: null }, { count: "exact" })
    .eq("id", examId)
    .not("archived_at", "is", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/exams/${examId}`);
  revalidatePath("/teacher/exams");
  return { ok: true };
}

export type AddStudentsToExamResult = { ok: true } | { ok: false; error: string };

// exam_scores has no INSERT grant to authenticated at all -- this always
// goes through add_students_to_exam(), which locks the exams row before
// checking archived_at (closing the archive/add race) and no-ops on a
// student already targeted (never resets an in-progress score).
export async function addStudentsToExam(
  examId: string,
  studentIds: string[],
  sourceClassIds: string[]
): Promise<AddStudentsToExamResult> {
  if (studentIds.length === 0) {
    return { ok: false, error: "请至少选择一位学生" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_students_to_exam", {
    p_exam_id: examId,
    p_student_ids: studentIds,
    p_source_class_ids: sourceClassIds,
  });

  if (error) {
    return { ok: false, error: "添加失败，请确认考试未归档" };
  }

  revalidatePath(`/teacher/exams/${examId}`);
  return { ok: true };
}

export type GradeExamScoreResult = { ok: true } | { ok: false; error: string };

// Plain RLS-scoped write, same shape as gradeSubmission -- score/
// feedback_text are column-granted for UPDATE to authenticated, no RPC
// needed. score > full_marks or score < 0 is rejected by exam_scores'
// triggers/CHECK constraints at the database layer.
export async function gradeExamScore(
  examScoreId: string,
  score: number | null,
  feedbackText: string
): Promise<GradeExamScoreResult> {
  if (score !== null && (Number.isNaN(score) || score < 0)) {
    return { ok: false, error: "分数格式不正确" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("exam_scores")
    .update({ score, feedback_text: feedbackText || null }, { count: "exact" })
    .eq("id", examScoreId);

  if (error?.code === "22023") {
    return { ok: false, error: "分数不能超过满分" };
  }
  if (error || !count) {
    return { ok: false, error: "保存失败，请稍后重试" };
  }

  revalidatePath("/teacher/exams");
  return { ok: true };
}

export type DeleteExamScoreResult = { ok: true } | { ok: false; error: string };

// Hard delete -- the only "un-target" mechanism for exam_scores (no
// revoked_at, see migration header). Fails with 23503 while any
// exam_score_files row still references it; deleteExamScoreFile() must be
// called first for each attached photo.
export async function deleteExamScore(examId: string, examScoreId: string): Promise<DeleteExamScoreResult> {
  const supabase = await createClient();
  const { error, count } = await supabase.from("exam_scores").delete({ count: "exact" }).eq("id", examScoreId);

  if (error?.code === "23503") {
    return { ok: false, error: "该学生已上传试卷照片，无法删除，请先删除照片" };
  }
  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/exams/${examId}`);
  return { ok: true };
}

export type DeleteExamScoreFileResult = { ok: true } | { ok: false; error: string };

// Revoke-access-now, reclaim-bytes-later -- see delete_exam_score_file()'s
// comment in the migration. The Storage object itself is only actually
// removed by the periodic cleanup Edge Function.
export async function deleteExamScoreFile(examId: string, fileId: string): Promise<DeleteExamScoreFileResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_exam_score_file", { p_file_id: fileId });

  if (error) {
    return { ok: false, error: "删除失败，请稍后重试" };
  }

  revalidatePath(`/teacher/exams/${examId}`);
  return { ok: true };
}
