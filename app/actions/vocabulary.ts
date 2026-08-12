"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type VocabularyWordInput = {
  term: string;
  meaning: string;
  imageUrl: string;
};

// The create/add-words forms serialize their dynamic row list into one
// hidden `words` field as JSON, since FormData has no native array shape
// for a variable-length list of objects.
function parseWordsField(raw: FormDataEntryValue | null): VocabularyWordInput[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((w) => ({
        term: String(w?.term ?? "").trim(),
        meaning: String(w?.meaning ?? "").trim(),
        imageUrl: String(w?.imageUrl ?? "").trim(),
      }))
      .filter((w) => w.term && w.meaning);
  } catch {
    return null;
  }
}

// Mirrors parseWordsField -- the target-picker checkbox lists serialize
// their selection into one hidden JSON field (studentIds/classIds) rather
// than repeated same-name checkbox inputs, so ordering/dedup stay explicit.
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
// clear); create_and_publish_vocabulary_set's p_due_at is a timestamptz
// parameter, so unlike a text p_description an empty string is not valid
// input -- it must become SQL NULL, not nullif()'d inside the function.
// The generated RPC Args type still says `p_due_at: string` (no `| null`)
// because the Postgres parameter has no DEFAULT, so this needs a narrow
// cast at the call site -- same class of generator quirk already noted on
// begin_upload's p_task_word_id.
function parseDueAtField(raw: FormDataEntryValue | null): string | null {
  const value = String(raw ?? "").trim();
  return value || null;
}

export type CreateAndPublishVocabularySetResult = { ok: false; error: string };

// Atomic create+publish+assign: create_and_publish_vocabulary_set() inserts
// the set already published and delegates to
// assign_vocabulary_set_to_students() in the same transaction, so a failure
// partway through (e.g. a student not owned by this teacher) leaves nothing
// behind. Content (words) is added afterward via addVocabularyWords() --
// see the migration header for why publishing an empty set is now legal.
export async function createAndPublishVocabularySet(
  _prevState: CreateAndPublishVocabularySetResult,
  formData: FormData
): Promise<CreateAndPublishVocabularySetResult> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const promptField = String(formData.get("promptField") ?? "meaning");
  const showImage = formData.get("showImage") === "on";
  const audioOnly = formData.get("audioOnly") === "on";
  const dueAt = parseDueAtField(formData.get("due_at"));
  const studentIds = parseIdsField(formData.get("studentIds"));

  if (!title) {
    return { ok: false, error: "请填写作业标题" };
  }
  if (promptField !== "meaning" && promptField !== "term") {
    return { ok: false, error: "参数错误" };
  }
  if (studentIds.length === 0) {
    return { ok: false, error: "请至少选择一位学生" };
  }

  const supabase = await createClient();
  const { data: setId, error } = await supabase.rpc("create_and_publish_vocabulary_set", {
    p_title: title,
    p_description: description,
    p_prompt_field: promptField,
    p_show_image: showImage,
    p_audio_only: audioOnly,
    p_due_at: dueAt as unknown as string,
    p_student_ids: studentIds,
  });

  if (error || !setId) {
    return { ok: false, error: "创建失败，请稍后重试" };
  }

  revalidatePath("/teacher/assignments");
  redirect(`/teacher/vocabulary/${setId}`);
}

export type UpdateVocabularySetResult = { ok: false; error: string };

// Plain RLS-scoped write: title/description/prompt_field/show_image/
// audio_only/due_at are all column-granted for UPDATE to authenticated, no
// RPC needed (mirrors updateStudentName). Safe to edit post-publish --
// start_practice_session() freezes everything into practice_session_words
// per-session, so a later edit here never mutates an in-flight quiz.
export async function updateVocabularySetDetails(
  _prevState: UpdateVocabularySetResult,
  formData: FormData
): Promise<UpdateVocabularySetResult> {
  const setId = String(formData.get("setId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const promptField = String(formData.get("promptField") ?? "meaning");
  const showImage = formData.get("showImage") === "on";
  const audioOnly = formData.get("audioOnly") === "on";
  const dueAt = parseDueAtField(formData.get("due_at"));

  if (!title) {
    return { ok: false, error: "作业标题不能为空" };
  }
  if (promptField !== "meaning" && promptField !== "term") {
    return { ok: false, error: "参数错误" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("vocabulary_sets")
    .update(
      {
        title,
        description: description || null,
        prompt_field: promptField,
        show_image: showImage,
        audio_only: audioOnly,
        due_at: dueAt,
      },
      { count: "exact" }
    )
    .eq("id", setId);

  if (error || !count) {
    return { ok: false, error: "保存失败，请稍后重试" };
  }

  revalidatePath(`/teacher/vocabulary/${setId}`);
  redirect(`/teacher/vocabulary/${setId}`);
}

export type AddVocabularyWordsResult = { ok: false; error: string };

// Appends more words to an existing (possibly already published) set. A
// plain INSERT is safe here -- format/length validation is enforced by
// vocabulary_words' own CHECK constraints regardless of the write path.
export async function addVocabularyWords(
  _prevState: AddVocabularyWordsResult,
  formData: FormData
): Promise<AddVocabularyWordsResult> {
  const setId = String(formData.get("setId") ?? "");
  const words = parseWordsField(formData.get("words"));

  if (!setId) {
    return { ok: false, error: "参数错误" };
  }
  if (!words || words.length === 0) {
    return { ok: false, error: "请至少添加一个单词（单词和释义不能为空）" };
  }

  const supabase = await createClient();
  const { count: existingCount } = await supabase
    .from("vocabulary_words")
    .select("id", { count: "exact", head: true })
    .eq("set_id", setId);

  const { error } = await supabase.from("vocabulary_words").insert(
    words.map((w, i) => ({
      set_id: setId,
      term: w.term,
      meaning: w.meaning,
      image_url: w.imageUrl || null,
      sort_order: (existingCount ?? 0) + i,
    }))
  );

  if (error) {
    return { ok: false, error: "添加失败，请稍后重试" };
  }

  revalidatePath(`/teacher/vocabulary/${setId}`);
  redirect(`/teacher/vocabulary/${setId}`);
}

export type UpdateVocabularyWordResult = { ok: false; error: string };

export async function updateVocabularyWord(
  _prevState: UpdateVocabularyWordResult,
  formData: FormData
): Promise<UpdateVocabularyWordResult> {
  const wordId = String(formData.get("wordId") ?? "");
  const setId = String(formData.get("setId") ?? "");
  const term = String(formData.get("term") ?? "").trim();
  const meaning = String(formData.get("meaning") ?? "").trim();
  const imageUrl = String(formData.get("imageUrl") ?? "").trim();

  if (!term || !meaning) {
    return { ok: false, error: "单词和释义不能为空" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("vocabulary_words")
    .update({ term, meaning, image_url: imageUrl || null }, { count: "exact" })
    .eq("id", wordId);

  if (error || !count) {
    return { ok: false, error: "保存失败，请稍后重试" };
  }

  revalidatePath(`/teacher/vocabulary/${setId}`);
  redirect(`/teacher/vocabulary/${setId}`);
}

export type ArchiveWordResult = { ok: true } | { ok: false; error: string };

export async function archiveVocabularyWord(wordId: string, setId: string): Promise<ArchiveWordResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("vocabulary_words")
    .update({ archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", wordId)
    .is("archived_at", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/vocabulary/${setId}`);
  return { ok: true };
}

export type DeleteWordResult = { ok: true } | { ok: false; error: string };

// Hard delete -- distinct from archiveVocabularyWord above. Only legal when
// the word was never snapshotted into a practice session: both
// vocabulary_attempts.word_id and practice_session_words.word_id reference
// vocabulary_words(id) on delete restrict, so a used word's delete fails at
// the database layer with 23503 regardless of what this function does.
// There is no readable-by-teacher table to precompute "would this succeed"
// (practice_session_words has zero grants to any client role), so the
// button is always shown enabled and this three-outcome check happens at
// the point of the delete attempt itself.
export async function deleteVocabularyWord(wordId: string, setId: string): Promise<DeleteWordResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("vocabulary_words")
    .delete({ count: "exact" })
    .eq("id", wordId);

  if (error?.code === "23503") {
    return { ok: false, error: "该单词已被学生练习过，无法删除，请改用归档" };
  }
  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/vocabulary/${setId}`);
  return { ok: true };
}

export type PublishResult = { ok: true } | { ok: false; error: string };

// published_at has no UPDATE grant to authenticated at all -- this always
// goes through publish_vocabulary_set(), which also enforces "not archived"
// at the database layer. Unreachable in normal use now that creation always
// publishes atomically; kept as a harmless fallback for any legacy draft.
export async function publishVocabularySet(setId: string): Promise<PublishResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_vocabulary_set", { p_set_id: setId });

  if (error) {
    return { ok: false, error: "发布失败，请稍后重试" };
  }

  revalidatePath(`/teacher/vocabulary/${setId}`);
  revalidatePath("/teacher/vocabulary");
  return { ok: true };
}

export type ArchiveSetResult = { ok: true } | { ok: false; error: string };

export async function archiveVocabularySet(setId: string): Promise<ArchiveSetResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("vocabulary_sets")
    .update({ archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", setId)
    .is("archived_at", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/vocabulary/${setId}`);
  revalidatePath("/teacher/vocabulary");
  return { ok: true };
}

export type AssignResult = { ok: true } | { ok: false; error: string };

// vocabulary_targets has no INSERT grant to authenticated at all -- this
// always goes through assign_vocabulary_set_to_students(), which enforces
// "set must be published and not archived" and per-student ownership at
// the database layer.
export async function assignStudentsToSet(setId: string, studentIds: string[]): Promise<AssignResult> {
  if (studentIds.length === 0) {
    return { ok: false, error: "请至少选择一位学生" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_vocabulary_set_to_students", {
    p_set_id: setId,
    p_student_ids: studentIds,
  });

  if (error) {
    return { ok: false, error: "指定失败，请确认作业已发布" };
  }

  revalidatePath(`/teacher/vocabulary/${setId}`);
  return { ok: true };
}

export type UnassignResult = { ok: true } | { ok: false; error: string };

export async function unassignStudentFromSet(setId: string, studentId: string): Promise<UnassignResult> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("vocabulary_targets")
    .update({ revoked_at: new Date().toISOString() }, { count: "exact" })
    .eq("set_id", setId)
    .eq("student_id", studentId)
    .is("revoked_at", null);

  if (error || !count) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath(`/teacher/vocabulary/${setId}`);
  return { ok: true };
}
