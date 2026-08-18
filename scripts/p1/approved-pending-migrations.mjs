// Migrations the P-1 gate is allowed to treat as pending: drafted,
// committed to Git, and read-only-preflighted against Production, but not
// yet authorized to execute. This is the single source of truth consumed by
// both compare-migration-history.mjs (gating logic) and
// list-approved-pending-migrations.mjs (the CI replay-prefix step) so the
// two can never drift out of sync with each other.
//
// Add an entry only after a live read-only preflight of the exact migration
// being deferred. Remove it the moment a fresh spot-check confirms
// Production has actually received that migration -- see
// docs/p1/MIGRATION_DRIFT_REPORT.md for the audit trail. An entry left here
// after deployment does not weaken anything (compare-migration-history.mjs
// fails closed the moment the declared version is no longer missing from
// the database being audited), but it should still be removed promptly so
// the report stays accurate.
export const approvedPendingMigrations = [
  {
    version: "20260818021000",
    filename: "20260818021000_fix_p2p_room_code_random_source.sql",
    reason:
      "game_private.new_p2p_room_code() random-byte source fix -- only CREATE OR REPLACE FUNCTION of that one function, temporary self-scoped role membership only, no ACL/owner/other-object change. Read-only-preflighted against Production 2026-08-17. Awaiting explicit owner authorization to execute.",
  },
];
