# Frozen Supabase drafts

Files in this directory are preserved design/audit artifacts. They are not
active migrations, are not included in `docs/p1/git_migrations.csv`, and must
not be passed to `supabase db push`.

## `20260813230000_game_phase0_contract.sql`

- Status: frozen pre-P-1 Phase-0 game draft; not approved for deployment.
- Original active path: `supabase/migrations/20260813230000_game_phase0_contract.sql`.
- Archived path: `supabase/drafts/20260813230000_game_phase0_contract.sql`.
- Preserved SHA-256: `d7870560aaa74a5a024fc77da4659da36b21eb7f798f587bc97e1f197120379b`.
- Preserved byte length: 156,079.
- Last clean-replay evidence: workflow run `31915313767`, where the frozen
  draft was still migration 20 of 22. Replay success was syntax/order evidence,
  never deployment authorization.

Read-only shared-environment check on 2026-08-15:

- The Supabase account accessible to the CLI contained exactly two projects:
  `NingAcademy` and `NingAcademy-staging`.
- `NingAcademy` recorded 19 remote migrations ending at
  `20260813074607`; versions `20260813230000`, `20260815120000`, and
  `20260815130000` were absent. This independently matched the Production
  `db_migrations.csv` from run `31915313767`.
- `NingAcademy-staging` recorded zero remote migrations; all three versions
  were absent.
- The checks used `supabase migration list` only. No project was linked or
  relinked, and no `db push`, migration repair, DDL, or DML was executed.

Because version `20260813230000` was absent from every accessible shared
environment, its unchanged bytes were safely removed from the active migration
queue. If this draft is revived later, it requires a new post-P-1 design review
and a new deployable migration version; do not move this timestamped file back
into `supabase/migrations/`.
