# Retired unapplied Games migrations

The five SQL files in this directory were local-only NingAcademy Games
migrations and were never applied to Production. They were intentionally
retired from `supabase/migrations/` before the forward Games teardown.

They must not be moved back into the active migration queue or included in
future `db push` or Production replay expectations. They are preserved here
unchanged only as historical and audit evidence.
