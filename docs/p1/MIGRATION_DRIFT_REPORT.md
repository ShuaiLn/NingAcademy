# P-1 Migration Drift Report

Status: **BLOCKED — evidence collection is incomplete; zero drift is not claimed**  
Audit date: 2026-08-15  
Repository: `NingAcademy`, branch `main`, baseline commit `b0cbc6fd01ea38e3abfcc9c62b75e0fdc5be0eef`

## Evidence inventory

| Evidence | State | Location |
| --- | --- | --- |
| Git migration history | Complete | `docs/p1/git_migrations.csv` |
| Production migration history | Pending dedicated read-only workflow run | artifact `production/db_migrations.csv` |
| Production schema | Pending dedicated read-only workflow run | artifact `production/prod_schema.sql` |
| Clean replay history | Pending GitHub Actions run | artifact `replay/replay_db_migrations.csv` |
| Clean replay schema | Pending GitHub Actions run | artifact `replay/replay_schema.sql` |
| Replay failure log | Pending GitHub Actions run | artifact `replay/replay.log` |

The Git inventory contains 20 tracked SQL migrations, ordered lexicographically by their 14-digit timestamp. Every row records the exact filename and SHA-256 of the raw file bytes. `npm run audit:p1:git-migrations` fails if that committed inventory becomes stale.

## Four-way comparison

| Comparison | Current result | P-1 disposition |
| --- | --- | --- |
| Git history vs Production history | Pending | Unresolved; blocks P-1 |
| Git history vs replay history | Pending | Unresolved; blocks P-1 |
| Production full schema vs replay full schema | Pending | Unresolved; blocks P-1 |
| Production project schemas vs replay project schemas | Pending | Unresolved; blocks P-1 |
| Production grants/ACL vs replay grants/ACL | Pending | Unresolved; blocks P-1 |

The workflow compares full schema dumps and separately compares `public`, `private`, `game`, and `game_private`. The second comparison isolates application-controlled objects. A third dump retains ACL statements so grants are not hidden by the canonical `--no-privileges` schema export.

## Existing pre-P-1 game draft

`supabase/migrations/20260813230000_game_phase0_contract.sql` already existed in Git at the audit baseline. Its SHA-256 is `6ae2f26913f750178179986193e53c505bc61d711ffefc1c5b09083529fbc798`.

This migration is a **pre-audit draft**, not an approved P-1 result. It adds `assignments.assignment_kind`, multiple game schemas/tables, functions, triggers, roles, policies, and grants. It does not create `game_unlock_requirements`, `game_assignment_versions`, or `get_game_access_status`, but it still represents unapproved game DDL.

Disposition:

- Do not edit, execute, push to staging, or apply this migration to Production during P-1.
- The isolated CI replay must include it because P-1 must prove that the complete Git history replays. CI replay is not authorization to deploy it.
- If Production does not contain this version or its objects, that difference remains an explicit Git/Production drift item until an owner decides whether to replace the draft with a forward-only correction, formally accept it, or otherwise reconcile history.
- Do not rewrite an already-applied migration. Any eventual repair must follow the repository's forward-migration policy after P-1 approval.

## Production safety boundary

The Production job is manual and uses the GitHub Environment `production-read-only-audit`. Before exporting anything it starts a read-only transaction and rejects a connection role that is elevated, can create objects, has table DML/DDL privileges, or can advance sequences. Every connection also sets `default_transaction_read_only=on`.

The job contains no `supabase link`, `db push`, `migration repair`, `CREATE`, `ALTER`, `DROP`, `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` operation against Production. Its only Production operations are catalog `SELECT`, `COPY ... TO STDOUT`/client-side `\copy`, and `pg_dump --schema-only`.

## Gate decision

P-1 currently fails the acceptance gate because Production and replay artifacts do not yet exist. Therefore:

- no new game migration may be created or executed;
- no existing draft migration may be pushed to staging or Production;
- no `game_unlock_requirements`, `game_assignment_versions`, or `get_game_access_status` database object may be created;
- the drift report must be updated from the workflow artifacts and every difference must receive an explicit resolution before P-1 can pass.

## Local verification

| Check | Result |
| --- | --- |
| `npm run audit:p1:git-migrations` | Pass; 20 tracked files and hashes match |
| Node syntax check for all P-1 `.mjs` scripts | Pass |
| Workflow YAML parse/Prettier check | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `npm run lint` | Blocked before file linting: the repository uses TypeScript 7.0 while the installed `typescript-eslint` reports that TS 7 is unsupported |
| Test command | Not available; `package.json` has no `test` script |

The lint toolchain mismatch predates and is independent of these P-1 files. It was not repaired here because dependency changes are outside this database-audit scope.
