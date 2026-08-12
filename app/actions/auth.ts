"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { internalEmailFor } from "@/utils/supabase/internal-email";

export type LoginResult = { ok: false; error: string };

// Username+password only. The username is deterministically mapped to the
// internal placeholder email server-side, so there is no pre-auth DB lookup
// and no way to distinguish "unknown username" from "wrong password" in the
// error message below.
export async function login(_prevState: LoginResult, formData: FormData): Promise<LoginResult> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { ok: false, error: "请输入用户名和密码" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: internalEmailFor(username),
    password,
  });

  if (error) {
    return { ok: false, error: "用户名或密码错误" };
  }

  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type ChangePasswordResult = { ok: false; error: string };

export async function changePassword(
  _prevState: ChangePasswordResult,
  formData: FormData
): Promise<ChangePasswordResult> {
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword.length < 8) {
    return { ok: false, error: "新密码至少需要 8 位" };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: "两次输入的密码不一致" };
  }

  const supabase = await createClient();

  // Auth-side password change first; only on success do we flip
  // must_change_password via the RPC. If updateUser succeeds but the RPC
  // call fails for some reason, the user's password is already changed —
  // they just get asked to submit the (now-current) password once more,
  // which is safe.
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return { ok: false, error: "修改密码失败，请稍后重试" };
  }

  const { error: rpcError } = await supabase.rpc("complete_password_change", {
    p_request_id: randomUUID(),
  });
  if (rpcError) {
    return { ok: false, error: "密码已修改，但后续处理失败，请重新登录后重试" };
  }

  redirect("/");
}
