import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/supabase/database.types";

export type GameUnlockCandidate = {
  assignableId: string;
  kind: "plain" | "vocabulary" | "pronunciation";
  sourceId: string;
  title: string;
  dueAt: string | null;
  selected: boolean;
};

type RpcResult = { data: unknown; error: { code?: string } | null };
type NarrowRpcClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCandidates(data: unknown): GameUnlockCandidate[] | null {
  if (!Array.isArray(data)) return null;
  const candidates: GameUnlockCandidate[] = [];
  for (const row of data) {
    if (!isRecord(row)) return null;
    const kind = row.assignable_kind;
    const dueAt = row.due_at;
    const selected = row.selected ?? false;
    if (
      typeof row.assignable_id !== "string" ||
      (kind !== "plain" && kind !== "vocabulary" && kind !== "pronunciation") ||
      typeof row.source_id !== "string" ||
      typeof row.title !== "string" ||
      (dueAt !== null && typeof dueAt !== "string") ||
      typeof selected !== "boolean"
    ) {
      return null;
    }
    candidates.push({
      assignableId: row.assignable_id,
      kind,
      sourceId: row.source_id,
      title: row.title,
      dueAt,
      selected,
    });
  }
  return candidates;
}

async function listCandidates(
  supabase: SupabaseClient<Database>,
  rpcName: "list_my_assignables_v1" | "list_game_unlock_candidates_v1",
  args?: Record<string, unknown>
): Promise<GameUnlockCandidate[] | null> {
  const client = supabase as unknown as NarrowRpcClient;
  const { data, error } = await client.rpc(rpcName, args);
  if (error) {
    console.error("game unlock candidate RPC failed", {
      rpcName,
      code: error.code,
    });
    return null;
  }
  return parseCandidates(data);
}

export function listMyGameUnlockCandidates(supabase: SupabaseClient<Database>) {
  return listCandidates(supabase, "list_my_assignables_v1");
}

export function listGameUnlockCandidates(
  supabase: SupabaseClient<Database>,
  assignmentId: string
) {
  return listCandidates(supabase, "list_game_unlock_candidates_v1", {
    p_game_assignment_id: assignmentId,
  });
}
