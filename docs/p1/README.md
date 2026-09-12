# P-1 Database Audit Runbook

This directory contains the P-1 migration-replay, drift, and closure evidence
used by the repository's database-audit gate.

## 2026-09-12 Personal Word Library Phase 1 closure status

The active inventory contains 33 migrations and ends at
`20260911213841_personal_words_core.sql`. The Phase 1 database and application
core were merged to `main` in commit
[`6fa3f1820852af27852e63c815bbba17c070ae44`](https://github.com/ShuaiLn/NingAcademy/commit/6fa3f1820852af27852e63c815bbba17c070ae44).
The exact-merge workflow
[`34682685882`](https://github.com/ShuaiLn/NingAcademy/actions/runs/34682685882)
passed the 33/33 clean replay, post-retirement Games catalog assertion,
authorization and Personal English pgTAP suites, replay-generated type match,
history/convergence/prefix checks, application verification, production build,
and aggregate gate. Its Production job was skipped. The retained artifacts are
`p1-migration-replay-34682685882` and
`p1-application-verification-34682685882`.

A read-only connected-service inspection on 2026-09-12 observed all 33
migration versions in the NingAcademy Production project, including migrations
31–33, and a READY Vercel Production deployment associated with merge commit
`6fa3f182…`. This observation is evidence of deployed state, not a substitute
for the protected `production-read-only-audit` workflow. The exact deployment
mechanism and Vercel deployment ID remain **UNVERIFIED**.

Phase 1.5 closes only the remaining load-error UI, behavior-copy, and evidence
documentation gaps. It requires no migration and does not alter the existing
tables, RPCs, RLS, grants, migration inventory, Games retirement, convergence,
or CI architecture. The durable evidence manifest is
[`PERSONAL_WORD_LIBRARY_PHASE1_CLOSURE.md`](./PERSONAL_WORD_LIBRARY_PHASE1_CLOSURE.md).

Phase 1.5 application candidate
`83f679ad73d308a1fc3cfd7bfece9cf3a004c686` passed its exact-SHA pull-request
workflow in
[`34686453567`](https://github.com/ShuaiLn/NingAcademy/actions/runs/34686453567),
including the replay, application, and aggregate jobs. The protected Production
job was intentionally skipped. Isolated hosted non-Production acceptance,
protected Production read-only audit, migrations 31–33 owner disposition,
sequencing-exception decision, and final deployment approval remain
**UNVERIFIED**. Phase 1 remains open and is **NOT PASS**.

> The dated sections below are retained as historical audit snapshots. Any
> present-tense deployment count or pending status in those sections applies to
> its stated date and is superseded by the 2026-09-12 status above.

## 2026-09-10 Games retirement status

The five unapplied Games migrations formerly dated `20260822205440` through
`20260825200000` were intentionally removed from the active queue and preserved
byte-for-byte under `supabase/drafts/retired-games-unapplied/`. They were never
applied to Production and must never be included in `db push` or Production
replay expectations. Before the Personal Word Library branch, the active
inventory contained 32 migrations: the 30 known Production migrations, the
independent audit-log restriction migration, and the forward Games teardown.
Earlier 31–35 replay findings below remain historical evidence of why that
unapplied queue was retired.

The post-audit staging baseline and Scheme B implementation are complete as
historical verification evidence. See
[`STAGING_GAME_UNLOCK_REPORT.md`](./STAGING_GAME_UNLOCK_REPORT.md) for the
27/27 history, zero-drift, completion, UI, ticket, and staging-backed Games E2E
results. The historical runtime architecture was Games Vercel + Host-authoritative
WebRTC P2P + signaling in the existing Production Supabase; no future staging
Supabase was required at that time.
As of 2026-08-16, Production received the previously-pending nine-migration
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

Migration 30, `20260818021000_fix_p2p_room_code_random_source.sql`, was
confirmed deployed by the 2026-08-21 read-only migration-history check, so it
has been removed from `approved-pending-migrations.mjs`. Production's known
history is 30 versions. The five later local migrations are **not deployed or
approved**: migration 31 adds the running-room late-join sibling RPC, and
migration 32 adds the per-member P2P academic broker, frozen requirement and
attempt contracts, trusted proof verification/finalization, and checkpoint
academic projection. Migration 33 removes the prompt-bearing Host verification
grant, adds its metadata-only sibling, and adds the private trusted-listening
authorization/storage-delivery foundation. Migration 34 adds the forward-only
formal listening asset/accessibility/one-use Worker resolver contract without
rewriting 31–33. They must pass a fresh full replay
and protected Production read-only preflight before any can be added to the declared-
pending allowlist or considered for explicit deployment authorization.

Migration 35, `20260825200000_game_runtime_security_convergence.sql` (SHA-256
`74112ae68ac47fec403778ad138cce975e4977a42afda953ce9e90453d0c1801`),
is a forward-only final-state convergence after the frozen migrations 31–34.
It enables RLS on seven private academic/listening tables, makes peer checkpoint
projection fail closed, aligns listening locks, and rebuilds `games_api` as an
exact 22-signature allowlist. It cannot repair an earlier migration before the
replay executor reaches it.

## 2026-08-29 historical gate result (superseded)

Final workflow run `32926070717` exercised both jobs. Its canonical baseline started
an empty local Supabase (`baseline_status=0`), then `supabase db reset --local
--no-seed --debug` failed at statement 0 of migration 31, `create function
game.join_p2p_room_v2`, with `ERROR: permission denied for schema game
(SQLSTATE 42501)`. The pinned Supabase CLI 2.114.0 local-reset path connects as
`postgres`, keeps one migration session, executes each file transactionally and
issues `RESET ALL` before each file. Migration 28 transferred schema/object
ownership to `game_api_owner`; migration 30 temporarily enters that role, then
returns to `postgres` and revokes the membership. The workflow did not emit a
separate identity query, but the pinned executor source plus that SQL timeline
deterministically establish that at migration 31 `session_user`, `current_user`
and the effective role are all `postgres`.
The harness models the canonical migration path; it is not using a Games runtime
credential. Migration 31 does not enter the object-owner role and is intrinsically
invalid under that contract. Migrations 33 and 34 independently repeat the same
owner-role choreography omission for later `game`/`game_private` DDL. Because
31–34 are frozen and current policy has no silent amendment procedure,
migration 35 cannot make a from-zero replay reach itself. The full replay gate
is **FAILED**, and none of migrations 31–35 is eligible for approved-pending.

The protected Production read-only job did run. Its dedicated read-only proof
and exports succeeded and show exactly 30 Production migrations. The failed
replay database is the exact clean post-30 prefix; comparing Production to it
yields zero unresolved project-schema, schema-with-ACL and ACL diffs after the
two existing hash-pinned `rls_auto_enable()` filters. The overall audit remains
**FAILED** because full replay and migration-history gates failed. The post-35
runtime catalog assertion was skipped with status 125, so migration 35 remains
statically checked but not database-replay/catalog validated. No Production
write occurred.

The protected audit workflow previously required Production's history and
schema to match a replay of Git's **entire** migration set, which meant it
could never pass while any drafted-but-not-yet-authorized forward migration
existed at all — indistinguishable from a broken gate in exactly the
situation it most needs to handle. It now has a fail-closed mechanism for
tolerating exactly the migration(s) declared in `scripts/p1/approved-
pending-migrations.mjs` (currently none) — see "2026-08-17 P-1 CI gate
fixed to tolerate exactly one declared-pending migration" in
`MIGRATION_DRIFT_REPORT.md` for the full mechanism.

Run `32098254600` was the first actual CI run to exercise that mechanism:
history, precondition, and non-ACL schema comparisons all passed, and it
correctly reproduced the ACL-diff gap predicted in `MIGRATION_DRIFT_REPORT.md`'s
"2026-08-17 P2P room-code bug found" section (migration 29's
`Type: ACL` block for `rls_auto_enable()` was unaccounted for in the
approved-drift filter). That gap is now closed by a second hash-pinned
filter entry (`IA-2-ACL` in `scripts/p1/filter-approved-schema-drift.mjs`)
— see "2026-08-17 Protected audit run 32098254600" in
`MIGRATION_DRIFT_REPORT.md`. No Production write was made or needed; this
was a gate/filter fix only.

## What runs automatically

Pull requests and pushes that touch migrations or P-1 audit files run the isolated migration replay. The developer machine does not need Docker. The workflow uploads the complete replay log, migration history, and schema dumps before enforcing the zero-failure gate. It replays both the full active Git migration set and the prefix produced by `scripts/p1/list-approved-pending-migrations.mjs`. The five retired Games files are statically hash-checked in their evidence directory but are absent from both replay sets and from Production-pending expectations. After a successful full replay, CI runs `scripts/p1/assert-games-retired.sql` to require the post-teardown catalog state.

Latest automatic evidence is merge commit
`6fa3f1820852af27852e63c815bbba17c070ae44`, run
[`34682685882`](https://github.com/ShuaiLn/NingAcademy/actions/runs/34682685882):
**PASS** for the 33/33 clean replay and the complete replay/application
aggregate gate. This does not replace the manual protected Production
read-only audit below.

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
- `p1-application-verification-<run_id>`: replay-generated/committed type comparison and npm install, typecheck, lint, applicable non-database-test, and production-build logs/statuses.
- `p1-production-read-only-audit-<run_id>`: the replay evidence plus `db_migrations.csv`, `prod_schema.sql`, project schema dumps, normalized dumps, complete raw unified diffs (against the prefix replay, not the full one), exact approved-drift logs, unresolved application-schema and ACL diffs, `migration-030-precondition.log`, and `personal-words-phase1-precondition.log`.

The canonical Production export deliberately uses PostgreSQL 17 `pg_dump --schema-only --no-owner --no-privileges`. A second project-only dump retains ACL statements for grant comparison.

## Closing P-1

After a successful manual run, review every artifact and update the three reports with the exact run ID and result. Raw full/platform diffs are always retained as evidence. The gate ignores only exact hash-pinned objects with an approved disposition; changed approved objects are preserved and fail closed. P-1 may pass only when both active replay paths have zero failures, the post-replay Games retirement assertion passes, active Git and Production migration histories match exactly for every version *not* declared in `scripts/p1/approved-pending-migrations.mjs`, every applicable migration-specific precondition passes, and unresolved project schema/ACL diffs against the prefix replay are empty. Archived migrations are evidence, never pending entries. Executing any active pending Production migration remains forbidden until the protected read-only rerun passes and the owner explicitly authorizes the write.
