"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

export type VocabularyWordInput = {
  term: string;
  meaning: string;
  imageUrl: string;
  altAnswers: string[];
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
        altAnswers: Array.isArray(w?.altAnswers)
          ? w.altAnswers
              .map((a: unknown) => String(a ?? "").trim())
              .filter((a: string) => a.length > 0)
              .slice(0, 10)
          : [],
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

// Per-word override fields are tri-state (继承/是/否 -- inherit/yes/no), not
// boolean checkboxes: an empty selection must become SQL NULL ("inherit
// the set default"), not false ("explicitly off"). Rendered as a <select>
// with values "" | "true" | "false".
function parseTriState(raw: FormDataEntryValue | null): boolean | null {
  const value = String(raw ?? "");
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
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

// Appends more words to an existing (possibly already published) set.
// Delegates to add_vocabulary_words_with_answers(), which inserts every word
// and its alt-answers in one function body -- a constraint violation or a
// failed alt-answer write rolls back the entire batch, not just one row.
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
  const { error } = await supabase.rpc("add_vocabulary_words_with_answers", {
    p_set_id: setId,
    p_words: words,
  });

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
  // Present only on a v2 set's word-row form -- word-row.tsx only renders
  // the six override <select> controls for practice_engine_version = 2 sets
  // (meaningless, and a silent-no-op risk, on a v1 set -- see edit-set-form
  // .tsx). formData.has() distinguishes "field absent" (v1 row: leave
  // overrides untouched) from "field present but empty" (v2 row: write
  // null, i.e. explicit inherit).
  const hasOverrides = formData.has("overrideInputMode");

  if (!term || !meaning) {
    return { ok: false, error: "单词和释义不能为空" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("vocabulary_words")
    .update(
      {
        term,
        meaning,
        image_url: imageUrl || null,
        ...(hasOverrides
          ? {
              override_show_english: parseTriState(formData.get("overrideShowEnglish")),
              override_show_chinese: parseTriState(formData.get("overrideShowChinese")),
              override_play_audio: parseTriState(formData.get("overridePlayAudio")),
              override_show_image: parseTriState(formData.get("overrideShowImage")),
              override_autoplay_audio: parseTriState(formData.get("overrideAutoplayAudio")),
              override_input_mode: String(formData.get("overrideInputMode") ?? "") || null,
            }
          : {}),
      },
      { count: "exact" }
    )
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

// ============================================================================
// v2 -- retry-until-correct engine. Every set created through this form is
// version 2; a pre-existing v1 set only ever becomes v2 through the
// explicit upgradeVocabularySetToV2() opt-in below, never silently.
// ============================================================================

export type CreateAndPublishVocabularySetV2Result = { ok: false; error: string };

export async function createAndPublishVocabularySetV2(
  _prevState: CreateAndPublishVocabularySetV2Result,
  formData: FormData
): Promise<CreateAndPublishVocabularySetV2Result> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const displayShowEnglish = formData.get("displayShowEnglish") === "on";
  const displayShowChinese = formData.get("displayShowChinese") === "on";
  const showImage = formData.get("showImage") === "on";
  const displayPlayAudio = formData.get("displayPlayAudio") === "on";
  const displayAutoplayAudio = formData.get("displayAutoplayAudio") === "on";
  const inputMode = String(formData.get("inputMode") ?? "type_english");
  const wordOrder = String(formData.get("wordOrder") ?? "sequential");
  const allowStudentOrderChoice = formData.get("allowStudentOrderChoice") === "on";
  const dueAt = parseDueAtField(formData.get("due_at"));
  const studentIds = parseIdsField(formData.get("studentIds"));

  if (!title) {
    return { ok: false, error: "请填写作业标题" };
  }
  if (!["type_english", "type_chinese", "audio"].includes(inputMode)) {
    return { ok: false, error: "参数错误" };
  }
  if (!["sequential", "random"].includes(wordOrder)) {
    return { ok: false, error: "参数错误" };
  }
  if (studentIds.length === 0) {
    return { ok: false, error: "请至少选择一位学生" };
  }
  if (!displayShowEnglish && !displayShowChinese && !displayPlayAudio && !showImage) {
    return { ok: false, error: "请至少启用一种展示内容（英文/中文/朗读发音/图片）" };
  }

  const supabase = await createClient();
  const { data: setId, error } = await supabase.rpc("create_and_publish_vocabulary_set_v2", {
    p_title: title,
    p_description: description,
    p_display_show_english: displayShowEnglish,
    p_display_show_chinese: displayShowChinese,
    p_show_image: showImage,
    p_display_play_audio: displayPlayAudio,
    p_display_autoplay_audio: displayAutoplayAudio,
    p_input_mode: inputMode,
    p_word_order: wordOrder,
    p_allow_student_order_choice: allowStudentOrderChoice,
    p_due_at: dueAt as unknown as string,
    p_student_ids: studentIds,
  });

  if (error || !setId) {
    return { ok: false, error: "创建失败，请稍后重试" };
  }

  revalidatePath("/teacher/assignments");
  redirect(`/teacher/vocabulary/${setId}`);
}

export type UpdateVocabularySetV2Result = { ok: false; error: string };

// Plain RLS-scoped write, mirroring updateVocabularySetDetails -- all 8
// columns (the 7 new v2 config columns plus show_image, which was already
// grantable pre-existing and remains on this same edit form) are
// column-granted for UPDATE to authenticated, no RPC needed.
export async function updateVocabularySetDetailsV2(
  _prevState: UpdateVocabularySetV2Result,
  formData: FormData
): Promise<UpdateVocabularySetV2Result> {
  const setId = String(formData.get("setId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const displayShowEnglish = formData.get("displayShowEnglish") === "on";
  const displayShowChinese = formData.get("displayShowChinese") === "on";
  const showImage = formData.get("showImage") === "on";
  const displayPlayAudio = formData.get("displayPlayAudio") === "on";
  const displayAutoplayAudio = formData.get("displayAutoplayAudio") === "on";
  const inputMode = String(formData.get("inputMode") ?? "type_english");
  const wordOrder = String(formData.get("wordOrder") ?? "sequential");
  const allowStudentOrderChoice = formData.get("allowStudentOrderChoice") === "on";
  const dueAt = parseDueAtField(formData.get("due_at"));

  if (!title) {
    return { ok: false, error: "作业标题不能为空" };
  }
  if (!["type_english", "type_chinese", "audio"].includes(inputMode)) {
    return { ok: false, error: "参数错误" };
  }
  if (!["sequential", "random"].includes(wordOrder)) {
    return { ok: false, error: "参数错误" };
  }
  if (!displayShowEnglish && !displayShowChinese && !displayPlayAudio && !showImage) {
    return { ok: false, error: "请至少启用一种展示内容（英文/中文/朗读发音/图片）" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("vocabulary_sets")
    .update(
      {
        title,
        description: description || null,
        display_show_english: displayShowEnglish,
        display_show_chinese: displayShowChinese,
        show_image: showImage,
        display_play_audio: displayPlayAudio,
        display_autoplay_audio: displayAutoplayAudio,
        input_mode: inputMode,
        word_order: wordOrder,
        allow_student_order_choice: allowStudentOrderChoice,
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

export type UpgradeVocabularySetResult = { ok: true } | { ok: false; error: string };

export async function upgradeVocabularySetToV2(setId: string): Promise<UpgradeVocabularySetResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("upgrade_vocabulary_set_to_v2", { p_set_id: setId });

  if (error) {
    return { ok: false, error: "升级失败：可能有学生正在进行该作业的练习，请稍后再试" };
  }

  revalidatePath(`/teacher/vocabulary/${setId}`);
  return { ok: true };
}

export type UpdateAltMeaningsResult = { ok: true } | { ok: false; error: string };

export async function updateVocabularyWordAltMeanings(
  wordId: string,
  setId: string,
  altMeanings: string[]
): Promise<UpdateAltMeaningsResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("replace_vocabulary_word_alt_meanings", {
    p_word_id: wordId,
    p_alt_meanings: altMeanings,
  });

  if (error) {
    return { ok: false, error: "保存失败，请稍后重试" };
  }

  revalidatePath(`/teacher/vocabulary/${setId}`);
  return { ok: true };
}

export type UpdateAltTermsResult = { ok: true } | { ok: false; error: string };

export async function updateVocabularyWordAltTerms(
  wordId: string,
  setId: string,
  altTerms: string[]
): Promise<UpdateAltTermsResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("replace_vocabulary_word_alt_terms", {
    p_word_id: wordId,
    p_alt_terms: altTerms,
  });

  if (error) {
    return { ok: false, error: "保存失败，请稍后重试" };
  }

  revalidatePath(`/teacher/vocabulary/${setId}`);
  return { ok: true };
}
