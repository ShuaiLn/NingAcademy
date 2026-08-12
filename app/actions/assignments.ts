"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

// Mirrors parseWordsField in actions/vocabulary.ts -- the target-picker
// checkbox lists serialize into one hidden JSON field rather than repeated
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

// due-date-input.tsx converts to a UTC ISO string client-side (or "" to
// clear). p_due_at is timestamptz, so "" must become SQL NULL rather than
// nullif()'d server-side the way a text field would be -- see
// actions/vocabulary.ts's parseDueAtField comment for the generated-type
// caveat this shares.
function parseDueAtField(raw: FormDataEntryValue | null): string | null {
  const value = String(raw ?? "").trim();
  return value || null;
}

export type CreateAssignmentResult = { ok: false; error: string };

// Plain INSERT -- unlike vocabulary_sets, there is no atomic-creation RPC:
// attachments come later through the upload pipeline, not alongside
// creation, so there is no nested child-row to insert in the same
// transaction.
export async function createAssignment(
  _prevState: CreateAssignmentResult,
  formData: FormData
): Promise<CreateAssignmentResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "请先登录" };
  }

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!title) {
    return { ok: false, error: "请填写作业标题" };
  }

  const { data: created, error } = await supabase
    .from("assignments")
    .insert({ teacher_id: user.id, title, description: description || null })
    .select("id")
    .single();

  if (error || !created) {
    return { ok: false, error: "创建失败，请稍后重试" };
  }

  revalidatePath("/teacher/assignments");
  redirect(`/teacher/assignments/${created.id}`);
}

export type CreateAndPublishAssignmentResult = { ok: false; error: string };

// Atomic create+publish+assign, mirrors createAndPublishVocabularySet.
// create_and_publish_assignment() inserts the assignment already published
// and delegates to assign_assignment_to_targets() in the same transaction.
// Attachments are added afterward via the file-uploader, not at creation.
export async function createAndPublishAssignment(
  _prevState: CreateAndPublishAssignmentResult,
  formData: FormData
): Promise<CreateAndPublishAssignmentResult> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueAt = parseDueAtField(formData.get("due_at"));
  const classIds = parseIdsField(formData.get("classIds"));
  const studentIds = parseIdsField(formData.get("studentIds"));

  if (!title) {
    return { ok: false, error: "请填写作业标题" };
  }
  if (classIds.length === 0 && studentIds.length === 0) {
    return { ok: false, error: "请至少选择一个班级或一位学生" };
  }

  const supabase = await createClient();
  const { data: assignmentId, error } = await supabase.rpc("create_and_publish_assignment", {
    p_title: title,
    p_description: description,
    p_due_at: dueAt as unknown as string,
    p_class_ids: classIds,
    p_student_ids: studentIds,
  });

  if (error || !assignmentId) {
    return { ok: false, error: "创建失败，请稍后重试" };
  }

  revalidatePath("/teacher/assignments");
  redirect(`/teacher/assignments/${assignmentId}`);
}

export type UpdateAssignmentResult = { ok: false; error: string };

export async function updateAssignmentDetails(
  _prevState: UpdateAssignmentResult,
  formData: FormData
): Promise<UpdateAssignmentResult> {
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueAt = parseDueAtField(formData.get("due_at"));

  if (!title) {
    return { ok: false, error: "作业标题不能为空" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("assignments")
    .update({ title, description: description || null, due_at: dueAt }, { count: "exact" })
    .eq("id", assignmentId);

  if (error || !count) {
    return { ok: false, error: "保存失败，请稍后重试" };
  }

  revalidatePath(`/teacher/assignments/${assignmentId}`);
  redirect(`/teacher/assignments/${assignmentId}`);
}

export type ArchiveAssignmentResult = { ok: true } | { ok: false; error: string };

export async function archiveAssignment(assignmentId: string): Promise<ArchiveAssignmentResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("assignments")
    .update({ archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", assignmentId)
    .is("archived_at", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/assignments/${assignmentId}`);
  revalidatePath("/teacher/assignments");
  return { ok: true };
}

export type PublishAssignmentResult = { ok: true } | { ok: false; error: string };

// published_at has no UPDATE grant to authenticated at all -- always goes
// through publish_assignment().
export async function publishAssignment(assignmentId: string): Promise<PublishAssignmentResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_assignment", { p_assignment_id: assignmentId });

  if (error) {
    return { ok: false, error: "发布失败，请稍后重试" };
  }

  revalidatePath(`/teacher/assignments/${assignmentId}`);
  revalidatePath("/teacher/assignments");
  return { ok: true };
}

export type AssignAssignmentResult = { ok: true } | { ok: false; error: string };

// assignment_targets has no INSERT grant to authenticated at all -- always
// goes through assign_assignment_to_targets(), which enforces "assignment
// must be published and not archived" and per-class/per-student ownership
// at the database layer.
export async function assignAssignmentToTargets(
  assignmentId: string,
  classIds: string[],
  studentIds: string[]
): Promise<AssignAssignmentResult> {
  if (classIds.length === 0 && studentIds.length === 0) {
    return { ok: false, error: "请至少选择一个班级或一位学生" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_assignment_to_targets", {
    p_assignment_id: assignmentId,
    p_class_ids: classIds,
    p_student_ids: studentIds,
  });

  if (error) {
    return { ok: false, error: "指定失败，请确认作业已发布" };
  }

  revalidatePath(`/teacher/assignments/${assignmentId}`);
  return { ok: true };
}

export type UnassignResult = { ok: true } | { ok: false; error: string };

export async function unassignAssignmentTarget(assignmentId: string, targetId: string): Promise<UnassignResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("assignment_targets")
    .update({ revoked_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", targetId)
    .eq("assignment_id", assignmentId)
    .is("revoked_at", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/assignments/${assignmentId}`);
  return { ok: true };
}
