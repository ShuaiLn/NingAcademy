# P-1 Database Audit Runbook

This directory contains the audit evidence and reports required before any new game database migration.

The post-audit staging baseline and Scheme B implementation are complete as
historical verification evidence. See
[`STAGING_GAME_UNLOCK_REPORT.md`](./STAGING_GAME_UNLOCK_REPORT.md) for the
27/27 history, zero-drift, completion, UI, ticket, and staging-backed Games E2E
results. The formal runtime architecture is now Games Vercel + Host-authoritative
WebRTC P2P + signaling in the existing Production Supabase; no future staging
Supabase is required. Git now contains 28 active migrations; a fresh linked
read-only history query confirms Production contains 19. The exact
nine-migration queue and still-required schema/ACL/FK UNKNOWN-drift gate are
listed in `MIGRATION_DRIFT_REPORT.md`. Production has
not received the pending game migrations, and a fresh read-only preflight plus
explicit approval is still required first.

## What runs automatically

Pull requests and pushes that touch migrations or P-1 audit files run the isolated migration replay. The developer machine does not need Docker. The workflow uploads the complete replay log, migration history, and schema dumps before enforcing the zero-failure gate.

Latest automatic evidence: commit `6b53658dde40e48b8bf9213a5a5a9d49c39cb18f`,
run `31930669031`, **PASS** for the 28/28 clean replay, migration-history
comparison, and four-schema convergence checks. This does not replace the
manual protected Production read-only audit below.

## Production read-only setup

Production export is manual only. In GitHub:

1. Create or use the protected Environment `production-read-only-audit`.
2. Add Environment secret `PRODUCTION_DATABASE_READ_ONLY_URL` for a dedicated PostgreSQL read-only login.
3. Require an appropriate reviewer for that Environment.
4. Run **P-1 database audit** with `run_production_audit=true`.

Do not use the Supabase service-role key, a normal application JWT, or an owner/postgres connection string. The workflow rejects elevated roles, object-creation privilege, table write privilege, and sequence write privilege before it exports data. It also forces every transaction into read-only mode.

Provisioning or changing that Production role is outside this audit and requires separate approval; this workflow performs no role or privilege DDL.

## Artifacts

- `p1-migration-replay-<run_id>`: full replay log, full/project schema, ACL-aware project schema, replay migration history, comparison result, final/partial/missing-state convergence logs/diff, and before/after `complete_password_change` identity/owner/ACL/security metadata.
- `p1-production-read-only-audit-<run_id>`: the replay evidence plus `db_migrations.csv`, `prod_schema.sql`, project schema dumps, normalized dumps, complete raw unified diffs, exact approved-drift logs, an unresolved application-schema diff, and an ACL-only unresolved diff extracted from pg_dump `ACL`/`DEFAULT ACL` blocks.

The canonical Production export deliberately uses PostgreSQL 17 `pg_dump --schema-only --no-owner --no-privileges`. A second project-only dump retains ACL statements for grant comparison.

## Closing P-1

After a successful manual run, review every artifact and update the three reports with the exact run ID and result. Raw full/platform diffs are always retained as evidence. The gate ignores only exact hash-pinned objects with an approved disposition; changed approved objects are preserved and fail closed. P-1 may pass only when replay/convergence has zero failures, active Git and Production migration histories match, and unresolved project schema/ACL diffs are empty. Drafting reviewed forward migrations is allowed; executing any pending Production migration remains forbidden until the protected read-only rerun passes and the owner explicitly authorizes the write.
