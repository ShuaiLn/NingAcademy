"use server";

import { randomBytes, randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { USERNAME_REGEX, internalEmailFor } from "@/utils/supabase/internal-email";

// Unambiguous alphabet (no 0/O, 1/l/I) since this is read off a screen and
// retyped once by the student.
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function generateTempPassword(length = 10): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length];
  }
  return out;
}

export type CreateStudentResult =
  | { ok: true; username: string; tempPassword: string }
  | { ok: false; error: string };

// Mirrors setupTeacher's create-then-finalize-then-compensate shape, scoped
// to the calling teacher's own teacher_id (never accepted from the client).
export async function createStudent(
  _prevState: CreateStudentResult,
  formData: FormData
): Promise<CreateStudentResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "请先登录" };
  }

  const { data: teacherRow } = await supabase
    .from("teachers")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (!teacherRow) {
    return { ok: false, error: "无权限执行该操作" };
  }

  const username = String(formData.get("username") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();

  if (!USERNAME_REGEX.test(username)) {
    return { ok: false, error: "用户名需为 3-30 位字母、数字、下划线或横线" };
  }
  if (!fullName) {
    return { ok: false, error: "请填写学生姓名" };
  }

  const admin = createAdminClient();
  const requestId = randomUUID();
  const tempPassword = generateTempPassword();

  await admin.from("audit_log").insert({
    actor_user_id: user.id,
    actor_type: "teacher",
    action: "student_create",
    target_table: "students",
    request_id: requestId,
    outcome: "started",
    detail: { username },
  });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: internalEmailFor(username),
    password: tempPassword,
    email_confirm: true,
  });

  if (createError || !created?.user) {
    await admin.from("audit_log").insert({
      actor_user_id: user.id,
      actor_type: "teacher",
      action: "student_create",
      target_table: "students",
      request_id: requestId,
      outcome: "failed",
      error_code: "auth_create_user_failed",
      detail: { username, error: createError?.message ?? "unknown error" },
    });
    return { ok: false, error: "创建失败，用户名可能已被占用" };
  }

  const { data: rpcOk, error: rpcError } = await admin.rpc("finalize_student_creation", {
    p_user_id: created.user.id,
    p_username: username,
    p_full_name: fullName,
    p_teacher_id: teacherRow.id,
    p_request_id: requestId,
  });

  if (rpcError || !rpcOk) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "创建失败，用户名可能已被占用" };
  }

  revalidatePath("/teacher/students");
  return { ok: true, username, tempPassword };
}

export type ResetPasswordResult =
  | { ok: true; tempPassword: string }
  | { ok: false; error: string };

export async function resetStudentPassword(
  _prevState: ResetPasswordResult,
  formData: FormData
): Promise<ResetPasswordResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "请先登录" };
  }

  const studentId = String(formData.get("studentId") ?? "");
  if (!studentId) {
    return { ok: false, error: "参数错误" };
  }

  // RLS already scopes visibility to "self or own teacher"; filtering on
  // teacher_id = caller here additionally rules out a student targeting
  // their own account through this teacher-only action.
  const { data: owned } = await supabase
    .from("students")
    .select("id")
    .eq("id", studentId)
    .eq("teacher_id", user.id)
    .maybeSingle();
  if (!owned) {
    return { ok: false, error: "无权限操作该学生" };
  }

  const admin = createAdminClient();
  const requestId = randomUUID();
  const tempPassword = generateTempPassword();

  const { error: authError } = await admin.auth.admin.updateUserById(studentId, {
    password: tempPassword,
  });
  if (authError) {
    return { ok: false, error: "重设密码失败，请稍后重试" };
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", studentId);

  await admin.from("audit_log").insert({
    actor_user_id: user.id,
    actor_type: "teacher",
    action: "password_reset",
    target_table: "students",
    target_id: studentId,
    request_id: requestId,
    outcome: profileError ? "failed" : "succeeded",
    error_code: profileError ? "profile_update_failed" : null,
    detail: {},
  });

  if (profileError) {
    return { ok: false, error: "重设密码失败，请稍后重试" };
  }

  revalidatePath(`/teacher/students/${studentId}`);
  return { ok: true, tempPassword };
}

export type SetActiveResult = { ok: true } | { ok: false; error: string };

export async function setStudentActive(studentId: string, active: boolean): Promise<SetActiveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "请先登录" };
  }

  const { data: owned } = await supabase
    .from("students")
    .select("id")
    .eq("id", studentId)
    .eq("teacher_id", user.id)
    .maybeSingle();
  if (!owned) {
    return { ok: false, error: "无权限操作该学生" };
  }

  const admin = createAdminClient();
  const requestId = randomUUID();

  // Ban at the Auth layer too, so a still-valid JWT can't keep working past
  // the is_active flag flip until it happens to expire.
  const { error: authError } = await admin.auth.admin.updateUserById(studentId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (authError) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ is_active: active })
    .eq("id", studentId);

  await admin.from("audit_log").insert({
    actor_user_id: user.id,
    actor_type: "teacher",
    action: active ? "enable_account" : "disable_account",
    target_table: "students",
    target_id: studentId,
    request_id: requestId,
    outcome: profileError ? "failed" : "succeeded",
    error_code: profileError ? "profile_update_failed" : null,
    detail: {},
  });

  if (profileError) {
    return { ok: false, error: "操作失败，请稍后重试" };
  }

  revalidatePath("/teacher/students");
  revalidatePath(`/teacher/students/${studentId}`);
  return { ok: true };
}

export type UpdateNameResult = { ok: false; error: string };

// No admin.ts here: full_name is column-granted for UPDATE to authenticated
// and scoped by the profiles_update_own_students_full_name RLS policy, so a
// plain RLS-bound write is enough.
export async function updateStudentName(
  _prevState: UpdateNameResult,
  formData: FormData
): Promise<UpdateNameResult> {
  const supabase = await createClient();
  const studentId = String(formData.get("studentId") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();

  if (!fullName) {
    return { ok: false, error: "姓名不能为空" };
  }

  const { error, count } = await supabase
    .from("profiles")
    .update({ full_name: fullName }, { count: "exact" })
    .eq("id", studentId);

  if (error || !count) {
    return { ok: false, error: "修改失败，请稍后重试" };
  }

  revalidatePath(`/teacher/students/${studentId}`);
  revalidatePath("/teacher/students");
  redirect(`/teacher/students/${studentId}`);
}
