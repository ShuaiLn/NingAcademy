# P-1 Database Audit Runbook

This directory contains the audit evidence and reports required before any new game database migration.

## What runs automatically

Pull requests and pushes that touch migrations or P-1 audit files run the isolated migration replay. The developer machine does not need Docker. The workflow uploads the complete replay log, migration history, and schema dumps before enforcing the zero-failure gate.

## Production read-only setup

Production export is manual only. In GitHub:

1. Create or use the protected Environment `production-read-only-audit`.
2. Add Environment secret `PRODUCTION_DATABASE_READ_ONLY_URL` for a dedicated PostgreSQL read-only login.
3. Require an appropriate reviewer for that Environment.
4. Run **P-1 database audit** with `run_production_audit=true`.

Do not use the Supabase service-role key, a normal application JWT, or an owner/postgres connection string. The workflow rejects elevated roles, object-creation privilege, table write privilege, and sequence write privilege before it exports data. It also forces every transaction into read-only mode.

Provisioning or changing that Production role is outside this audit and requires separate approval; this workflow performs no role or privilege DDL.

## Artifacts

- `p1-migration-replay-<run_id>`: full replay log, full/project schema, ACL-aware project schema, replay migration history, comparison result, and final/partial/missing-state convergence logs/diff.
- `p1-production-read-only-audit-<run_id>`: the replay evidence plus `db_migrations.csv`, `prod_schema.sql`, project schema dumps, normalized dumps, complete raw unified diffs, exact approved-drift logs, an unresolved application-schema diff, and an ACL-only unresolved diff extracted from pg_dump `ACL`/`DEFAULT ACL` blocks.

The canonical Production export deliberately uses PostgreSQL 17 `pg_dump --schema-only --no-owner --no-privileges`. A second project-only dump retains ACL statements for grant comparison.

## Closing P-1

After a successful manual run, review every artifact and update the three reports with the exact run ID and result. Raw full/platform diffs are always retained as evidence. The gate ignores only exact hash-pinned objects with an approved disposition; changed approved objects are preserved and fail closed. P-1 may pass only when replay/convergence has zero failures, active Git and Production migration histories match, and unresolved project schema/ACL diffs are empty. Do not add or execute game migrations while any item remains pending.
