"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  GAME_LAUNCH_COOKIE,
  GAME_LAUNCH_TRANSITION_PATH,
  getGameLaunchExchangeUrl,
  issueGameLaunchTicket,
} from "@/app/_lib/game-main-site";

export type LaunchGameResult = { ok: false; error: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function launchGameAssignment(
  assignmentId: string,
  _previousState: LaunchGameResult,
  _formData: FormData
): Promise<LaunchGameResult> {
  if (!UUID_PATTERN.test(assignmentId)) {
    return { ok: false, error: "游戏作业参数无效" };
  }
  if (!getGameLaunchExchangeUrl()) {
    return { ok: false, error: "游戏入口尚未配置，请联系老师" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "请重新登录后再进入游戏" };
  }

  const [{ data: student }, { data: assignment, error: assignmentError }] =
    await Promise.all([
      supabase.from("students").select("id").eq("id", user.id).maybeSingle(),
      supabase
        .from("assignments")
        .select("id, assignment_kind")
        .eq("id", assignmentId)
        .maybeSingle(),
    ]);

  if (
    !student ||
    assignmentError ||
    !assignment ||
    assignment.assignment_kind !== "game"
  ) {
    return { ok: false, error: "无法进入这个游戏作业" };
  }

  const result = await issueGameLaunchTicket(supabase, assignmentId);
  if (!result.ok) {
    return { ok: false, error: "暂时无法启动游戏，请稍后重试" };
  }

  const expiresAt = new Date(result.ticket.expiresAt).getTime();
  const maxAge = Math.max(
    1,
    Math.min(60, Math.floor((expiresAt - Date.now()) / 1000))
  );
  const cookieStore = await cookies();
  cookieStore.set(GAME_LAUNCH_COOKIE, result.ticket.launchTicket, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: GAME_LAUNCH_TRANSITION_PATH,
    maxAge,
    priority: "high",
  });

  // No ticket is returned to the Client Component. The URL and browser
  // history contain only this fixed internal transition path.
  redirect(GAME_LAUNCH_TRANSITION_PATH);
}
