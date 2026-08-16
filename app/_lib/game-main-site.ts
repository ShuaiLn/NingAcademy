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

export type GameUnlockRequirementStatus = {
  requirementId: string;
  assignableId: string;
  kind: "plain" | "vocabulary" | "pronunciation";
  sourceId: string;
  title: string;
  dueAt: string | null;
  completed: boolean;
  completedAt: string | null;
};

export type GameAccessStatus = {
  allowed: boolean;
  assignmentId: string;
  assignmentVersionId: string | null;
  versionNo: number | null;
  requirements: GameUnlockRequirementStatus[];
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

function parseRequirement(value: unknown): GameUnlockRequirementStatus | null {
  if (!isRecord(value)) return null;

  const kind = value.kind;
  const dueAt = value.due_at;
  const completedAt = value.completed_at;
  if (
    typeof value.requirement_id !== "string" ||
    typeof value.assignable_id !== "string" ||
    (kind !== "plain" && kind !== "vocabulary" && kind !== "pronunciation") ||
    typeof value.source_id !== "string" ||
    typeof value.title !== "string" ||
    (dueAt !== null && typeof dueAt !== "string") ||
    typeof value.completed !== "boolean" ||
    (completedAt !== null && typeof completedAt !== "string")
  ) {
    return null;
  }

  return {
    requirementId: value.requirement_id,
    assignableId: value.assignable_id,
    kind,
    sourceId: value.source_id,
    title: value.title,
    dueAt,
    completed: value.completed,
    completedAt,
  };
}

function parseGameAccessStatus(data: unknown): GameAccessStatus | null {
  const row = Array.isArray(data) ? data[0] : null;
  if (!isRecord(row) || !Array.isArray(row.requirements)) return null;

  const requirements: GameUnlockRequirementStatus[] = [];
  for (const value of row.requirements) {
    const parsed = parseRequirement(value);
    if (!parsed) return null;
    requirements.push(parsed);
  }

  if (
    typeof row.allowed !== "boolean" ||
    typeof row.assignment_id !== "string" ||
    (row.assignment_version_id !== null && typeof row.assignment_version_id !== "string") ||
    (row.version_no !== null &&
      (typeof row.version_no !== "number" || !Number.isInteger(row.version_no)))
  ) {
    return null;
  }

  return {
    allowed: row.allowed,
    assignmentId: row.assignment_id,
    assignmentVersionId: row.assignment_version_id,
    versionNo: row.version_no,
    requirements,
  };
}

// The RPC derives the student from auth.uid(). React receives a display-only
// result and never computes or supplies completion/access state.
export async function getGameAccessStatus(
  supabase: SupabaseClient<Database>,
  assignmentId: string
): Promise<{ ok: true; status: GameAccessStatus } | { ok: false }> {
  const { data, error } = await gameRpcClient(supabase).rpc(
    "get_game_access_status",
    { p_assignment_id: assignmentId }
  );
  if (error) {
    console.error("game access status RPC failed", { code: error.code });
    return { ok: false };
  }

  const status = parseGameAccessStatus(data);
  if (!status || status.assignmentId !== assignmentId) {
    console.error("game access status RPC returned an invalid contract");
    return { ok: false };
  }
  return { ok: true, status };
}

// Browser-authenticated RPC. Identity is derived from the Supabase session;
// neither the action nor the browser may choose a user id.
export async function issueGameLaunchTicket(
  supabase: SupabaseClient<Database>,
  assignmentId: string
): Promise<
  | { ok: true; ticket: GameLaunchTicket }
  | { ok: false; reason: "locked" | "rpc_failed" }
> {
  const access = await getGameAccessStatus(supabase, assignmentId);
  if (!access.ok || !access.status.allowed) {
    return { ok: false, reason: "locked" };
  }

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
    return { ok: false, reason: "rpc_failed" };
  }

  const ticket = parseLaunchTicket(data);
  if (!ticket || ticket.assignmentId !== assignmentId) {
    console.error("game launch ticket RPC returned an invalid contract");
    return { ok: false, reason: "rpc_failed" };
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

export function getGameLaunchWebOrigin(exchangeUrl: URL): string | null {
  // Ticket exchange and Games Web are intentionally co-hosted by the one
  // game.ningacademy.org Vercel project. There is no second play/server host.
  return exchangeUrl.origin;
}
