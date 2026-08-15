# P-1 Replay Failures

Status: **NOT YET EXECUTED — zero replay failures is not claimed**  
Audit date: 2026-08-15

## Current result

No local replay was attempted. Docker is intentionally not required on the developer machine, and neither Docker nor a global PostgreSQL client is available in the current environment. The isolated GitHub Actions workflow has been prepared but cannot produce a run artifact until these audit-only changes are committed and the workflow runs.

| Check | Result |
| --- | --- |
| Tracked migration inventory regeneration | Pass: 20 files match `git_migrations.csv` |
| Empty Supabase baseline startup | Not run |
| `supabase db reset --local --no-seed --debug` | Not run |
| Replay migration-history comparison | Not run |
| Replay schema export | Not run |
| Replay failures | Unknown; **not zero** until proved by CI |

## CI replay contract

`.github/workflows/p1-database-audit.yml` performs these operations in an ephemeral Ubuntu runner:

1. Pins Supabase CLI `2.114.0` and verifies `git_migrations.csv`.
2. Temporarily removes project migrations, starts a blank local Supabase stack, and restores the files.
3. Runs every tracked migration from zero using `supabase db reset --local --no-seed --debug`.
4. Preserves the complete command stream in `replay/replay.log`, including the failing migration and CLI diagnostics.
5. Exports the resulting full and project-only schemas even when replay stops partway through.
6. Exports `supabase_migrations.schema_migrations` and compares it with the Git inventory.
7. Uploads the evidence before failing the job.

Artifact name: `p1-migration-replay-<run_id>`  
Retention: 14 days

Required files include:

- `replay.log`
- `baseline-start.log`
- `replay_schema.sql`
- `replay_project_schema.sql`
- `replay_project_schema_with_acl.sql`
- `replay_db_migrations.csv`
- `git-vs-replay-migrations.md`
- numeric status files for startup, replay, snapshot, and history comparison

`supabase/config.toml` enables a seed path, but the repository currently has no tracked `supabase/seed.sql`. The workflow creates an empty seed only for blank-stack startup and uses `--no-seed` for the migration replay, so seed state cannot mask a migration failure.

## Failure classification to apply after the first run

Every nonzero replay event must be copied here with the migration version, failing statement/function, exact PostgreSQL error, root cause, and forward-only resolution. At minimum, review the rev2.1 risk classes:

- malformed `RAISE` statements or format-argument mismatches;
- parameter/column ambiguity, requiring `p_` parameters and qualified column references;
- functions missing a deliberate `SET search_path`;
- undeclared object-order dependencies;
- partial replay history where the log and `schema_migrations` stop at different versions;
- the pre-P-1 game draft and any dependency it assumes.

No failure may be silently waived. A fixed replay must be rerun from zero, and this document must retain the original failure plus its resolution.

## Gate decision

P-1 replay acceptance is blocked until a CI artifact proves all of the following in the same run:

- baseline startup exit code `0`;
- replay exit code `0`;
- schema/history export exit code `0`;
- Git vs replay migration history result `MATCH`;
- this report is updated with either “no failures observed” or a complete list of resolved failures.

