# P-1 Database Audit Runbook

This directory contains the audit evidence and reports required before any new game database migration.

The post-audit staging baseline and Scheme B implementation are complete as
historical verification evidence. See
[`STAGING_GAME_UNLOCK_REPORT.md`](./STAGING_GAME_UNLOCK_REPORT.md) for the
27/27 history, zero-drift, completion, UI, ticket, and staging-backed Games E2E
results. The formal runtime architecture is now Games Vercel + Host-authoritative
WebRTC P2P + signaling in the existing Production Supabase; no future staging
Supabase is required. Git now contains **30** active migrations. As of
2026-08-16, Production received the previously-pending nine-migration
queue (`20260815120000` through `20260815200000`), and a 2026-08-17 live
spot-check confirms Git's 29th entry,
`20260816150000_restrict_rls_auto_enable_execute.sql`, has also since been
applied — Production's **29** versions now match Git's **first 29**
version-for-version. It is a **conditional no-op** on any environment (clean
replay, CI, local dev) that lacks the Production-only `public.
rls_auto_enable()` helper: it checks
`pg_catalog.to_regprocedure('public.rls_auto_enable()')` first and only
issues its `REVOKE EXECUTE` statements when that resolves, which today is
true only on Production. See "2026-08-16 Production deployment confirmed"
and "2026-08-17 P2P room-code bug found; migration 30 drafted" in
`MIGRATION_DRIFT_REPORT.md` for what was and was not verified by each live
spot-check.

Git's **30th** entry, `20260818021000_fix_p2p_room_code_random_source.sql`,
is a newly drafted migration that is **PENDING-DEPLOYMENT** — it has not
been applied to Production. It fixes `game_private.new_p2p_room_code()`,
which was calling the unqualified `gen_random_bytes(6)` (only present in the
`extensions` schema) under `set search_path = ''`, causing every
`POST /api/p2p/rooms` room-creation call to fail in Production with
`function gen_random_bytes(integer) does not exist`. The fix switches to
`pg_catalog.gen_random_uuid()`/`uuid_send()`, both core Postgres functions
already reachable under the empty search_path, so it needs no new schema
grants. Deploying the 30th migration still needs the same
read-only-preflight-then-explicit-approval sequence as any other Production
migration.

The protected audit workflow previously required Production's history and
schema to match a replay of Git's **entire** migration set, which meant it
could never pass while any drafted-but-not-yet-authorized forward migration
existed at all — indistinguishable from a broken gate in exactly the
situation it most needs to handle. It now has a fail-closed mechanism for
tolerating exactly the migration(s) declared in `scripts/p1/approved-
pending-migrations.mjs` (today: just the 30th) — see "2026-08-17 P-1 CI gate
fixed to tolerate exactly one declared-pending migration" in
`MIGRATION_DRIFT_REPORT.md` for the full mechanism and what has and hasn't
been verified about it yet (no actual CI run has exercised it).

## What runs automatically

Pull requests and pushes that touch migrations or P-1 audit files run the isolated migration replay. The developer machine does not need Docker. The workflow uploads the complete replay log, migration history, and schema dumps before enforcing the zero-failure gate. It now replays twice: the full Git migration set (unchanged, still gates "clean replay 30/30"), and a second **prefix** replay with whatever `scripts/p1/list-approved-pending-migrations.mjs` currently declares temporarily excluded — the baseline the protected Production audit compares Production against, so Production is never unfairly diffed against a replay state that already includes migrations it hasn't received yet.

Latest automatic evidence: commit `6b53658dde40e48b8bf9213a5a5a9d49c39cb18f`,
run `31930669031`, **PASS** for the 28/28 clean replay, migration-history
comparison, and four-schema convergence checks. That run predates the 29th
migration (`20260816150000_restrict_rls_auto_enable_execute.sql`), which has
not yet had a CI replay of its own. This does not replace the manual
protected Production read-only audit below.

## Production read-only setup

Production export is manual only. In GitHub:

1. Create or use the protected Environment `production-read-only-audit`.
2. Add Environment secret `PRODUCTION_DATABASE_READ_ONLY_URL` for a dedicated PostgreSQL read-only login.
3. Require an appropriate reviewer for that Environment.
4. Run **P-1 database audit** with `run_production_audit=true`.

Do not use the Supabase service-role key, a normal application JWT, or an owner/postgres connection string. The workflow rejects elevated roles, object-creation privilege, table write privilege, and sequence write privilege before it exports data. It also forces every transaction into read-only mode.

Provisioning or changing that Production role is outside this audit and requires separate approval; this workflow performs no role or privilege DDL.

## Artifacts

- `p1-migration-replay-<run_id>`: full replay log, full/project schema, ACL-aware project schema, replay migration history, comparison result, final/partial/missing-state convergence logs/diff, before/after `complete_password_change` identity/owner/ACL/security metadata, and the equivalent prefix-replay log/schema dumps/migration history/comparison result for whatever `approved-pending-migrations.mjs` currently declares.
- `p1-production-read-only-audit-<run_id>`: the replay evidence plus `db_migrations.csv`, `prod_schema.sql`, project schema dumps, normalized dumps, complete raw unified diffs (against the prefix replay, not the full one), exact approved-drift logs, an unresolved application-schema diff, an ACL-only unresolved diff extracted from pg_dump `ACL`/`DEFAULT ACL` blocks, and `migration-030-precondition.log` from the direct pre-migration-30-state assertion.

The canonical Production export deliberately uses PostgreSQL 17 `pg_dump --schema-only --no-owner --no-privileges`. A second project-only dump retains ACL statements for grant comparison.

## Closing P-1

After a successful manual run, review every artifact and update the three reports with the exact run ID and result. Raw full/platform diffs are always retained as evidence. The gate ignores only exact hash-pinned objects with an approved disposition; changed approved objects are preserved and fail closed. P-1 may pass only when replay/convergence (both the full 30/30 replay and the declared-pending prefix replay) has zero failures, active Git and Production migration histories match exactly for every version *not* declared in `scripts/p1/approved-pending-migrations.mjs` (an undeclared, wrong-version, or non-trailing-suffix gap always fails closed), any migration-specific precondition check (e.g. `scripts/p1/assert-migration-030-precondition.sql`) passes, and unresolved project schema/ACL diffs against the prefix replay are empty. Drafting reviewed forward migrations is allowed; executing any pending Production migration remains forbidden until the protected read-only rerun passes and the owner explicitly authorizes the write. A passing protected audit with a migration still listed in `approved-pending-migrations.mjs` is not itself that authorization — it only proves Production is safely in the expected pre-migration state; the owner's explicit go-ahead to execute is a separate step.
