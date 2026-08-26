"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
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

type RpcResult = { data: unknown; error: { code?: string } | null };
type NarrowRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

function rpcClient(value: unknown): NarrowRpcClient {
  return value as NarrowRpcClient;
}

function parseIdsField(raw: FormDataEntryValue | null): string[] | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.map((value) => String(value ?? ""));
    if (ids.some((id) => !UUID_PATTERN.test(id))) return null;
    return [...new Set(ids)];
  } catch {
    return null;
  }
}

function parseDueAt(raw: FormDataEntryValue | null): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const GAME_QUESTION_TYPES = ["en_to_zh", "zh_to_en", "listening_spelling"] as const;

function parseQuestionTypes(raw: FormDataEntryValue | null): string[] | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 3) return null;
    const values = parsed.map(String);
    if (values.some((value) => !GAME_QUESTION_TYPES.includes(
      value as (typeof GAME_QUESTION_TYPES)[number]
    ))) return null;
    return [...new Set(values)].length === values.length ? values : null;
  } catch {
    return null;
  }
}

async function getAuthenticatedTeacher() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: teacher } = await supabase
    .from("teachers")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  return teacher ? { supabase, userId: user.id } : null;
}

export type CreateGameAssignmentResult = { ok: false; error: string };

export async function createAndPublishGameAssignment(
  _previousState: CreateGameAssignmentResult,
  formData: FormData
): Promise<CreateGameAssignmentResult> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueAt = parseDueAt(formData.get("due_at"));
  const classIds = parseIdsField(formData.get("classIds"));
  const studentIds = parseIdsField(formData.get("studentIds"));
  const vocabularySourceIds = parseIdsField(formData.get("vocabularySourceIds"));
  const requirementAssignableIds = parseIdsField(
    formData.get("requirementAssignableIds")
  );
  const questionTypes = parseQuestionTypes(formData.get("questionTypes"));

  if (!title || title.length > 200) {
    return { ok: false, error: "请填写不超过 200 字的游戏作业标题" };
  }
  if (
    !classIds ||
    !studentIds ||
    !vocabularySourceIds ||
    !requirementAssignableIds ||
    !questionTypes
  ) {
    return { ok: false, error: "提交参数无效，请刷新页面后重试" };
  }
  if (classIds.length === 0 && studentIds.length === 0) {
    return { ok: false, error: "请至少选择一个班级或一位学生" };
  }
  if (vocabularySourceIds.length === 0) {
    return { ok: false, error: "请至少选择一个游戏题目词库" };
  }

  const authenticated = await getAuthenticatedTeacher();
  if (!authenticated) {
    return { ok: false, error: "请使用教师账号重新登录" };
  }

  const retentionUntil = new Date(
    Date.now() + 180 * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data, error } = await rpcClient(authenticated.supabase).rpc(
    "create_and_publish_game_assignment_v3",
    {
      p_title: title,
      p_description: description,
      p_due_at: dueAt,
      p_class_ids: classIds,
      p_student_ids: studentIds,
      p_vocabulary_set_ids: vocabularySourceIds,
      p_allowed_modes: ["pve", "coop"],
      p_map_key: "house",
      p_learning_difficulty: "standard",
      p_minimum_day: 3,
      p_minimum_learning_questions: 5,
      p_minimum_accuracy: 60,
      p_screen_shake_max: 50,
      p_hit_stop_allowed: true,
      p_flash_intensity: "reduced",
      p_shard_intensity: "reduced",
      p_screamer_distortion_allowed: false,
      p_slow_motion_allowed: true,
      p_camera_bob_allowed: false,
      p_motion_blur_allowed: false,
      p_timing_multiplier: 1,
      p_ruleset_version: "p0",
      p_content_release_id: "p0",
      p_retention_until: retentionUntil,
      p_requirement_assignable_ids: requirementAssignableIds,
      p_question_types: questionTypes,
      p_request_id: randomUUID(),
    }
  );

  if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) {
    console.error("create game assignment RPC failed", { code: error?.code });
    return { ok: false, error: "创建游戏作业失败，请稍后重试" };
  }

  revalidatePath("/teacher/assignments");
  redirect(`/teacher/assignments/${data}`);
}

export type UpdateGameUnlockRequirementsResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type SetGameListeningAccommodationResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function updateGameUnlockRequirements(
  assignmentId: string,
  _previousState: UpdateGameUnlockRequirementsResult,
  formData: FormData
): Promise<UpdateGameUnlockRequirementsResult> {
  if (!UUID_PATTERN.test(assignmentId)) {
    return { ok: false, error: "游戏作业参数无效" };
  }
  const requirementIds = parseIdsField(formData.get("requirementAssignableIds"));
  if (!requirementIds) {
    return { ok: false, error: "解锁要求参数无效，请刷新后重试" };
  }

  const authenticated = await getAuthenticatedTeacher();
  if (!authenticated) {
    return { ok: false, error: "请使用教师账号重新登录" };
  }

  const { data, error } = await rpcClient(authenticated.supabase).rpc(
    "set_game_unlock_requirements_v1",
    {
      p_game_assignment_id: assignmentId,
      p_assignable_ids: requirementIds,
      p_request_id: randomUUID(),
    }
  );
  if (error || typeof data !== "string" || !UUID_PATTERN.test(data)) {
    console.error("set game unlock requirements RPC failed", {
      code: error?.code,
    });
    return { ok: false, error: "保存解锁要求失败，请稍后重试" };
  }

  revalidatePath(`/teacher/assignments/${assignmentId}`);
  return { ok: true, message: "解锁要求已保存并创建新版本" };
}

export async function setGameListeningAccommodation(
  assignmentId: string,
  _previousState: SetGameListeningAccommodationResult,
  formData: FormData
): Promise<SetGameListeningAccommodationResult> {
  const studentId = String(formData.get("studentId") ?? "");
  const listeningMode = String(formData.get("listeningMode") ?? "");
  const worldAudioEffectsEnabled =
    formData.get("worldAudioEffectsEnabled") === "on";
  if (
    !UUID_PATTERN.test(assignmentId) ||
    !UUID_PATTERN.test(studentId) ||
    !["audio", "text_alternative"].includes(listeningMode)
  ) {
    return { ok: false, error: "听力辅助设置参数无效" };
  }

  const authenticated = await getAuthenticatedTeacher();
  if (!authenticated) {
    return { ok: false, error: "请使用教师账号重新登录" };
  }

  const [configResult, accommodationResult] = await Promise.all([
    authenticated.supabase
      .from("game_assignment_configs")
      .select(
        "flash_intensity, screen_shake_max, screamer_distortion_allowed"
      )
      .eq("assignment_id", assignmentId)
      .maybeSingle(),
    authenticated.supabase
      .from("game_assignment_accommodations")
      .select(
        "timing_mode, timing_multiplier, flash_intensity, screen_shake_max, screamer_distortion_allowed"
      )
      .eq("assignment_id", assignmentId)
      .eq("student_id", studentId)
      .maybeSingle(),
  ]);
  if (configResult.error || accommodationResult.error || !configResult.data) {
    return { ok: false, error: "无法读取当前游戏辅助设置，请稍后重试" };
  }

  const existing = accommodationResult.data;
  const config = configResult.data;
  const { error } = await authenticated.supabase.rpc(
    "set_game_assignment_accommodation_v2",
    {
      p_assignment_id: assignmentId,
      p_student_id: studentId,
      p_timing_mode: existing?.timing_mode ?? "standard",
      p_timing_multiplier: existing?.timing_multiplier ?? 1,
      p_flash_intensity: existing?.flash_intensity ?? config.flash_intensity,
      p_screen_shake_max:
        existing?.screen_shake_max ?? config.screen_shake_max,
      p_screamer_distortion_allowed:
        existing?.screamer_distortion_allowed ??
        config.screamer_distortion_allowed,
      p_listening_mode: listeningMode,
      p_world_audio_effects_enabled: worldAudioEffectsEnabled,
      p_request_id: randomUUID(),
    }
  );
  if (error) {
    console.error("set listening accommodation RPC failed", {
      code: error.code,
    });
    return {
      ok: false,
      error:
        listeningMode === "text_alternative"
          ? "无法启用文字替代；请确认所有听力词条都已有经审核的安全文字提示"
          : "保存听力辅助设置失败，请稍后重试",
    };
  }

  revalidatePath(`/teacher/assignments/${assignmentId}`);
  return { ok: true, message: "听力辅助设置已保存；新游戏尝试将冻结此设置" };
}

export async function launchGameAssignment(
  assignmentId: string,
  _previousState: LaunchGameResult,
  _formData: FormData
): Promise<LaunchGameResult> {
  void _previousState;
  void _formData;
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
    return {
      ok: false,
      error:
        result.reason === "locked"
          ? "请先完成全部解锁要求，再进入游戏"
          : "暂时无法启动游戏，请稍后重试",
    };
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
