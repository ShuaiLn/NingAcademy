import "server-only";

import { randomBytes, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/supabase/database.types";
import { createAdminClient } from "@/utils/supabase/admin";

export const GAME_LAUNCH_COOKIE = "ningacademy_game_launch";
export const GAME_LAUNCH_TRANSITION_PATH = "/student/game/launch";
export const GAME_LAUNCH_TICKET_FIELD = "ticket";
export const GAME_LAUNCH_TICKET_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export type GameLaunchTicket = {
  launchTicket: string;
  expiresAt: string;
  assignmentId: string;
};

function createBase64UrlNonce(): string {
  // The nonce is never sent to the browser independently. The database mixes
  // it with the authenticated user, assignment and request id, then stores
  // only the resulting ticket hash.
  return randomBytes(32).toString("base64url");
}

export type GameAssignmentCompletionRow = {
  assignmentId: string;
  studentId: string;
  completed: boolean;
};

type RpcError = {
  code?: string;
  message?: string;
};

type RpcResult = {
  data: unknown;
  error: RpcError | null;
};

type NarrowGameRpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<RpcResult>;
};

function gameRpcClient(client: unknown): NarrowGameRpcClient {
  return client as NarrowGameRpcClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLaunchTicket(data: unknown): GameLaunchTicket | null {
  const row = Array.isArray(data) ? data[0] : null;
  if (!isRecord(row)) return null;

  const launchTicket = row.launch_ticket;
  const expiresAt = row.expires_at;
  const assignmentId = row.assignment_id;
  if (
    typeof launchTicket !== "string" ||
    !GAME_LAUNCH_TICKET_PATTERN.test(launchTicket) ||
    typeof expiresAt !== "string" ||
    typeof assignmentId !== "string"
  ) {
    return null;
  }

  return { launchTicket, expiresAt, assignmentId };
}

// Browser-authenticated RPC. Identity is derived from the Supabase session;
// neither the action nor the browser may choose a user id.
export async function issueGameLaunchTicket(
  supabase: SupabaseClient<Database>,
  assignmentId: string
): Promise<{ ok: true; ticket: GameLaunchTicket } | { ok: false }> {
  const { data, error } = await gameRpcClient(supabase).rpc(
    "issue_game_launch_ticket_v1",
    {
      p_assignment_id: assignmentId,
      p_request_id: randomUUID(),
      p_client_nonce: createBase64UrlNonce(),
    }
  );

  if (error) {
    console.error("game launch ticket RPC failed", { code: error.code });
    return { ok: false };
  }

  const ticket = parseLaunchTicket(data);
  if (!ticket || ticket.assignmentId !== assignmentId) {
    console.error("game launch ticket RPC returned an invalid contract");
    return { ok: false };
  }

  return { ok: true, ticket };
}

export type GameSessionRevokeReason =
  | "main_site_logout"
  | "main_site_password_change";

// Deliberately uses the server-only service client. The migration grants this
// one public RPC to service_role; it does not grant browser access to game or
// game_private tables.
export async function revokeGameSessionsForUser(
  userId: string,
  reason: GameSessionRevokeReason
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await gameRpcClient(admin).rpc(
    "revoke_game_sessions_v1",
    {
      p_user_id: userId,
      p_reason: reason,
      p_request_id: randomUUID(),
    }
  );

  if (error || typeof data !== "number" || !Number.isInteger(data) || data < 0) {
    console.error("game session revocation RPC failed", { code: error?.code });
    return false;
  }

  return true;
}

function parseCompletionRows(data: unknown): GameAssignmentCompletionRow[] | null {
  if (!Array.isArray(data)) return null;

  const rows: GameAssignmentCompletionRow[] = [];
  for (const value of data) {
    if (!isRecord(value)) return null;
    const assignmentId = value.assignment_id;
    const studentId = value.student_id;
    const completed = value.completed;
    if (
      typeof assignmentId !== "string" ||
      typeof studentId !== "string" ||
      typeof completed !== "boolean"
    ) {
      return null;
    }
    rows.push({ assignmentId, studentId, completed });
  }
  return rows;
}

// Typed, fail-closed seam for the narrow completion RPC. The Phase 0
// migration must provide this exact public contract before game assignments
// can participate in due-item calculations:
//
//   get_game_assignment_completion_v1(
//     p_assignment_ids uuid[], p_student_id uuid default null
//   ) returns table(assignment_id uuid, student_id uuid, completed boolean)
//
// Never replace this with a browser query against the game schema.
export async function getGameAssignmentCompletion(
  supabase: SupabaseClient<Database>,
  assignmentIds: string[],
  studentId: string | null
): Promise<
  | { ok: true; rows: GameAssignmentCompletionRow[] }
  | { ok: false; reason: "rpc_unavailable_or_failed" }
> {
  if (assignmentIds.length === 0) return { ok: true, rows: [] };

  const { data, error } = await gameRpcClient(supabase).rpc(
    "get_game_assignment_completion_v1",
    {
      p_assignment_ids: assignmentIds,
      p_student_id: studentId,
    }
  );
  if (error) {
    console.error("game assignment completion RPC unavailable or failed", {
      code: error.code,
    });
    return { ok: false, reason: "rpc_unavailable_or_failed" };
  }

  const rows = parseCompletionRows(data);
  if (!rows) {
    console.error("game assignment completion RPC returned an invalid contract");
    return { ok: false, reason: "rpc_unavailable_or_failed" };
  }

  const allowedAssignments = new Set(assignmentIds);
  if (
    rows.some(
      (row) =>
        !allowedAssignments.has(row.assignmentId) ||
        (studentId !== null && row.studentId !== studentId)
    )
  ) {
    console.error("game assignment completion RPC exceeded the requested scope");
    return { ok: false, reason: "rpc_unavailable_or_failed" };
  }

  return { ok: true, rows };
}

export function getGameLaunchExchangeUrl(): URL | null {
  const raw = process.env.GAME_LAUNCH_EXCHANGE_URL?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.username || url.password || url.hash || url.search) return null;
    if (url.protocol === "https:") return url;
    if (
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}
