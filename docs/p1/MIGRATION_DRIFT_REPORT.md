# P-1 Migration Drift Report

Status: **CI VERIFICATION PENDING — the confirmed `complete_password_change(uuid)` resolution is encoded in a fourth non-game convergence migration; P-1 PRE-DEPLOYMENT READY is not claimed until a fresh full replay/audit proves zero REAL-UNRESOLVED, ACL, and UNKNOWN drift**

Audit date: 2026-08-15

Repository: `NingAcademy`, branch `main`

Last audited commit/run: `a4b995c5f165489a49a8abe9431d15c4fe046dfa` / `31917569682`

No Production DDL/DML, `db push`, `migration repair`, project relink, or game-schema deployment was executed during this work.

## Current Production/replay evidence

Run `31917569682` is the latest complete Production read-only audit:

| Evidence                            | Result                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| Production read-only proof          | **PASS** — database `postgres`, role `p1_readonly_audit_v2`, `transaction_read_only=on` |
| Production migration history        | 19 migrations, ending at `20260813074607_vocabulary_multiple_choice`                    |
| Active Git/replay inventory         | **PASS** — 22/22 `MATCH`                                                                |
| Clean replay                        | **PASS** — baseline/replay/snapshot/history status all zero                             |
| Convergence-state test              | **PASS** — status zero and final ACL-aware schema diff is empty                         |
| `replay_schema.sql`                 | **PASS** — generated successfully (443,103 bytes)                                       |
| Approved intentional-drift filter   | **PASS** — exact IA-2 object removed; raw evidence retained                             |
| ACL-only unresolved drift           | **PASS** — status zero; `unresolved-project-acl.diff` is empty                          |
| Active Git vs Production history    | **BLOCKED** — 22 vs 19; exactly three Git-only versions                                 |
| Application-schema unresolved drift | **BLOCKED** — one function body and two FK definitions                                  |

The old findings 4–6 remain closed: the combined policies, four `service_role` table grants, boolean `finalize_student_creation` definition/ACL, and sequence defaults no longer differ between Production and replay.

## Shared-environment migration-history check

The authenticated Supabase CLI account exposes exactly two shared projects:

| Shared environment          | Read-only result                               | `20260813230000` | `20260815120000` | `20260815130000` |
| --------------------------- | ---------------------------------------------- | ---------------- | ---------------- | ---------------- |
| `NingAcademy` (linked/main) | 19 remote versions, ending at `20260813074607` | Absent           | Absent           | Absent           |
| `NingAcademy-staging`       | Zero remote versions                           | Absent           | Absent           | Absent           |

The main result independently matches run `31917569682`'s Production `db_migrations.csv`. Both checks used `supabase migration list` only. No link/relink, push, repair, DDL, or DML occurred.

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

## Current active migration inventory

The working tree now has 23 active migrations. `docs/p1/git_migrations.csv` SHA-256 is `e1d6761974cec043cd491a60a555b53945e2d4b7ad526937fdaf5109b9f5e0b2`.

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
| REAL-UNRESOLVED      | None identified after the owner confirmed the Production-shaped `complete_password_change(uuid)` body; fresh CI proof is still pending.                                                                                                                                           |
| ACL unresolved       | None. Run `31917569682` produced an empty ACL-only diff after exact IA-2 filtering.                                                                                                                                                                                               |
| UNKNOWN              | None identified in run `31917569682`; the revised queue requires a fresh full audit before this can be reconfirmed.                                                                                                                                                               |

The gate is expected to remain blocked only by reviewed PENDING-DEPLOYMENT versions; that expectation must be verified by the next full audit.

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

Run `31917569682` verified the first three convergence migrations. The fourth and expanded metadata test require a fresh CI run. None of the migrations was applied to a shared environment.

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

Production is already in the intended state, so this is a no-op there. Run `31917569682` proves the three ACL lines disappear from clean replay: the ACL-only extractor found 209 pg_dump ACL/default-ACL blocks and produced byte-identical Production/replay outputs; `unresolved-project-acl.diff` is empty.

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

## `complete_password_change(uuid)` — RESOLVED IN CODE / PENDING CI AND DEPLOYMENT

After the approved IA-2 object is removed, run `31917569682` contains one application difference unrelated to the confirmed FKs:

- Production ends `public.complete_password_change(uuid)` after recording the successful password-change audit row.
- Clean replay adds a `WHEN OTHERS` handler that inserts a failed audit row and then re-raises.
- Repository history shows the Production-shaped body in the original `20260810164124_core_auth.sql`; commit `05ef89f` renamed that active migration to version `20260810164324` and added the handler. No later active migration converges the function.

The handler's failure audit is not durable: re-raising aborts the same transaction and rolls back the inserted failure row. It can also replace the original error if the compensating insert itself fails. The application already treats any RPC error as failure, so both current bodies surface an error to the caller.

The owner confirmed the simpler current Production body. Migration `20260815150000_complete_password_change_convergence.sql` now converges clean replay and already-final states without changing the function's contract, security attributes, ownership, ACL, OID, or dependencies. It is a non-game PENDING-DEPLOYMENT migration and is not allowlisted from schema comparison.

Fresh CI must prove that this removes the prior REAL-UNRESOLVED body difference without creating UNKNOWN or ACL drift.

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

The raw full-schema/platform and full ACL-aware application diffs are evidence-only. The approved-object filter is fail-closed and hash-pinned; it does not use broad schema patterns and cannot hide FK, policy, function, table, grant, or ACL changes. Run `31917569682` proves approved IA-1/IA-2 differences do not block while the real function/FK differences still fail closed.

## Local verification

| Check                                         | Result                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Active migration inventory                    | PASS — 23 files and SHA-256 values are recorded in `git_migrations.csv`                                                                      |
| P-1 Node script syntax                        | PASS                                                                                                                                         |
| Workflow/Node Prettier parse and format check | PASS                                                                                                                                         |
| Approved-drift exact block test               | PASS — the approved hash is removed; a one-line body change is preserved and logged `UNAPPROVED_PRESERVED`                                   |
| `git diff --check`                            | PASS                                                                                                                                         |
| `npm run typecheck`                           | PASS                                                                                                                                         |
| `npm run build`                               | PASS                                                                                                                                         |
| `npm run lint`                                | Blocked before linting by the pre-existing TypeScript 7 / `typescript-eslint` incompatibility; no P-1 file-specific lint result is available |
| SQL runtime/convergence test                  | Previous 22-file queue PASS; revised 23-file queue and function-metadata preservation test pending fresh CI                                  |
| Production ACL-only comparison                | PASS — run `31917569682`; status zero and empty ACL diff                                                                                     |

`package.json` has no test script.

## Remaining actions for P-1 PRE-DEPLOYMENT READY

1. Commit/push the fourth convergence migration and expanded metadata-preservation test.
2. Run the complete Production read-only audit and require clean replay/convergence PASS, REAL-UNRESOLVED `0`, ACL unresolved `0`, UNKNOWN `0`, and only reviewed PENDING-DEPLOYMENT history/schema differences.
3. Inspect the final artifacts and, only if those conditions hold, mark this report `P-1 PRE-DEPLOYMENT READY`.

Formal `P-1 PASS` still requires a separately authorized deployment of the reviewed non-game migrations followed by history/schema/ACL equality. The archived game draft must never be deployed and migration repair remains prohibited.

Until all actions are complete, do not create `game_unlock_requirements`, `game_assignment_versions`, `game_assignment_completion_status`, `get_game_access_status`, or any other formal game unlock migration/RPC.
