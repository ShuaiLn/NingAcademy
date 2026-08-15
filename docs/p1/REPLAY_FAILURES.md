# P-1 Replay Failures

Status: **SECOND FAILURE FIXED LOCALLY; CI RERUN REQUIRED**
Audit date: 2026-08-15

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
- Full migration replay: pending the next GitHub Actions run.

## CI replay contract

`.github/workflows/p1-database-audit.yml` starts an empty Supabase stack and then runs `supabase db reset --local --no-seed --debug`. It always uploads:

- `replay.log` and `baseline-start.log`;
- full and project-only replay schema dumps;
- the ACL-aware project schema dump;
- `replay_db_migrations.csv`;
- the Git/replay history comparison and numeric status files.

The workflow may pass only when startup, replay, snapshot export, and Git/replay history comparison all return zero.

## Gate decision

P-1 remains blocked. A new CI run must prove that the corrected migration succeeds and expose the next first failure, if any. No staging/Production migration application and no new game migration are authorized by this repair.
