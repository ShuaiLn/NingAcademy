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
// Migration 30 was confirmed deployed on 2026-08-21. Migrations 31 through 35
// are local, unapproved and undeployed. The 2026-08-25 protected preflight ran
// but failed closed because the exact queue cannot replay from zero, so none is
// eligible for this exemption yet.
export const approvedPendingMigrations = [];
