// Deliberately no imports and no "server-only": utils/supabase/admin.ts is
// server-only, but this discriminated result type is also needed by the
// Client Component that renders it (last-sign-in-badge.tsx). Keeping the
// type here means the client badge never depends on admin.ts at all.
export type LastSignInLookup =
  | { status: "signed_in"; at: string }
  | { status: "never_signed_in" }
  | { status: "lookup_failed" };
