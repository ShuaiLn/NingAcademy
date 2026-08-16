# P-1 Replay Failures

Status: **Last verified replay PASS — run `31915313767` replayed the historical 22-file queue; the current 22-file non-game queue and expanded convergence-state gate are pending a fresh CI run**
Audit date: 2026-08-15

Migration replay through run `31915313767` is fully resolved. Failure 1, Failure 2, and Failure 3 below are retained as historical root-cause records. They are not open replay failures. The Phase-0 draft has since left the active queue without changing bytes, and both core-auth forward fixes have changed SHA to become convergence-safe, so the current queue needs a new replay before it can inherit the PASS result.

Run `31915313767` also confirms the separate Production gate corrections: `p1_readonly_audit_v2` passed the restricted-role/project-schema privilege checks with `transaction_read_only=on`, and Production export/comparison proceeded normally. The workflow still concluded failure only because the independent drift gate found documented Git/Production/schema differences. See `MIGRATION_DRIFT_REPORT.md`; those differences do not reopen migration replay.

Run 7's findings are not called into question by this: its read-only-proof step passed with no refusal message logged at all, meaning all five checks were genuinely satisfied on their own merits that time — the `\quit` bug only ever mattered on a check that _fails_, and none did in run 7. What changed for run 9, and whether the same secret resolved to a different, elevated role at that point, was not investigated here (Production role/secret provisioning is explicitly out of scope for this fix) — the user later reprovisioned the Production connection role as `p1_readonly_audit_v2`. Run `31915313767` now supplies the required positive proof: that role passes with no refusal message and `transaction_read_only=on`.

## Run 1 examined

- Workflow run: `31905487471`, run number `1`, attempt `3`
- Commit: `c05ae305843500cff9ead9c449731b11bb670397`
- Replay artifact: `p1-migration-replay-31905487471`
- Supabase CLI: `2.114.0`
- Result before this fix: baseline startup succeeded; replay stopped after 10 migrations; Git/replay history comparison reported 10 missing Git versions.

No local Docker replay was attempted. Docker remains isolated to GitHub Actions as required.

## Failure 1: function return-type replacement

| Field                     | Evidence                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| First failing migration   | `20260811080227_allow_three_teacher_bootstrap.sql`                                                                         |
| PostgreSQL error          | `ERROR: cannot change return type of existing function (SQLSTATE 42P13)`                                                   |
| Failing statement         | `create or replace function public.finalize_teacher_bootstrap(uuid, text, text, uuid) returns boolean`                     |
| Previous definition       | `20260810164324_core_auth.sql` creates the same argument signature with `returns void`                                     |
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

| Field                     | Evidence                                                                     |
| ------------------------- | ---------------------------------------------------------------------------- |
| First failing migration   | `20260813230000_game_phase0_contract.sql`                                    |
| PostgreSQL error          | `ERROR: permission denied for schema public (SQLSTATE 42501)`                |
| Failing statement         | `alter table public.game_assignment_configs owner to game_api_owner`         |
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

| Field                   | Evidence                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| First failing migration | `20260813230000_game_phase0_contract.sql`                                                                                                |
| PostgreSQL error        | `ERROR: function pg_catalog.least(smallint, smallint) does not exist (SQLSTATE 42883)`                                                   |
| Failing statement       | statement 186, inside `create function game_private.build_launch_context(...)`, the `'screenShakeMax', pg_catalog.least(...)` expression |

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

## Run 9: Production read-only gate did not actually stop the job

- Workflow run: `31911857826`, run number `9`, `workflow_dispatch`, commit `b1c3628` (the forward-fix migrations from findings 4-6)
- Job `Replay every migration from zero`: **success** — all 22 migrations (including the two new forward-fix migrations) replayed clean from zero. Not investigated further here per instruction; schema-drift re-comparison is separate follow-up work.
- Job `Production read-only audit`: **failure**, but only at the final `Enforce zero unresolved drift` step. Every step before it — including `Prove the Production connection is read-only`, `Export Production migration history and schema`, `Compare all four P-1 evidence sets`, `Upload Production read-only evidence` — reported **success**.

The read-only-proof step's own log contained:

```
Refusing Production audit: the connection role is elevated.
\quit: extra argument "11" ignored
```

### Root cause

`scripts/p1/assert-production-read-only.sql` used `\quit 10` / `\quit 11` / `\quit 12` / `\quit 13` / `\quit 14` to try to signal which specific check failed via a distinct process exit code. **`psql`'s `\q`/`\quit` meta-command does not accept an exit-code argument at all** — any argument is printed as an ignored-argument warning, and psql quits with whatever status it would have had anyway (0, since from psql's own perspective no error occurred; `\echo` and `\quit` are just meta-commands, not SQL). So every one of the five refusal branches printed the correct human-readable message and then **exited 0**. `docker run`'s own exit code was therefore 0, the step was marked `success`, and the job proceeded straight through the export and comparison steps using a connection that the script had just correctly identified as elevated.

No destructive operation actually occurred despite this: every statement the workflow itself issues against Production is `SELECT`, `COPY ... TO STDOUT`, or `pg_dump --schema-only`, regardless of which role is connected — the workflow contains no DDL/DML statement anywhere, elevated connection or not. But the safety _gate_ itself was not enforcing the boundary it exists to enforce, and this could have masked a real problem on a future change to this workflow. This is a latent bug in the read-only-proof script, not a new schema/migration issue, and not something a Postgres role-privilege change on Production's side could ever have fixed by itself.

Root cause of the elevated connection itself was **not** investigated per instruction (`暂时不要处理 schema drift，先修好只读权限 gate` — fix the gate first) — that is Production role provisioning, outside this repository and outside this agent's access; whatever role `PRODUCTION_DATABASE_READ_ONLY_URL` resolves to today has `rolsuper`, `rolcreatedb`, `rolcreaterole`, `rolreplication`, or `rolbypassrls` set, and fixing that is a separate, Production-side follow-up.

### Local correction

Replaced every `\quit N` with a genuine SQL-level error inside a `DO` block:

```sql
do $$ begin raise exception 'Refusing Production audit: ...' using errcode = 'P0001'; end; $$;
```

`\set ON_ERROR_STOP on` is already set at the top of the script, and `psql` is invoked with `--file` in the workflow. Per psql's own documented exit-code semantics ("3 if an error occurred in a script and the variable `ON_ERROR_STOP` was set"), a genuine `RAISE EXCEPTION` reliably makes `psql` — and therefore `docker run`, and therefore the GitHub Actions step — exit non-zero and stop immediately, regardless of which of the five checks fails first. The exception is raised inside the still-open `read only` transaction and is never committed; the transaction is simply abandoned on connection close, so this remains a strictly read-only script with no Production DDL/DML. All five refusal branches were converted identically; nothing else in the script (the five underlying privilege checks themselves, the final `select ...; commit;`) was changed.

### Verification state

- Structural check (`\if`/`\else`/`\endif` balance, `$$ ... $$;` pairing, no remaining `\quit`): pass, read directly from the edited file.
- psql exit-code semantics for `ON_ERROR_STOP` + script-file errors: documented behavior (exit 3), not guessed.
- Subsequent runs 11–13 confirmed the corrected script really stops the job on a failed assertion; run `31915313767` confirms the same script succeeds for the restricted `p1_readonly_audit_v2` role without a refusal message. This gate bug is closed.
- This fix does not touch `docs/p1/git_migrations.csv` (this script lives under `scripts/p1/`, not `supabase/migrations/`) and does not touch any migration file.

## Runs 11-13: write-privilege checks false-positive on Supabase extension schemas

- Workflow runs: `31912695067` (run 11), `31913066721` (run 12), `31914647434` (run 13), all `workflow_dispatch` on commit `d14ea9b` (the user's own commit of the run-9 `\quit` fix above)
- All three: job `Replay every migration from zero` — **success**. Job `Production read-only audit` — **failure**, specifically at the `Prove the Production connection is read-only` step, consistently across all three runs.

This is confirmation that the run-9 fix works exactly as intended: `Prove the Production connection is read-only` is now genuinely stopping the job (fail-closed) instead of silently succeeding. But the reason it stops is itself a false positive, reported directly by the user after inspecting the Production role: `p1_readonly_audit_v2` (Production's connection role as of these runs) has **only** `pg_read_all_data` membership and no other role membership — not elevated, not a false negative on the `role_is_restricted` check. The trip is the table/sequence write-privilege checks, on:

- `cron.job_run_details`
- `net._http_response`
- `net.http_request_queue`

### Root cause

The write-privilege checks scanned every schema except `information_schema` and anything matching `^pg_` — far broader than the four schemas this audit actually reads or dumps (`public`, `private`, `game`, `game_private`). Supabase's own `pg_cron`/`pg_net` extensions commonly grant some privileges on their own internal bookkeeping tables **to `PUBLIC`** as part of their installation scripts — a privilege every role inherits regardless of how restricted it otherwise is, confirmed by the user to originate from `PUBLIC`, not from any direct grant to `p1_readonly_audit_v2`. This has nothing to do with whether the connection role can write anything belonging to NingAcademy's own schema; it is Supabase platform/extension configuration, the same category as the `full-schema.diff` platform noise already documented in `MIGRATION_DRIFT_REPORT.md` findings 2-3.

### Local correction

Scoped both the table-write and sequence-write checks in `scripts/p1/assert-production-read-only.sql` to exactly the four project schemas:

```sql
where namespace.nspname in (
  'public',
  'private',
  'game',
  'game_private'
)
```

replacing the previous `namespace.nspname <> 'information_schema' and namespace.nspname !~ '^pg_'`. Nothing else in the script changed:

- The `role_is_restricted` check (rolsuper/rolcreatedb/rolcreaterole/rolreplication/rolbypassrls) is untouched — not implicated in this false positive, and the user's own inspection already confirms it correctly passes for `p1_readonly_audit_v2`.
- The `role_cannot_create_objects` check (`CREATE` privilege) is untouched — not reported as a false positive, and `pg_read_all_data` grants no `CREATE` privilege anywhere, so it is not expected to have the same problem. If a future run shows it does, that would need its own investigation rather than assuming the same fix applies.
- No `GRANT`/`REVOKE` was run anywhere, no Production connection was made, and `cron`/`net` privileges were not touched — the fix is a read-side scope narrowing only, in a file this agent runs entirely offline against.
- This still fails closed: if `p1_readonly_audit_v2` (or any future connection role) actually has INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES on any table, or USAGE/UPDATE on any sequence, in `public`/`private`/`game`/`game_private` specifically, the check still trips and the run-9 fix still makes that a real, non-zero-exit failure.

### Verification state

- Confirmed via the GitHub API that all three runs (11-13) failed at exactly `Prove the Production connection is read-only`, not later — consistent, not flaky, and consistent with the user's own direct inspection of the role's actual grants.
- Structural check of the edited file (balanced `\if`/`\else`/`\endif`, `$$...$$;` pairing, no `\quit`): pass, read directly from the file.
- Run `31915313767` supplies the missing live verification: the proof step reports `p1_readonly_audit_v2` with `transaction_read_only=on`, completes successfully, and reaches the export/comparison steps without a refusal message. The false positive is closed.

## Run 15: replay and Production read-only gate confirmed

- Workflow run: `31915313767`, attempt 1, commit `ccebaabc9eb27efe7e07ddf832a1e6799dc2a845`
- Replay artifact: `p1-migration-replay-31915313767`
- Production artifact: `p1-production-read-only-audit-31915313767`

The downloaded `replay.log` applies, in order, all 19 pre-game migrations, the frozen `20260813230000_game_phase0_contract.sql`, and both forward fixes:

- `20260815120000_core_auth_phase1_catchup_rls_and_grants.sql`
- `20260815130000_finalize_student_creation_return_status.sql`

It then reports `Finished supabase db reset on branch main.` The artifact contains a non-empty `replay_schema.sql` (629,208 bytes), project-only and ACL-aware schema dumps, `replay_db_migrations.csv`, and the complete startup/replay logs.

All replay gate inputs are zero:

```text
baseline_status=0
replay_status=0
snapshot_status=0
history_comparison_status=0
```

`git-vs-replay-migrations.md` reports 22 Git / 22 replay migrations and `MATCH`, with no Git-only, replay-only, or same-version/different-name rows. This is the authoritative current replay result: **PASS, zero replay failures**.

The same run finally verifies the earlier read-only gate fixes against Production rather than only structurally:

```text
audited_database = postgres
audit_role = p1_readonly_audit_v2
transaction_read_only = on
```

The proof step completed, the read-only export generated `db_migrations.csv` and all Production schema dumps, and the job reached the final drift gate. Its final failure (`git/prod=1`, `full-schema=1`, `project-schema=1`, `project-ACL=1`) is classified in `MIGRATION_DRIFT_REPORT.md`; it is not a replay or read-only-gate failure.

## Post-run-15 queue and convergence changes — CI pending

Read-only `supabase migration list` checks found exactly two accessible shared projects. `NingAcademy` has the same 19-version history captured in run 15, and `NingAcademy-staging` has zero remote versions. Neither project records `20260813230000`, `20260815120000`, or `20260815130000`.

That evidence permitted the unchanged frozen draft to move to `supabase/drafts/`; its SHA-256 remains `d7870560aaa74a5a024fc77da4659da36b21eb7f798f587bc97e1f197120379b`. The active queue is now 22 files: the 19 Production-recorded versions plus three pending core-auth convergence migrations.

The convergence changes address failure modes that a clean replay alone cannot cover:

- `20260815120000_*` removes legacy policies only when present, converges existing/missing/incompatible target policies without name collisions, repeats grants safely, and revokes the three local-bootstrap sequence default ACLs.
- `20260815130000_*` drops only the legacy non-boolean overload; an existing boolean function is updated in place with `CREATE OR REPLACE`, preserving its OID/dependencies.
- `20260815140000_*` leaves exact RESTRICT FKs untouched and replaces missing or non-canonical/CASCADE variants with the confirmed RESTRICT definitions.
- The replay workflow now reapplies all three migrations twice to the already-final local schema, creates a mixed partial state including CASCADE FKs, tests a missing-function state, reapplies convergence, and requires the final ACL-aware project schema to match the pre-test replay snapshot exactly.

Current hashes awaiting CI verification:

| Migration                                                    | SHA-256                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `20260815120000_core_auth_phase1_catchup_rls_and_grants.sql` | `e40d47873428c18b7a470b8830b030cd921de03a45910aa486689d2830974ac6` |
| `20260815130000_finalize_student_creation_return_status.sql` | `0cb78db5502b57280ae2f58de22c49e774ea2affeaee9ed4535e71443f543525` |
| `20260815140000_core_auth_identity_fk_delete_restrict.sql`   | `376a6b8db05759abccb9c23b73e7f095d6214d0c9a20ec6ab94197a7ca9c7414` |

No shared database was modified. A fresh CI run is required; this section does not claim the revised queue has already passed.

## CI replay contract

`.github/workflows/p1-database-audit.yml` starts an empty Supabase stack and then runs `supabase db reset --local --no-seed --debug`. It always uploads:

- `replay.log` and `baseline-start.log`;
- full and project-only replay schema dumps;
- the ACL-aware project schema dump;
- `replay_db_migrations.csv`;
- the Git/replay history comparison and numeric status files;
- convergence logs, post-test schema, and exact schema diff.

The workflow may pass only when startup, replay, snapshot export, Git/replay history comparison, and the final/partial/missing-state convergence tests all return zero.

## Gate decision

Run `31915313767` is the last verified replay PASS, covering the historical 22-file queue. The revised 22-file active non-game queue is **pending CI verification** because all three convergence migrations and the replay gate changed after that run. The FK authority decision itself is closed as RESTRICT / RESTRICT; P-1 remains blocked by the new verification and pending Production history/application reconciliation in `MIGRATION_DRIFT_REPORT.md`. No replay result authorizes staging/Production migration application or any new game migration.
