# P-1 Migration Drift Report

Status: **NINE-MIGRATION QUEUE DEPLOYED TO PRODUCTION — Git 29; Production 28; Production's 28 match Git's first 28 version-for-version; Git's 29th (`20260816150000_restrict_rls_auto_enable_execute.sql`) is drafted and PENDING-DEPLOYMENT, not yet applied; formal protected schema/ACL/FK re-export still not rerun since the nine-migration deployment**

Audit date: 2026-08-15 (original preflight); deployment and live spot-check 2026-08-16

Repository: `NingAcademy`, branch `main`

## 2026-08-16 Production deployment confirmed

The nine-migration queue below (`20260815120000` through `20260815200000`)
has been applied to Production. `mcp__supabase__list_migrations` against the
live project shows exactly 28 versions, ending at
`20260815200000_game_p2p_signaling`. Git's active migration inventory is
now **29** entries — those same 28, plus the newly drafted
`20260816150000_restrict_rls_auto_enable_execute.sql` below. Production's 28
match Git's first 28 version-for-version; Git's 29th migration has **not**
been applied to Production (see the next section). This closes the
PENDING-DEPLOYMENT status recorded below for run `31918316064`, which
covered only the original nine-migration queue.

Two of the nine game/session migrations (`20260815180000_game_session_
identity_v2.sql`, `20260815200000_game_p2p_signaling.sql`) were edited after
their original authoring to fix PostgreSQL 17 temporary role-membership
cleanup bugs (commits `86a20a4`, `48471fa`, `a0bf694` — see
`git log -- supabase/migrations/20260815180000_game_session_identity_v2.sql
supabase/migrations/20260815200000_game_p2p_signaling.sql`). Confirm which
migration content actually ran on Production before treating Git and
Production as byte-identical for those two files specifically.

The following were spot-checked live via the Supabase MCP connection (not
the protected `p1_readonly_audit_v2` read-only role, and not a substitute for
the formal `pg_dump --schema-only` gate this document otherwise requires)
and match the expected post-deployment state:

- `game_api_owner`, `game_server`, `games_api` all exist, `NOLOGIN`,
  `NOINHERIT`, no superuser/createdb/createrole/bypassrls. No
  `games_api_login` role exists yet.
- `games_api`: `game` schema `USAGE` granted, `CREATE` denied; `game_private`
  and `private` schema `USAGE` both denied.
- The `ensure_rls` event trigger (`ddl_command_end` → `public.rls_
  auto_enable()`) still exists and is enabled (`evtenabled = 'O'`).

**New gap found by the same spot-check, not previously tracked in this
document**: `public.rls_auto_enable()` (IA-2 below) still carries
PostgreSQL's default PUBLIC `EXECUTE` grant, so `anon`, `authenticated`,
`service_role`, `game_server`, and `games_api` can all call it directly —
consistent with the Security Advisor's `anon_security_definer_function_
executable` / `authenticated_security_definer_function_executable` warnings
for this function. A forward-only migration,
`supabase/migrations/20260816150000_restrict_rls_auto_enable_execute.sql`,
has been drafted to revoke that EXECUTE grant (from `public` first, then
each role explicitly) without touching the function body, its owner, or the
event trigger. **It has not been applied to Production** — per this
document's own rule below, drafting is allowed but execution requires the
same read-only-preflight-then-explicit-authorization sequence as any other
Production migration.

The first version of that migration issued the two `REVOKE EXECUTE`
statements unconditionally at the top level, which broke the CI clean
replay (GitHub Actions run #38, `SQLSTATE 42883 undefined_function`): a
from-scratch replay never has `public.rls_auto_enable()`, since it is a
Production-only object created by the Supabase Dashboard and never by any
migration in this repo (IA-2 below). The migration is now a **conditional
no-op on any environment that lacks the function** — clean replay, CI,
local dev — and only issues the two `REVOKE EXECUTE` statements when
`pg_catalog.to_regprocedure('public.rls_auto_enable()')` resolves, which is
true today only on Production. It still creates nothing, still never
touches the function body/owner/`SECURITY DEFINER`, still never drops the
function, and still never touches the event trigger; on Production, where
the function exists, it still revokes `EXECUTE` from `public`, `anon`,
`authenticated`, `service_role`, `game_server`, and `games_api` exactly as
before.

The formal protected read-only schema/ACL/FK re-export (the actual gate
described in "Required fresh read-only gate" below) has **not** been rerun
since deployment. The application-schema/ACL/FK drift classification further
down this document (run `31918316064`) predates the nine-migration
deployment and should not be read as still describing current Production
schema state.

## 2026-08-15 WebRTC Production rollout update

The formal multiplayer runtime is now Games Vercel + Host-authoritative WebRTC
P2P + the existing NingAcademy Production Supabase for short-lived signaling.
No future rollout depends on the former staging project. The staging evidence
below is intentionally retained as historical replay/security evidence only.

The active Git inventory is now **28 migrations**. A fresh linked CLI
`supabase migration list` read-only query confirms Production still contains
exactly **19 migrations**, ending at
`20260813074607_vocabulary_multiple_choice`; versions 20–28 are absent.

The latest isolated Git replay is commit
`6b53658dde40e48b8bf9213a5a5a9d49c39cb18f`, run `31930669031`: **PASS**.
It replayed all 28 migrations from zero, matched the 28-entry Git history, and
passed the four-schema (`public`, `private`, `game`, `game_private`)
final/partial/missing-state convergence gate. This proves replayability only;
it is not a Production audit or deployment authorization.

A new Production schema/ACL/FK export could not be run from this workspace
because no `PRODUCTION_DATABASE_READ_ONLY_URL` is available. Owner,
service-role and existing broad application secrets are deliberately not
accepted as substitutes. Therefore migration-history drift is known exactly,
while current schema/ACL/FK/role and UNKNOWN drift must remain **UNKNOWN until
the protected read-only export is rerun**.

No Production DDL, DML, `db push`, migration repair, role creation or project
relink was attempted.

### Exact pending queue

The fresh remote history query establishes this exact nine-migration pending
queue, in order:

1. `20260815120000_core_auth_phase1_catchup_rls_and_grants.sql`
2. `20260815130000_finalize_student_creation_return_status.sql`
3. `20260815140000_core_auth_identity_fk_delete_restrict.sql`
4. `20260815150000_complete_password_change_convergence.sql`
5. `20260815160000_game_phase0_contract.sql`
6. `20260815170000_game_unlock_scheme_b.sql`
7. `20260815180000_game_session_identity_v2.sql`
8. `20260815190000_game_completion_acl_fix.sql`
9. `20260815200000_game_p2p_signaling.sql`

Migration 28 creates only the P2P signaling/membership/checkpoint contract and
the NOLOGIN `games_api` allowlist role. It gives the role zero table access,
revokes the obsolete runtime role's game-schema usage/execute privileges, and
grants the Games Vercel runtime only the identity, gameplay persistence and P2P
RPC whitelist. It does not create a password-bearing LOGIN; that restricted
Production credential is a separate approval/secret operation.

### Required fresh read-only gate

Before migration 20, the protected audit must re-export:

- `supabase_migrations.schema_migrations` and confirm the current Production
  count/tip and the exact nine-item set above;
- application schema plus ACLs, roles, RLS policies and function signatures;
- all application-owned FKs, especially `profiles_id_fkey` and
  `teachers_id_fkey`;
- current `game`/`game_private` schemas, tables and functions, proving no
  unexpected partial game deployment;
- an UNKNOWN-drift result of zero after the exact approved IA-2 filter.

Any different remote version, partial game object, ACL/FK difference outside
the reviewed queue, or UNKNOWN diff stops deployment. After the read-only gate
passes, the nine migrations still require explicit owner authorization before
the first Production write. Database rollback remains forward-fix only; take a
fresh schema/ACL export and verify backups before authorization, deploy in the
listed order, then repeat history/schema/ACL/FK/fixture checks.

Last complete Production read-only audited commit/run:
`c241f08e20dac54b012b9761b67bde71769e43a9` / `31918316064`

No Production DDL/DML, `db push`, migration repair, project relink, or game
schema deployment was executed. Migrations 24–27 exist in the historical
staging target; migration 28 exists only in Git and isolated CI replay.

Post-audit staging evidence is recorded in
[`STAGING_GAME_UNLOCK_REPORT.md`](./STAGING_GAME_UNLOCK_REPORT.md). The
Production evidence below is retained as the historical authorization gate: it
describes the 23-file queue at run `31918316064`, before the four staging-only
game migrations were authored and before migration 28 was added. Current Git
inventory is 28 and Production remains at its read-only audited 19-version
state; staging is historical evidence, not a rollout target.

## Current Production/replay evidence

Run `31918316064` is the latest complete Production read-only audit:

| Evidence                          | Result                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| Production read-only proof        | **PASS** — database `postgres`, role `p1_readonly_audit_v2`, `transaction_read_only=on` |
| Production migration history      | 19 migrations, ending at `20260813074607_vocabulary_multiple_choice`                    |
| Active Git/replay inventory       | **PASS** — 23/23 `MATCH`                                                                |
| Clean replay                      | **PASS** — baseline/replay/snapshot/history status all zero                             |
| Convergence-state test            | **PASS** — status zero; final schema and function metadata diffs are empty              |
| `replay_schema.sql`               | **PASS** — generated successfully (442,751 bytes)                                       |
| Approved intentional-drift filter | **PASS** — exact IA-2 object removed; raw evidence retained                             |
| ACL-only unresolved drift         | **PASS** — status zero; `unresolved-project-acl.diff` is empty                          |
| Active Git vs Production history  | **PENDING-DEPLOYMENT** — 23 vs 19; exactly four reviewed Git-only versions              |
| Application REAL-UNRESOLVED drift | **PASS** — zero; the only gated application diff is the two reviewed pending FKs        |
| UNKNOWN drift                     | **PASS** — zero                                                                         |

The old findings 4–6 remain closed: the combined policies, four `service_role` table grants, boolean `finalize_student_creation` definition/ACL, and sequence defaults no longer differ between Production and replay.

## Shared-environment migration-history check

The authenticated Supabase CLI account exposes exactly two shared projects:

| Shared environment          | Read-only result                               | `20260813230000` | `20260815120000` | `20260815130000` |
| --------------------------- | ---------------------------------------------- | ---------------- | ---------------- | ---------------- |
| `NingAcademy` (linked/main) | 19 remote versions, ending at `20260813074607` | Absent           | Absent           | Absent           |
| `NingAcademy-staging`       | Zero remote versions                           | Absent           | Absent           | Absent           |

The main result independently matches run `31918316064`'s Production `db_migrations.csv`. Both checks used `supabase migration list` only. No link/relink, push, repair, DDL, or DML occurred.

Because no accessible shared environment ever recorded `20260813230000`, the draft was safe to remove from the active migration queue.

## Frozen Phase-0 game draft — RESOLVED

`20260813230000_game_phase0_contract.sql` was moved unchanged from `supabase/migrations/` to `supabase/drafts/`.

| Property                   | Preserved value                                                    |
| -------------------------- | ------------------------------------------------------------------ |
| Original active path       | `supabase/migrations/20260813230000_game_phase0_contract.sql`      |
| Archived path              | `supabase/drafts/20260813230000_game_phase0_contract.sql`          |
| SHA-256                    | `d7870560aaa74a5a024fc77da4659da36b21eb7f798f587bc97e1f197120379b` |
| Byte length                | 156,079                                                            |
| Historical replay evidence | Run `31915313767`, migration 20 of the historical 22-file replay   |

The complete audit record is retained in `supabase/drafts/README.md`. The file is no longer part of `git_migrations.csv`, cannot be picked up by the normal active migration replay/deploy queue, and must not be moved back. A future game design requires a new post-P-1 migration version and separate approval.

## Historical 23-file active migration inventory at run `31918316064`

At that historical run the working tree had 23 active migrations.

| Active order | Migration                                                    | Current SHA-256                                                    | Production history          |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------- |
| 20           | `20260815120000_core_auth_phase1_catchup_rls_and_grants.sql` | `e40d47873428c18b7a470b8830b030cd921de03a45910aa486689d2830974ac6` | Absent — PENDING-DEPLOYMENT |
| 21           | `20260815130000_finalize_student_creation_return_status.sql` | `0cb78db5502b57280ae2f58de22c49e774ea2affeaee9ed4535e71443f543525` | Absent — PENDING-DEPLOYMENT |
| 22           | `20260815140000_core_auth_identity_fk_delete_restrict.sql`   | `376a6b8db05759abccb9c23b73e7f095d6214d0c9a20ec6ab94197a7ca9c7414` | Absent — PENDING-DEPLOYMENT |
| 23           | `20260815150000_complete_password_change_convergence.sql`    | `3b7795f4476080e793538e1fa5706be04f09e2d76bb4c9abaeb11721c516963b` | Absent — PENDING-DEPLOYMENT |

Production has no Production-only migration version.

## Current drift classification

| Classification       | Remaining items                                                                                                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INTENTIONAL-ACCEPTED | IA-1 Supabase-managed full-schema/version noise; IA-2 the exact hash-pinned Dashboard `public.rls_auto_enable()` object. Raw evidence is retained and neither blocks the gated comparison.                                                                                        |
| PENDING-DEPLOYMENT   | Git-only versions `20260815120000`, `20260815130000`, `20260815140000`, and `20260815150000`; the first two and the fourth describe final schema Production already has, while `20260815140000` carries the confirmed `profiles_id_fkey` and `teachers_id_fkey` RESTRICT changes. |
| REAL-UNRESOLVED      | None. Run `31918316064` proves the password function body now matches Production; the only application diff contains the two reviewed pending FKs.                                                                                                                                |
| ACL unresolved       | None. Run `31918316064` produced an empty ACL-only diff after exact IA-2 filtering.                                                                                                                                                                                               |
| UNKNOWN              | None. Every line in the gated application diff is one of the two reviewed FK changes; history contains only the four reviewed Git-only versions.                                                                                                                                  |

The workflow's final gate remains red because reviewed PENDING-DEPLOYMENT history/schema differences intentionally still fail before deployment. No REAL-UNRESOLVED, ACL, or UNKNOWN item contributes to that failure.

## Convergence migrations

### `20260815120000_core_auth_phase1_catchup_rls_and_grants.sql`

The migration no longer assumes legacy policies exist and no longer conflicts when target policies already exist:

- legacy split policies use `DROP POLICY IF EXISTS`;
- an existing compatible combined SELECT/permissive policy is preserved and altered to the canonical role/expression;
- a target policy with an incompatible command/permissiveness is replaced deliberately;
- a missing target policy is created;
- the explicit table grants are repeatable;
- replay-only default sequence ACLs are revoked through repeatable `ALTER DEFAULT PRIVILEGES`.

This converges clean, partial, and already-final policy states without allowlisting the application difference.

### `20260815130000_finalize_student_creation_return_status.sql`

The migration now reads the exact overload's return type from `pg_proc`:

- the function is dropped only when the legacy non-boolean overload exists, because PostgreSQL cannot change its return type in place;
- a missing function is created;
- an existing boolean function keeps its OID/dependencies and is converged through `CREATE OR REPLACE FUNCTION` rather than unconditional drop/recreate;
- revoke/grant statements remain repeatable.

### `20260815140000_core_auth_identity_fk_delete_restrict.sql`

The owner confirmed **RESTRICT / RESTRICT** as the authoritative identity-delete design. The migration inspects each named FK through `pg_constraint` and its exact source/target columns and semantics:

- an already-final FK is left untouched, avoiding unnecessary constraint replacement;
- a missing, CASCADE, or otherwise non-canonical FK is replaced with the exact RESTRICT definition;
- repeated execution is idempotent;
- no game schema or game object is involved.

### `20260815150000_complete_password_change_convergence.sql`

The owner confirmed the current Production function body as authoritative. The migration uses the exact existing signature with `CREATE OR REPLACE FUNCTION` and keeps `RETURNS void`, PL/pgSQL, `SECURITY DEFINER`, empty `search_path`, success behavior, and caller-visible error contract unchanged. PostgreSQL preserves the existing function OID, owner, ACL, and dependencies.

The CI replay job now tests the original clean state, reapplies all four migrations twice to the final state, creates an isolated mixed/partial policy, both function bodies, and CASCADE-FK state, tests a missing `finalize_student_creation` state, reapplies the migrations, and requires:

- the final ACL-aware project dump to equal the canonical replay snapshot;
- `complete_password_change` OID, owner, ACL, language, return type, security flags, volatility/parallel settings, cost, rows, and function config to remain byte-identical before and after convergence.

Run `31918316064` verified all four convergence migrations. `convergence_status=0`, `convergence-schema.diff` is empty, and `complete-password-change-metadata.diff` is empty. None of the migrations was applied to a shared environment.

## Sequence default ACL decision — RESOLVED

The replay-only statements granted `UPDATE ON SEQUENCES` in `public` by default to `anon`, `authenticated`, and `service_role`. They are **not** approved as intentional drift:

- Production does not have them;
- no NingAcademy migration intentionally granted them;
- they came from the local Supabase bootstrap;
- they conflict with this repository's rule that access is granted explicitly per object;
- default `UPDATE` for browser roles broadens future sequence access silently.

Migration `20260815120000_*` now executes the exact repeatable convergence statement:

```sql
alter default privileges for role postgres in schema public
  revoke update on sequences from anon, authenticated, service_role;
```

Production is already in the intended state, so this is a no-op there. Run `31918316064` proves the three ACL lines disappear from clean replay: the ACL-only extractor produced byte-identical Production/replay outputs; `unresolved-project-acl.diff` is empty.

## FK authority — RESOLVED IN CODE / PENDING DEPLOYMENT

Two application-owned constraints still differ:

| Constraint         | Production                              | Clean replay/current design |
| ------------------ | --------------------------------------- | --------------------------- |
| `profiles_id_fkey` | `auth.users(id) ON DELETE CASCADE`      | `ON DELETE RESTRICT`        |
| `teachers_id_fkey` | `public.profiles(id) ON DELETE CASCADE` | `ON DELETE RESTRICT`        |

### Confirmed choice: RESTRICT for both

Evidence for the recommendation:

- `core_auth.sql` explicitly documents the whole `auth.users → profiles → teachers|students` identity chain as `ON DELETE RESTRICT` and states there is no application identity-delete path.
- Normal account lifecycle uses Auth banning plus `profiles.is_active`; it does not hard-delete identities.
- Student/teacher academic records throughout the schema reference `teachers` and `students` with `RESTRICT`, preserving history.
- The only `auth.admin.deleteUser()` calls are orphan rollback after a failed bootstrap; no profile/teacher/student row should have committed in that path, so `RESTRICT` does not block the intended rollback.
- Production's current mix is internally inconsistent: `profiles` and `teachers` use CASCADE, while `students_id_fkey` and downstream academic references use RESTRICT. A top-level cascade usually still stops at a downstream RESTRICT and therefore does not implement a complete deletion workflow.

The owner confirmed RESTRICT / RESTRICT on 2026-08-15. Migration `20260815140000_core_auth_identity_fk_delete_restrict.sql` now encodes the decision without touching game schema. Production remains CASCADE / CASCADE until a separate deployment is explicitly authorized, so the FK difference remains **PENDING-DEPLOYMENT**, not intentional drift and not resolved Production state.

## `complete_password_change(uuid)` — RESOLVED / PENDING DEPLOYMENT HISTORY

After the approved IA-2 object is removed, run `31917569682` contains one application difference unrelated to the confirmed FKs:

- Production ends `public.complete_password_change(uuid)` after recording the successful password-change audit row.
- Clean replay adds a `WHEN OTHERS` handler that inserts a failed audit row and then re-raises.
- Repository history shows the Production-shaped body in the original `20260810164124_core_auth.sql`; commit `05ef89f` renamed that active migration to version `20260810164324` and added the handler. No later active migration converges the function.

The handler's failure audit is not durable: re-raising aborts the same transaction and rolls back the inserted failure row. It can also replace the original error if the compensating insert itself fails. The application already treats any RPC error as failure, so both current bodies surface an error to the caller.

The owner confirmed the simpler current Production body. Migration `20260815150000_complete_password_change_convergence.sql` now converges clean replay and already-final states without changing the function's contract, security attributes, ownership, ACL, OID, or dependencies. It is a non-game PENDING-DEPLOYMENT migration and is not allowlisted from schema comparison.

Run `31918316064` proves that this removes the prior REAL-UNRESOLVED body difference without creating UNKNOWN or ACL drift.

## Intentional accepted drift

| ID   | Approved difference                                                                                                                                                                      | Enforcement                                                                                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IA-1 | Supabase-managed full-schema/version differences (`_realtime`, `supabase_functions`, Realtime partitions, Storage Iceberg, Auth indexes, migration-catalog and extension bootstrap text) | Full raw dump/diff remains in artifacts; the application drift gate does not fail on platform-owned schemas                                                                                                                                                 |
| IA-2 | Production-only `public.rls_auto_enable()` / global `ensure_rls`, created by the Supabase Dashboard automatically-enable-RLS setting                                                     | Raw diff remains; only the exact normalized `rls_auto_enable()` object block with SHA-256 `7934281d71e6f47c7f1fcbaaa8d6be2496b77d6f34dca21994264cdcc2b9718e` is removed from the gated application comparison; any body change remains unresolved and fails |

No game schema/object difference is allowlisted now that the draft is outside the active queue.

## CI drift-gate change

The workflow continues uploading complete raw full/project/project+ACL dumps and diffs. It additionally creates gated project and project+ACL dumps using `scripts/p1/filter-approved-schema-drift.mjs`. `scripts/p1/extract-schema-acl.mjs` then extracts only pg_dump `ACL` and `DEFAULT ACL` object blocks, so ordinary function/FK differences remain application-schema failures without being double-counted as ACL failures.

The final gate now fails on:

- Git vs Production migration-history drift;
- Git vs replay migration-history drift;
- unresolved project schema drift;
- unresolved project ACL drift;
- replay or convergence-test failure.

The raw full-schema/platform and full ACL-aware application diffs are evidence-only. The approved-object filter is fail-closed and hash-pinned; it does not use broad schema patterns and cannot hide FK, policy, function, table, grant, or ACL changes. Run `31918316064` proves approved IA-1/IA-2 differences do not block while the two reviewed PENDING-DEPLOYMENT FK changes still fail closed.

## Local verification

| Check                                         | Result                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Active migration inventory                    | PASS — 28 files and SHA-256 values are recorded in `git_migrations.csv`                                                                      |
| P-1 Node script syntax                        | PASS                                                                                                                                         |
| Workflow/Node Prettier parse and format check | PASS                                                                                                                                         |
| Approved-drift exact block test               | PASS — the approved hash is removed; a one-line body change is preserved and logged `UNAPPROVED_PRESERVED`                                   |
| `git diff --check`                            | PASS                                                                                                                                         |
| `npm run typecheck`                           | PASS                                                                                                                                         |
| `npm run build`                               | PASS                                                                                                                                         |
| `npm run lint`                                | PASS with three unrelated existing warnings after migrating to the Next 16 flat ESLint config and TypeScript 6.0.3                          |
| SQL runtime/convergence test                  | PASS — run `31918316064`; 23/23 replay, convergence schema, and function metadata checks all pass                                            |
| Production ACL-only comparison                | PASS — run `31918316064`; status zero and empty ACL diff                                                                                     |

`package.json` has no test script.

## P-1 PRE-DEPLOYMENT READY decision

All required pre-deployment conditions are satisfied:

- clean replay: PASS;
- convergence and metadata preservation: PASS;
- REAL-UNRESOLVED: `0`;
- ACL unresolved: `0`;
- UNKNOWN: `0`;
- remaining Git/Production history: exactly four reviewed PENDING-DEPLOYMENT migrations;
- remaining gated application diff: exactly the two reviewed PENDING-DEPLOYMENT FK definitions.

The status is therefore **P-1 PRE-DEPLOYMENT READY**.

## Staging-first sequence — completed 2026-08-15

A read-only check confirmed `NingAcademy-staging` was ACTIVE_HEALTHY, empty of
important data, and recorded zero remote migration versions. The sequence below
was then completed without reset, drop, migration repair, or Production writes.

1. **PASS** — schema/data/ACL/history disposition found no important data or unknown high-risk object.
2. **PASS** — established the complete 23-migration baseline normally; the archived draft was never applied.
3. **PASS** — history/schema/ACL/convergence were zero-drift.
4. **PASS** — authored and deployed formal migrations 24–27 to staging only and repeated the same gates.

Formal `P-1 PASS` still requires a separately authorized deployment of the reviewed non-game migrations followed by history/schema/ACL equality. The archived game draft must never be deployed and migration repair remains prohibited.

The former hold on formal game objects is closed for staging. Production rollout
remains separately gated and has not begun.
