"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

// Mirrors parseIdsField in actions/assignments.ts.
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

// Mirrors parseDueAtField in actions/assignments.ts.
function parseDueAtField(raw: FormDataEntryValue | null): string | null {
  const value = String(raw ?? "").trim();
  return value || null;
}

export type CreatePronunciationTaskResult = { ok: false; error: string };

// Plain INSERT, same reasoning as createAssignment -- words are added
// afterward via addPronunciationTaskWords(), not atomically at creation.
export async function createPronunciationTask(
  _prevState: CreatePronunciationTaskResult,
  formData: FormData
): Promise<CreatePronunciationTaskResult> {
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
    return { ok: false, error: "请填写任务标题" };
  }

  const { data: created, error } = await supabase
    .from("pronunciation_tasks")
    .insert({ teacher_id: user.id, title, description: description || null })
    .select("id")
    .single();

  if (error || !created) {
    return { ok: false, error: "创建失败，请稍后重试" };
  }

  revalidatePath("/teacher/pronunciation");
  redirect(`/teacher/pronunciation/${created.id}`);
}

export type CreateAndPublishPronunciationTaskResult = { ok: false; error: string };

// Atomic create+publish+assign, mirrors createAndPublishAssignment.
export async function createAndPublishPronunciationTask(
  _prevState: CreateAndPublishPronunciationTaskResult,
  formData: FormData
): Promise<CreateAndPublishPronunciationTaskResult> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueAt = parseDueAtField(formData.get("due_at"));
  const classIds = parseIdsField(formData.get("classIds"));
  const studentIds = parseIdsField(formData.get("studentIds"));

  if (!title) {
    return { ok: false, error: "请填写任务标题" };
  }
  if (classIds.length === 0 && studentIds.length === 0) {
    return { ok: false, error: "请至少选择一个班级或一位学生" };
  }

  const supabase = await createClient();
  const { data: taskId, error } = await supabase.rpc("create_and_publish_pronunciation_task", {
    p_title: title,
    p_description: description,
    p_due_at: dueAt as unknown as string,
    p_class_ids: classIds,
    p_student_ids: studentIds,
  });

  if (error || !taskId) {
    return { ok: false, error: "创建失败，请稍后重试" };
  }

  revalidatePath("/teacher/assignments");
  redirect(`/teacher/pronunciation/${taskId}`);
}

export type UpdatePronunciationTaskResult = { ok: false; error: string };

export async function updatePronunciationTaskDetails(
  _prevState: UpdatePronunciationTaskResult,
  formData: FormData
): Promise<UpdatePronunciationTaskResult> {
  const taskId = String(formData.get("taskId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueAt = parseDueAtField(formData.get("due_at"));

  if (!title) {
    return { ok: false, error: "任务标题不能为空" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("pronunciation_tasks")
    .update({ title, description: description || null, due_at: dueAt }, { count: "exact" })
    .eq("id", taskId);

  if (error || !count) {
    return { ok: false, error: "保存失败，请稍后重试" };
  }

  revalidatePath(`/teacher/pronunciation/${taskId}`);
  redirect(`/teacher/pronunciation/${taskId}`);
}

export type ArchivePronunciationTaskResult = { ok: true } | { ok: false; error: string };

export async function archivePronunciationTask(taskId: string): Promise<ArchivePronunciationTaskResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("pronunciation_tasks")
    .update({ archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", taskId)
    .is("archived_at", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/pronunciation/${taskId}`);
  revalidatePath("/teacher/pronunciation");
  return { ok: true };
}

export type AddPronunciationTaskWordsResult = { ok: false; error: string };

function parsePromptsField(raw: FormDataEntryValue | null): string[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((p) => String(p ?? "").trim()).filter((p) => p.length > 0);
  } catch {
    return null;
  }
}

// Appends more reading prompts to an existing (possibly already published)
// task -- mirrors addVocabularyWords. Format/length validation is enforced
// by pronunciation_task_words' own CHECK constraints regardless.
export async function addPronunciationTaskWords(
  _prevState: AddPronunciationTaskWordsResult,
  formData: FormData
): Promise<AddPronunciationTaskWordsResult> {
  const taskId = String(formData.get("taskId") ?? "");
  const prompts = parsePromptsField(formData.get("prompts"));

  if (!taskId) {
    return { ok: false, error: "参数错误" };
  }
  if (!prompts || prompts.length === 0) {
    return { ok: false, error: "请至少添加一条跟读内容" };
  }

  const supabase = await createClient();
  const { count: existingCount } = await supabase
    .from("pronunciation_task_words")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId);

  const { error } = await supabase.from("pronunciation_task_words").insert(
    prompts.map((textPrompt, i) => ({
      task_id: taskId,
      text_prompt: textPrompt,
      sort_order: (existingCount ?? 0) + i,
    }))
  );

  if (error) {
    return { ok: false, error: "添加失败，请稍后重试" };
  }

  revalidatePath(`/teacher/pronunciation/${taskId}`);
  redirect(`/teacher/pronunciation/${taskId}`);
}

export type UpdatePronunciationTaskWordResult = { ok: false; error: string };

export async function updatePronunciationTaskWord(
  _prevState: UpdatePronunciationTaskWordResult,
  formData: FormData
): Promise<UpdatePronunciationTaskWordResult> {
  const wordId = String(formData.get("wordId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");
  const textPrompt = String(formData.get("textPrompt") ?? "").trim();

  if (!textPrompt) {
    return { ok: false, error: "跟读内容不能为空" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("pronunciation_task_words")
    .update({ text_prompt: textPrompt }, { count: "exact" })
    .eq("id", wordId);

  if (error || !count) {
    return { ok: false, error: "保存失败，请稍后重试" };
  }

  revalidatePath(`/teacher/pronunciation/${taskId}`);
  redirect(`/teacher/pronunciation/${taskId}`);
}

export type ArchivePronunciationTaskWordResult = { ok: true } | { ok: false; error: string };

export async function archivePronunciationTaskWord(
  wordId: string,
  taskId: string
): Promise<ArchivePronunciationTaskWordResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("pronunciation_task_words")
    .update({ archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", wordId)
    .is("archived_at", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/pronunciation/${taskId}`);
  return { ok: true };
}

export type DeletePronunciationTaskWordResult = { ok: true } | { ok: false; error: string };

// Hard delete, mirrors deleteVocabularyWord -- see its comment. Both
// upload_intents.task_word_id and audio_submission_files.task_word_id
// reference pronunciation_task_words(id) on delete restrict, so a used
// prompt's delete fails at the database layer with 23503.
export async function deletePronunciationTaskWord(
  wordId: string,
  taskId: string
): Promise<DeletePronunciationTaskWordResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("pronunciation_task_words")
    .delete({ count: "exact" })
    .eq("id", wordId);

  if (error?.code === "23503") {
    return { ok: false, error: "该内容已被学生录音过，无法删除，请改用归档" };
  }
  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/pronunciation/${taskId}`);
  return { ok: true };
}

export type PublishPronunciationTaskResult = { ok: true } | { ok: false; error: string };

// published_at has no UPDATE grant to authenticated at all -- always goes
// through publish_pronunciation_task(), which also enforces "at least one
// active word" at the database layer.
export async function publishPronunciationTask(taskId: string): Promise<PublishPronunciationTaskResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_pronunciation_task", { p_task_id: taskId });

  if (error) {
    return { ok: false, error: "发布失败，请确认任务至少包含一条未归档的跟读内容" };
  }

  revalidatePath(`/teacher/pronunciation/${taskId}`);
  revalidatePath("/teacher/pronunciation");
  return { ok: true };
}

export type AssignPronunciationTaskResult = { ok: true } | { ok: false; error: string };

export async function assignPronunciationTaskToTargets(
  taskId: string,
  classIds: string[],
  studentIds: string[]
): Promise<AssignPronunciationTaskResult> {
  if (classIds.length === 0 && studentIds.length === 0) {
    return { ok: false, error: "请至少选择一个班级或一位学生" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_pronunciation_task_to_targets", {
    p_task_id: taskId,
    p_class_ids: classIds,
    p_student_ids: studentIds,
  });

  if (error) {
    return { ok: false, error: "指定失败，请确认任务已发布" };
  }

  revalidatePath(`/teacher/pronunciation/${taskId}`);
  return { ok: true };
}

export type UnassignResult = { ok: true } | { ok: false; error: string };

export async function unassignPronunciationTarget(taskId: string, targetId: string): Promise<UnassignResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("pronunciation_targets")
    .update({ revoked_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", targetId)
    .eq("task_id", taskId)
    .is("revoked_at", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/pronunciation/${taskId}`);
  return { ok: true };
}
