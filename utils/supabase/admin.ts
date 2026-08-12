import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/supabase/database.types";
import type { LastSignInLookup } from "./last-sign-in-lookup";

// Secret (service_role) client. Bypasses RLS entirely.
//
// Restricted to genuine Supabase Auth admin operations —
// auth.admin.createUser / updateUserById (password reset, ban) /
// deleteUser (orphan rollback) — plus the two account-bootstrap RPCs
// (finalize_teacher_bootstrap / finalize_student_creation), which are
// deliberately never granted to `authenticated` and so can only be called
// through this client. Every other read or write must go through
// utils/supabase/server.ts so RLS stays the single source of truth for
// authorization.
//
// Third and last exception, and it does NOT live in Next.js code: the
// cleanup-expired-uploads Edge Function (supabase/functions/cleanup-
// expired-uploads/index.ts) builds its own service-role client from the
// project's auto-injected SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY env vars,
// because removing an object from Storage requires the Storage API's
// remove() (service_role), which no SQL statement can do. That function is
// invoked on a schedule by pg_cron/pg_net, not by any Server Action here.
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// listUsers()/getUserById() bypass RLS entirely and are NOT scoped to "this
// teacher's students" -- callers MUST only pass ids already proven owned by
// the current teacher via a prior RLS-scoped query.
export async function getLastSignInTimes(studentIds: string[]): Promise<Map<string, LastSignInLookup>> {
  const result = new Map<string, LastSignInLookup>();
  if (studentIds.length === 0) return result;
  const wanted = new Set(studentIds);
  const admin = createAdminClient();
  let page = 1;
  const perPage = 1000;
  for (let i = 0; i < 20 && result.size < wanted.size; i++) {
    const res = await admin.auth.admin.listUsers({ page, perPage });
    if (res.error || !res.data) {
      console.error("getLastSignInTimes: listUsers failed", res.error);
      break;
    }
    for (const u of res.data.users) {
      if (wanted.has(u.id)) {
        result.set(u.id, u.last_sign_in_at ? { status: "signed_in", at: u.last_sign_in_at } : { status: "never_signed_in" });
      }
    }
    if (!res.data.nextPage) break;
    page = res.data.nextPage;
  }
  // Every remaining id is FK-derived from auth.users, so "still unresolved
  // after exhausting pagination" always means the lookup broke (API error or
  // a pagination edge case), never "this account doesn't exist" -- always
  // lookup_failed, never inferred as never_signed_in.
  for (const id of wanted) if (!result.has(id)) result.set(id, { status: "lookup_failed" });
  return result;
}

export async function getLastSignInTime(studentId: string): Promise<LastSignInLookup> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(studentId);
  if (error || !data?.user) {
    console.error("getLastSignInTime: getUserById failed", error);
    return { status: "lookup_failed" };
  }
  return data.user.last_sign_in_at ? { status: "signed_in", at: data.user.last_sign_in_at } : { status: "never_signed_in" };
}
