"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { internalEmailFor } from "@/utils/supabase/internal-email";
import { revokeGameSessionsForUser } from "@/app/_lib/game-main-site";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Revoke the game credential first. If that fails, keep the main-site
  // session so the user can retry instead of falsely reporting a complete
  // logout while a game session remains active.
  if (user && !(await revokeGameSessionsForUser(user.id, "main_site_logout"))) {
    throw new Error("无法安全退出，请稍后重试");
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error("退出失败，请稍后重试");
  }
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "请重新登录后再修改密码" };
  }

  // Revoke first so an old game credential cannot survive a successful
  // password change. Revoking on a later Auth failure is safe and expected.
  if (!(await revokeGameSessionsForUser(user.id, "main_site_password_change"))) {
    return { ok: false, error: "暂时无法安全修改密码，请稍后重试" };
  }

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
