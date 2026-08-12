-- Phase 3 follow-up: advisor fixes surfaced immediately after applying the
-- two migrations above (same "fix before it's ever wrong in prod" spirit as
-- 20260810233759_vocabulary_rls_perf_fixes.sql).
--
-- pg_net installed into the public schema by default (no explicit schema
-- clause on its CREATE EXTENSION) -- the security advisor flags any
-- extension in public since it pollutes that schema's namespace and is
-- reachable by anything with USAGE on public. pg_net is not relocatable
-- (ALTER EXTENSION ... SET SCHEMA is rejected), so the only way to move its
-- catalog association is drop + recreate with an explicit schema. This is
-- safe here: nothing has an SQL-level dependency on the pg_net extension
-- object itself (the cron job below only calls net.http_post() by name at
-- runtime), and per Supabase's own pg_net docs, the extension always
-- creates its actual working objects in its own hardcoded `net` schema
-- regardless of which schema the extension itself is associated with --
-- net.http_post() stays callable exactly the same way after this.
drop extension if exists pg_net;
create extension pg_net with schema extensions;

-- Two FK-covering indexes the performance advisor flagged as missing.
create index attempt_counters_student_id_idx on private.attempt_counters (student_id);
create index upload_intents_task_word_id_idx on public.upload_intents (task_word_id);
;
