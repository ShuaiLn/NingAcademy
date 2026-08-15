# P-1 Migration Drift Report

Status: **BLOCKED — 2 forward-fix migrations written for all 3 real drift items; verified locally byte-for-byte against Production's dumps; CI replay + re-comparison against run 7 still required before any item can be marked closed**
Audit date: 2026-08-15  
Repository: `NingAcademy`, branch `main`, baseline commit `b0cbc6fd01ea38e3abfcc9c62b75e0fdc5be0eef`

## Evidence inventory

| Evidence | State | Location |
| --- | --- | --- |
| Git migration history | Complete | `docs/p1/git_migrations.csv` |
| Production migration history | PASS; captured | run 7 artifact `production/db_migrations.csv` |
| Production schema | PASS; captured (full, project, project+ACL) | run 7 artifact `production/prod_schema.sql` and siblings |
| Clean replay history | PASS; 20 Git / 20 replay, `MATCH` | run 7 artifact `replay/replay_db_migrations.csv` |
| Clean replay schema | PASS; generated successfully | run 7 artifact `replay/replay_schema.sql` |
| Replay failure log | PASS; all 20 applied and reset finished, `baseline_status=0 replay_status=0 snapshot_status=0 history_status=0` | run 7 artifact `replay/replay.log` |
| Production read-only proof | PASS (inferred from step success: the job's next steps, which depend on it, produced output — `assert-production-read-only.sql` calls `\quit 10-14` on any violation, which would have stopped the job before any export ran) | run 7 job `Production read-only audit`, step `Prove the Production connection is read-only` |

The Git inventory contains 20 tracked SQL migrations, ordered lexicographically by their 14-digit timestamp. Every row records the exact filename and SHA-256 of the raw file bytes. `npm run audit:p1:git-migrations` fails if that committed inventory becomes stale.

Run 7 (`31910260330`, commit `54b5c70`) is the first run where `PRODUCTION_DATABASE_READ_ONLY_URL` was valid (runs 5 and 6 failed with a libpq URI parse error — `unexpected spaces found in "role p1_readonly_audit"` — from an un-percent-encoded `options=-c role=...` fragment in the secret value itself; that failure happened client-side before any socket connection opened, so no query, read-only or otherwise, reached Production in runs 5/6). Its artifacts (`p1-migration-replay-31910260330`, `p1-production-read-only-audit-31910260330`) were downloaded and read from disk directly, since this environment has no `gh` CLI and no `GITHUB_TOKEN`/`GH_TOKEN` to call the Artifacts API (list works unauthenticated on a public repo; download returns `401`).

## Four-way comparison

| Comparison | Run 7 result | P-1 disposition |
| --- | --- | --- |
| Git history vs Production history | DRIFT: Git 20, Production 19; Production-only = none, Git-only = `20260813230000_game_phase0_contract.sql` | Resolved: INTENTIONAL-ACCEPTED, matches the already-documented frozen-draft disposition below |
| Git history vs replay history | PASS: 20/20 `MATCH` | Resolved |
| Production full schema vs replay full schema | DRIFT (exit 1) | Resolved: entirely `game`/`game_private` (expected) + Supabase-platform-managed schemas/extension-bootstrap text (`_realtime`, `supabase_functions`, `realtime.messages_*`, `auth.idx_users_*`, `supabase_migrations.schema_migrations_idempotency_key_key`, `pg_net` bootstrap script version, `public.rls_auto_enable()`) — see classification table below |
| Production project schemas vs replay project schemas (`public`,`private`,`game`,`game_private`) | DRIFT (exit 1) | 3 real findings, all FORWARD-FIX — see classification table below |
| Production grants/ACL vs replay grants/ACL | DRIFT (exit 1) | Same 3 findings, ACL-scoped view — see classification table below |

The workflow compares full schema dumps and separately compares `public`, `private`, `game`, and `game_private`. The second comparison isolates application-controlled objects. A third dump retains ACL statements so grants are not hidden by the canonical `--no-privileges` schema export. `private` schema showed **zero** differences of any kind in any of the three comparisons.

## Production drift investigation (run 7)

Investigated by reading every artifact file directly (not just the diff exit codes): `full-schema.diff` (6,083 lines), `project-schema.diff` (5,170 lines), `project-schema-with-acl.diff` (5,739 lines), `db_migrations.csv`, `git-vs-production-migrations.md`, and the raw `prod_project_schema_with_acl.sql`/`replay_project_schema_with_acl.sql` dumps for the exact statement text behind every drifted object. Every `public`/`private`-schema difference was individually enumerated (not sampled) via `grep -E "^[+-]-- Name: .*; Schema: (public|private);"` against the normalized diffs, then cross-checked against every tracked migration file to confirm whether Git ever touches that object.

| # | Difference | Cause | Real drift? | Classification | Action required |
| - | --- | --- | --- | --- | --- |
| 1 | Git has `20260813230000_game_phase0_contract.sql` (+ all its `game`/`game_private`/`game_assignment_*` objects); Production has neither | Frozen pre-P-1 draft migration, by design never pushed to Production | No | INTENTIONAL-ACCEPTED | None; re-confirm at next audit before this migration is ever approved |
| 2 | `_realtime`, `supabase_functions` schemas; `realtime.messages_*` constraints; `auth.idx_users_*` indexes (×4); `supabase_migrations.schema_migrations_idempotency_key_key`; `pg_net` extension-bootstrap conditional-logic text | Supabase platform/extension version differences between Production's historical provisioning and the `supabase/postgres:17`, `supabase/realtime:v2.124.4`, `supabase/gotrue:v2.195.0` etc. images the workflow pulls fresh in run 7 (see the earlier docker-pull log) | No — none of these are `public`/`private`/`game`/`game_private` objects, none are referenced by any tracked migration | INTENTIONAL-ACCEPTED / Supabase-managed system schema | None; expected whenever the CI stack's platform-image versions differ from Production's provisioning-time versions |
| 3 | `public.rls_auto_enable()` event-trigger function exists in Production, absent from replay | Supabase Dashboard project setting ("Automatically enable RLS for new tables"), not created by any migration (confirmed: zero matches for `rls_auto_enable` anywhere under `supabase/`) | No | INTENTIONAL-ACCEPTED / Supabase system feature | None; this is project configuration, not schema |
| 4 | Production has combined policies `profiles_select_self_or_own_students` and `students_select_self_or_own_teacher`; replay has `core_auth.sql`'s original split pairs (`profiles_select_self`+`profiles_select_own_students`, `students_select_self`+`students_select_own_teacher`) | `core_auth.sql` (migration 1, unchanged since) never combined these; migration 3's own comment (`20260810233828_vocabulary_rls_perf_fixes.sql:6`) says *"the same fix Phase 1 already applied to profiles (see profiles_select_self_or_own_students)"* — i.e. a pre-Git-history "Phase 1" consolidation reached Production but its migration file was never committed to this repo | **Yes** | FORWARD-FIX | New migration: `drop policy "profiles_select_self", "profiles_select_own_students" on public.profiles;` + `create policy "profiles_select_self_or_own_students" on public.profiles for select to authenticated using ((id = (select auth.uid())) or (role = 'student' and private.teacher_owns_student(id)));` and the equivalent pair for `students`/`students_select_self_or_own_teacher`, mirroring migration 3's already-established pattern exactly |
| 5 | `service_role`'s table grant on exactly `profiles`/`students`/`teachers`/`audit_log` (all four tables created by `core_auth.sql`, migration 1) differs: Production has `ALL` (profiles/students/teachers) or `SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN` (audit_log); replay has only the structural leftover `REFERENCES,TRIGGER,TRUNCATE,MAINTAIN` for all four. All other 33 `public`-schema tables (created by migrations 2-19) match exactly between Production and replay | No tracked migration grants or revokes anything to/from `service_role` on these 4 tables (confirmed: zero matches searching all 20 files) — root cause is either a platform-provisioning-timing artifact specific to the very first migration's tables, or an untracked manual Production grant; cannot be distinguished from read-only evidence alone | **Yes** | FORWARD-FIX | New migration: explicit `grant select, insert, update, delete on public.profiles, public.students, public.teachers to service_role;` and `grant select, insert on public.audit_log to service_role;`, matching this repo's own "nothing auto-grants, every grant explicit" convention instead of relying on whatever implicit default currently produces Production's state |
| 6 | `public.finalize_student_creation`: Production `RETURNS boolean` with a full rewritten body (per-failure-mode `return false` + logged `audit_log` row, no top-level `raise`) and `GRANT ALL ... TO service_role`; Git/replay still has `core_auth.sql`'s original `RETURNS void` body (`exception when others then` insert-then-`raise`, which per this project's own documented rule rolls back its own audit-log insert) with **no execute grant to any role at all** | Identical bug pattern to Failure 1 (`finalize_teacher_bootstrap`), and this repo's own `AGENTS.md` already documents `finalize_student_creation` as following the fixed return-boolean pattern — but unlike `finalize_teacher_bootstrap` (fixed in migration 11), no migration ever applied the equivalent fix for this sibling function | **Yes — highest severity** | FORWARD-FIX (urgent) | New migration, same shape as `20260811080227_allow_three_teacher_bootstrap.sql`: `drop function public.finalize_student_creation(uuid, text, text, uuid, uuid);` then recreate with `returns boolean`, `return false` + audit-log row for the `teacher_not_found` and `unique_violation` cases, `return true` on success, then `grant execute ... to service_role`. `app/actions/students.ts:94-102` calls this RPC via the service-role admin client and treats `!rpcOk` as failure — **on any environment built purely from this Git history, every "create student" attempt currently fails**, either with a permission-denied error (no grant exists at all) or a falsy `void` read as failure |

Findings 4-6 share one structural cause: they all trace to "Phase 1" — work applied to Production (or an earlier development phase) before this repository's Git-tracked migration history began, that a later migration explicitly references as already-applied (`profiles_select_self_or_own_students` named directly in migration 3's comment) but for which the corresponding migration file was never committed. Finding 6 is unambiguously the most severe: it is a live application-correctness bug in any fresh environment, not just a schema-comparison artifact, and is independently confirmed by reading the caller code.

**Zero UNKNOWN-classified differences remain.** Every `public`/`private`-schema line in all three diffs was attributed to one of findings 1-6 above; none were left unexplained.

## Forward-fix migrations for findings 4-6

Two new migrations, appended after the frozen game draft so its ordering and hash are untouched (verified: `git diff --stat -- supabase/migrations/20260813230000_game_phase0_contract.sql` is empty):

- **`20260815120000_core_auth_phase1_catchup_rls_and_grants.sql`** — closes findings 4 and 5. Drops `profiles_select_self`/`profiles_select_own_students`, creates `profiles_select_self_or_own_students`; drops `students_select_self`/`students_select_own_teacher`, creates `students_select_self_or_own_teacher`; grants `service_role` exactly the missing privileges on `profiles`/`students`/`teachers` (`select, insert, update, delete`) and `audit_log` (`select, insert` only, preserving its append-only design — no `update`/`delete` granted, matching Production exactly).
- **`20260815130000_finalize_student_creation_return_status.sql`** — closes finding 6. Drops the exact old `(uuid, text, text, uuid, uuid)` void overload, recreates it `returns boolean` with the per-failure-mode `return false` + logged `audit_log` row (mirrors migration 11's `finalize_teacher_bootstrap` fix shape), then `revoke ... from public` + `grant execute ... to service_role`.

**Verification performed without a live database** (this environment has no Docker, so CI is the only place these can actually replay):

- The function body in migration 22 was diffed line-for-line against `prod_project_schema.sql:1815-1848` (`diff` reported zero differences — byte-identical to Production's live, verified function).
- The two `USING` clauses in migration 21 were checked against Production's exact `CREATE POLICY` text (`prod_project_schema_with_acl.sql`); they match modulo pg_dump's automatic parenthesization/`::text` cast decoration, which is Postgres's own canonical redisplay of an identical expression, not a semantic difference — the same decoration core_auth.sql's own original (undecorated-source) policies would receive if dumped live.
- The four `grant` statements add exactly the privilege delta measured between Production and the run 7 replay (verified across all 37 `public`-schema tables, not just these 4, that the `REFERENCES,TRIGGER,TRUNCATE,MAINTAIN` baseline is otherwise identical everywhere) — nothing broader than that delta, no other role touched.
- `npm run audit:p1:git-migrations` passes (22 tracked migrations, all hashes verified fresh).
- `npm run typecheck` and `npm run build` both pass.
- `npm run lint` fails identically to every prior run in this audit — a pre-existing TypeScript 7.0 / `typescript-eslint` incompatibility unrelated to these files (see Local verification table).

**Not yet done, because it requires GitHub Actions** (no Docker locally): a from-zero CI replay of all 22 migrations, and a fresh Production-vs-replay four-way comparison against run 7's already-captured Production artifacts, to prove these two migrations actually make findings 4-6 disappear rather than just matching Production on paper. Until that CI run comes back clean, these three items stay open in the gate decision below.

## Handling Git-history-vs-Production-history drift going forward (no Production writes)

**A. How P-1 treats the Git-vs-Production migration-count gap without ever touching Production:** after these two migrations, Git will have 22 tracked migrations while Production's `supabase_migrations.schema_migrations` still only records 19. That 3-migration gap is not uniform — it splits into two categories with different endpoints, and P-1's job is to keep them administratively distinct rather than collapse them into one "expected gap" number:
  - `20260813230000_game_phase0_contract.sql` (draft #20) is meant to stay ahead of Production indefinitely, pending a separate game-schema approval process entirely outside P-1.
  - `20260815120000_*` and `20260815130000_*` (migrations #21-22) are meant to close the gap — the end state is Production actually running them, once a human explicitly authorizes and executes that deployment. P-1 itself never performs that deployment; it only proves the migrations are safe and reproduce Production's already-verified real behavior.

**B. What can be classified INTENTIONAL-ACCEPTED:** only the frozen game draft's absence from Production (and the already-covered Supabase-platform/system noise from findings 1-3). Migrations #21-22 being absent from Production must **not** be filed as INTENTIONAL-ACCEPTED — that label means "this difference is not supposed to close," and the whole point of these two migrations is that it should close. The correct interim label is **PENDING-DEPLOYMENT**: known, documented, forward-fix migrations awaiting a deliberate, separately authorized `db push` (or equivalent) that has not happened yet.

**C. Gate/allowlist adjustment vs. separate deployment approval:** do not add #21/#22 to any normalization rule or drift allowlist. Permanently allowlisting them would be functionally identical to declaring them INTENTIONAL-ACCEPTED, which contradicts (B). The correct next step, once CI replay confirms these two migrations reproduce Production's real state exactly, is a **separate, explicit, human-authorized deployment step** (`supabase db push` or the project's normal deploy path against Production) — outside P-1's own scope, since P-1 is read-only-audit-only by design and this agent has no authority to run write operations against Production regardless.

**D. Hard stop before any Production write:** confirmed — no Production DDL/DML has been run or will be run as part of this fix. Both new migrations exist only under `supabase/migrations/` and have only been verified against artifacts already downloaded from run 7 and typecheck/build locally. Applying them to Production requires the user's own explicit, separate go-ahead; this agent will not run `db push`, `migration repair`, or any other Production-write command without that explicit authorization at the time.

## Existing pre-P-1 game draft

`supabase/migrations/20260813230000_game_phase0_contract.sql` already existed in Git at the audit baseline. Its baseline SHA-256 was `6ae2f26913f750178179986193e53c505bc61d711ffefc1c5b09083529fbc798`. The P-1 replay ordering correction made after workflow run `31907092631` produced SHA-256 `25b9b759388b96529094a01c0aabd6cf983ce0c351b97c9bbc6c8268fe721adb` (moves a temporary schema privilege before ownership transfer, retains the final privilege revocation). The further correction made after workflow run `31907956628` has the current SHA-256 `d7870560aaa74a5a024fc77da4659da36b21eb7f798f587bc97e1f197120379b`; it unqualifies eight `pg_catalog.least`/`pg_catalog.greatest`/`pg_catalog.extract` call sites that are invalid PostgreSQL syntax for these SQL special forms (see `REPLAY_FAILURES.md` Failure 3). Workflow run `31908649338` verified this current SHA as part of the complete 20-migration replay.

This migration is a **pre-audit draft**, not an approved P-1 result. It adds `assignments.assignment_kind`, multiple game schemas/tables, functions, triggers, roles, policies, and grants. It does not create `game_unlock_requirements`, `game_assignment_versions`, or `get_game_access_status`, but it still represents unapproved game DDL.

Disposition:

- Do not edit, execute, push to staging, or apply this migration to Production during P-1.
- The isolated CI replay must include it because P-1 must prove that the complete Git history replays. CI replay is not authorization to deploy it.
- If Production does not contain this version or its objects, that difference remains an explicit Git/Production drift item until an owner decides whether to replace the draft with a forward-only correction, formally accept it, or otherwise reconcile history.
- Do not rewrite an already-applied migration. Any eventual repair must follow the repository's forward-migration policy after P-1 approval.

## Production safety boundary

The Production job is manual and uses the GitHub Environment `production-read-only-audit`. Before exporting anything it starts a read-only transaction and rejects a connection role that is elevated, can create objects, has table DML/DDL privileges, or can advance sequences. Every connection also sets `default_transaction_read_only=on`.

The job contains no `supabase link`, `db push`, `migration repair`, `CREATE`, `ALTER`, `DROP`, `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` operation against Production. Its only Production operations are catalog `SELECT`, `COPY ... TO STDOUT`/client-side `\copy`, and `pg_dump --schema-only`.

GitHub currently has the Environment `production-read-only-audit` and one Environment Secret named `PRODUCTION_DATABASE_READ_ONLY_URL`. Run 7 successfully connected read-only and exported all Production evidence; runs 5-6 failed on a connection-string formatting bug in the secret's `options=-c role=...` fragment, fixed by the user directly in the GitHub Environment (this agent never has secret read/write access).

All Production evidence listed in the inventory table above is now captured from run 7. Nothing is missing.

## Gate decision

The migration replay portion of P-1 was PASS as of run 7 (`baseline_status=0 replay_status=0 snapshot_status=0 history_status=0`, 20/20 migrations). Two new forward-fix migrations (#21-22) have since been written and locally verified byte-for-byte against Production's own dumps, but **have not yet been replayed by CI** — this environment has no Docker, so a from-zero `supabase db reset --local` replay of all 22 migrations, and a fresh comparison against run 7's Production artifacts, can only happen in GitHub Actions.

**P-1 does not yet PASS.** Remaining before it can:

1. Push these 22-migration commits and run the P-1 workflow fresh (not a rerun of an old commit) to prove all 22 migrations replay clean from zero.
2. Re-run the Production comparison using run 7's already-captured Production dumps (no new Production connection needed for this specific check, though the workflow will still make its own manual read-only Production run if `run_production_audit=true` is set) and confirm findings 4-6 are gone from `project-schema.diff` / `project-schema-with-acl.diff`, and that findings 1-3 are the only remaining differences.
3. Update this report and `REPLAY_FAILURES.md` with the actual run ID and result — this document's "Forward-fix migrations" section above records what was written and how it was verified locally, but the classification table's "FORWARD-FIX" entries for findings 4-6 stay open until that CI confirmation lands.

Until then:

- no new game migration may be created or executed;
- no existing draft migration may be pushed to staging or Production;
- no `game_unlock_requirements`, `game_assignment_versions`, or `get_game_access_status` database object may be created;
- no Production DDL/DML has been run, and none should be — migrations #21-22 target only `supabase/migrations/` and a future clean replay; deploying them to Production is a separate, explicit, human-authorized action outside P-1's own scope (see "Handling Git-history-vs-Production-history drift" above).

## Local verification

| Check | Result |
| --- | --- |
| `npm run audit:p1:git-migrations` | Pass; 22 tracked files and hashes match (20 original + 2 new forward-fix migrations) |
| Node syntax check for all P-1 `.mjs` scripts | Pass |
| Workflow YAML parse/Prettier check | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `npm run lint` | Blocked before file linting: the repository uses TypeScript 7.0 while the installed `typescript-eslint` reports that TS 7 is unsupported (unchanged from every earlier check in this audit) |
| Test command | Not available; `package.json` has no `test` script |
| CI replay of the 22-migration history | **Not yet run** — requires pushing and triggering GitHub Actions; this environment has no Docker |

The lint toolchain mismatch predates and is independent of these P-1 files. It was not repaired here because dependency changes are outside this database-audit scope.
