# P-1 Replay Failures

Status: **PASS for the original 20 migrations (runs 4 and 7, `baseline=0 replay=0 snapshot=0 history=0` both times); 2 new forward-fix migrations (#21-22) added after run 7 and not yet replayed by CI**
Audit date: 2026-08-15

Migration replay of the original 20 migrations is fully resolved; nothing further to fix there. Run 7 additionally completed the Production read-only export and four-way comparison, which surfaced 3 real drift items unrelated to replay mechanics (uncommitted "Phase 1" policy/grant/function changes that reached Production but were never captured as migrations) — see `MIGRATION_DRIFT_REPORT.md`'s "Production drift investigation (run 7)" section for the full classification.

Two new migrations closing those 3 findings — `20260815120000_core_auth_phase1_catchup_rls_and_grants.sql` and `20260815130000_finalize_student_creation_return_status.sql` — were written after run 7 and verified locally (byte-for-byte diff against Production's own dumps, `audit:p1:git-migrations`, `typecheck`, `build` all pass), but this environment has no Docker, so they have never actually been replayed. **The next CI run must replay all 22 migrations from zero** and could in principle surface a Failure 4 in either new file, the same way Failures 1-3 surfaced in the original 20 — do not assume these two are clean until that run comes back. See `MIGRATION_DRIFT_REPORT.md`'s "Forward-fix migrations for findings 4-6" and "Gate decision" sections for what happens after a clean replay (re-comparison against run 7's Production artifacts, not a new Production connection).

## Run 1 examined

- Workflow run: `31905487471`, run number `1`, attempt `3`
- Commit: `c05ae305843500cff9ead9c449731b11bb670397`
- Replay artifact: `p1-migration-replay-31905487471`
- Supabase CLI: `2.114.0`
- Result before this fix: baseline startup succeeded; replay stopped after 10 migrations; Git/replay history comparison reported 10 missing Git versions.

No local Docker replay was attempted. Docker remains isolated to GitHub Actions as required.

## Failure 1: function return-type replacement

| Field | Evidence |
| --- | --- |
| First failing migration | `20260811080227_allow_three_teacher_bootstrap.sql` |
| PostgreSQL error | `ERROR: cannot change return type of existing function (SQLSTATE 42P13)` |
| Failing statement | `create or replace function public.finalize_teacher_bootstrap(uuid, text, text, uuid) returns boolean` |
| Previous definition | `20260810164324_core_auth.sql` creates the same argument signature with `returns void` |
| Replay history at failure | Versions `20260810164324` through `20260811051504` recorded; the failing version and nine later versions were not recorded |

### Root cause

PostgreSQL identifies an overloaded function by name and input argument types, not by return type. `CREATE OR REPLACE FUNCTION` may replace the body and compatible attributes, but it cannot change the return type of an existing `(uuid, text, text, uuid)` function from `void` to `boolean`.

The boolean return is required by `app/actions/setup.ts`: `true` confirms creation and `false` represents the expected three-teacher limit race. Keeping the old `void` contract would make a successful RPC return null and be treated as failure by the Server Action.

### Local correction

The failing migration now:

1. drops the exact old overload before recreating it;
2. creates the intended `returns boolean` function;
3. revokes default `PUBLIC` execute access after recreation;
4. grants execute only to `service_role`, matching the trusted server-only caller.

This correction changes only the existing migration replay contract. It adds no game table or RPC and performs no Production operation. `docs/p1/git_migrations.csv` was updated with the corrected file's SHA-256.

### Verification state

- SQL definition/caller contract inspection: pass.
- Git migration inventory/hash check: pass locally.
- TypeScript typecheck and application build: pass locally.
- Replay validation: pass; workflow run 2 applied this migration and reached migration 20.

This failure remains recorded after its successful rerun.

## Run 2 examined

- Workflow run: `31907092631`, run number `2`, attempt `2`
- Commit: `40612ffab53e6fdf8125ffb9b9abd994759815e8`
- Replay artifact: `p1-migration-replay-31907092631`
- Result before this fix: migrations 1-19 succeeded; replay stopped in migration 20; Git/replay history comparison reported only `20260813230000_game_phase0_contract.sql` missing.

## Failure 2: target owner lacked schema CREATE

| Field | Evidence |
| --- | --- |
| First failing migration | `20260813230000_game_phase0_contract.sql` |
| PostgreSQL error | `ERROR: permission denied for schema public (SQLSTATE 42501)` |
| Failing statement | `alter table public.game_assignment_configs owner to game_api_owner` |
| Replay history at failure | All first 19 versions recorded; only the failing game draft was not recorded |

### Root cause

The migration granted its executor temporary membership in `game_api_owner`, satisfying the requirement that the executor can `SET ROLE` to the new owner. PostgreSQL also requires the prospective owner to have `CREATE` on the object's containing schema. `game_api_owner` did not yet have `CREATE` on `public` when the first `ALTER TABLE ... OWNER` ran.

The same migration granted `CREATE` near its final function-ownership block, but that statement occurred thousands of lines after the table ownership transfer. The privilege was correct in intent and wrong in execution order.

### Local correction

The existing draft migration now grants `USAGE, CREATE` on schema `public` to the NOLOGIN owner role immediately before the ownership transfers. The later duplicate grant was removed. The existing final `REVOKE CREATE ON SCHEMA public FROM game_api_owner` remains in place, so the role does not retain general object-creation permission after migration completion.

This is an execution-order repair only. It creates no new table, RPC, or game requirement and performs no Production operation. `docs/p1/git_migrations.csv` records the corrected SHA-256; `MIGRATION_DRIFT_REPORT.md` retains both the baseline and corrected draft hashes.

### Verification state

- First-failure/artifact inspection: pass.
- Privilege ordering and final privilege revocation inspection: pass.
- Git migration inventory/hash check: pass locally.
- TypeScript typecheck and application build: pass locally.
- Replay validation: pass; workflow runs 3 and 4 passed this ownership block and reached later statements/completion.

## Run 3 examined

- Workflow run: `31907956628`, run number `3`, attempt `1`
- Commit: `0ed4434573bcf6ea790ba80157d55e6518502f9f`
- Result before this fix: migrations 1-19 succeeded; the schema-ownership statements from Failure 2 succeeded, confirming that fix; replay stopped inside migration 20 at a later statement.

## Failure 3: `LEAST`/`GREATEST`/`EXTRACT` schema-qualified as `pg_catalog` function calls

| Field | Evidence |
| --- | --- |
| First failing migration | `20260813230000_game_phase0_contract.sql` |
| PostgreSQL error | `ERROR: function pg_catalog.least(smallint, smallint) does not exist (SQLSTATE 42883)` |
| Failing statement | statement 186, inside `create function game_private.build_launch_context(...)`, the `'screenShakeMax', pg_catalog.least(...)` expression |

### Root cause

`LEAST`, `GREATEST`, and the `EXTRACT(field FROM source)` form are SQL special-form syntax handled directly by the PostgreSQL grammar (the same class as `COALESCE`/`NULLIF`), not ordinary entries in `pg_catalog.pg_proc`. They cannot be schema-qualified. The migration's `set search_path = ''` convention (used throughout this file to make every other function call schema-qualified for SECURITY DEFINER/INVOKER safety) was over-applied to these three keywords.

Reproduced directly against a live database before editing anything, to avoid guessing:

- `select pg_catalog.least(1::smallint, 2::smallint);` → `42883: function pg_catalog.least(smallint, smallint) does not exist`
- `select pg_catalog.extract('epoch' from now());` → `42601: syntax error at or near "from"` (a hard parse error, not just an unresolved name)
- `select extract(epoch from now()), least(1::smallint, 2::smallint), greatest(1::smallint, 2::smallint);` → succeeds unqualified

Only one `pg_catalog.least(...)` call exists inside `build_launch_context` itself (the function statement 186 belongs to), but the identical mistake recurs seven more times later in the same migration file, all `pg_catalog.greatest(...)`, plus one `pg_catalog.extract(... from ...)`. Since CI stops at the first failing statement, leaving those in place would only have reproduced the same root cause as Failure 4 on the next run, so all eight sites were corrected together as one fix.

### Local correction

Removed the invalid `pg_catalog.` prefix from all `least`/`greatest`/`extract` call sites in `20260813230000_game_phase0_contract.sql`:

- line ~2032 (`build_launch_context`): `screenShakeMax` clamp
- line ~2870 (`game_private.` question-exposure upsert): `retention_until` widen
- line ~3014-3017 (answer settlement): `v_response_ms` computation, including the `extract(epoch from ...)` call
- line ~3068 (answer settlement): `next_eligible_at` spacing
- lines ~3178-3189 (attempt void path): four `official_question_count`/`official_correct_count`/`assignment_question_count`/`assignment_correct_count` clamps

No other `pg_catalog.`-qualified special-form keyword (`coalesce`, `nullif`, `substring`, `overlay`, `position`, `trim`, `cast`) remains in the file — checked with a full-file search after the fix. This is a call-site correction only; no table, RPC, or grant behavior changes. `docs/p1/git_migrations.csv` was regenerated and records only this file's new SHA-256.

### Verification state

- Reproduced the exact CI error and the fix, statement-for-statement, against a live database before and after editing: pass.
- Full-file search for the same anti-pattern across all special-form keywords: pass, none remain.
- Git migration inventory/hash check: pass locally.
- TypeScript typecheck and application build: pass locally.
- Replay validation: pass; workflow run 4 completed migration 20 and the full reset.

## Run 4 successful replay

- Workflow run: `31908649338`, run number `4`, attempt `1`
- Commit: `54b5c70bce5543b0d8a5d13ef401d59e2c602319`
- Workflow conclusion: `success`
- Replay artifact: `p1-migration-replay-31908649338`
- Supabase CLI: `2.114.0`
- Replay log: applied all 20 migrations in order and ended with `Finished supabase db reset on branch main.`
- Migration history: 20 Git versions, 20 replay versions, result `MATCH`; no Git-only, replay-only, or same-version/name mismatch.
- Gate status: baseline `0`, replay `0`, snapshot `0`, history comparison `0`.
- Schema outputs: `replay_schema.sql` (629,246 bytes), `replay_project_schema.sql` (460,814 bytes), and ACL-aware `replay_project_schema_with_acl.sql` (537,829 bytes).
- Schema sanity check: the full dump contains the `game` schema, `public.game_assignment_configs`, and `game_private.build_launch_context(...)` from migration 20.

Failures 1-3 remain above as the permanent replay repair history. Run 4 proves that all three are resolved for from-zero replay.

## CI replay contract

`.github/workflows/p1-database-audit.yml` starts an empty Supabase stack and then runs `supabase db reset --local --no-seed --debug`. It always uploads:

- `replay.log` and `baseline-start.log`;
- full and project-only replay schema dumps;
- the ACL-aware project schema dump;
- `replay_db_migrations.csv`;
- the Git/replay history comparison and numeric status files.

The workflow may pass only when startup, replay, snapshot export, and Git/replay history comparison all return zero.

## Gate decision

The **migration replay gate is PASS** as of run 4. P-1 as a whole remains blocked until the separate Production read-only audit exports Production migration history/schema and completes the Production-vs-Git/replay comparisons with zero unresolved drift. Replay success does not authorize a staging/Production migration application or any new game migration.
