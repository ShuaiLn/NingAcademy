"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { USERNAME_REGEX, internalEmailFor } from "@/utils/supabase/internal-email";

export type SetupTeacherResult = { ok: false; error: string };

// One-time teacher bootstrap. Gated by SETUP_TOKEN (checked server-side
// only, never in the URL). Creation order: auth.admin.createUser first,
// then finalize_teacher_bootstrap (lock + recheck + insert, single DB
// transaction). If the RPC fails — including the case where a concurrent
// request already filled all 3 allowed teacher slots — the just-created
// Auth user is deleted so no orphan is left behind.
export async function setupTeacher(
  _prevState: SetupTeacherResult,
  formData: FormData
): Promise<SetupTeacherResult> {
  const setupToken = String(formData.get("setupToken") ?? "");
  const username = String(formData.get("username") ?? "").trim();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!process.env.SETUP_TOKEN || setupToken !== process.env.SETUP_TOKEN) {
    return { ok: false, error: "部署密钥不正确" };
  }

  if (!USERNAME_REGEX.test(username)) {
    return { ok: false, error: "用户名需为 3-30 位字母、数字、下划线或横线" };
  }

  if (!fullName) {
    return { ok: false, error: "请填写姓名" };
  }

  if (password.length < 8) {
    return { ok: false, error: "密码至少需要 8 位" };
  }

  const admin = createAdminClient();
  const requestId = randomUUID();
  const internalEmail = internalEmailFor(username);

  await admin.from("audit_log").insert({
    actor_user_id: null,
    actor_type: "system",
    action: "teacher_bootstrap",
    target_table: "teachers",
    request_id: requestId,
    outcome: "started",
    detail: { username },
  });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: internalEmail,
    password,
    email_confirm: true,
  });

  if (createError || !created?.user) {
    await admin.from("audit_log").insert({
      actor_user_id: null,
      actor_type: "system",
      action: "teacher_bootstrap",
      target_table: "teachers",
      request_id: requestId,
      outcome: "failed",
      error_code: "auth_create_user_failed",
      detail: { username, error: createError?.message ?? "unknown error" },
    });
    return { ok: false, error: "创建账号失败，请稍后重试" };
  }

  const userId = created.user.id;

  const { data: rpcOk, error: rpcError } = await admin.rpc("finalize_teacher_bootstrap", {
    p_user_id: userId,
    p_username: username,
    p_full_name: fullName,
    p_request_id: requestId,
  });

  if (rpcError || !rpcOk) {
    // Roll back the orphaned Auth user. finalize_teacher_bootstrap commits
    // its own 'failed' audit_log row (returning false) for the expected
    // "already exists" race; a thrown rpcError means something unexpected
    // happened instead.
    await admin.auth.admin.deleteUser(userId);
    return {
      ok: false,
      error: rpcError ? "创建失败，请稍后重试" : "教师账号数量已达上限（3个），无法继续创建",
    };
  }

  redirect("/login");
}
