-- Phase 3 follow-up: expired-upload cleanup mechanism (Edge Function +
-- pg_cron/pg_net), not a plain SQL DELETE.
--
-- `delete from storage.objects` would only remove the metadata row -- the
-- underlying object bytes stay in the storage backend with no route left to
-- reach them, permanently orphaning more data than doing nothing at all.
-- Removal has to go through the Storage API's remove(), which requires the
-- service_role key. This project treats that as the third and last
-- exception to "utils/supabase/admin.ts is the only place service_role is
-- used" (see its updated module comment) -- the other two being genuine
-- Auth-admin operations and the pre-session bootstrap RPCs.
--
-- private.list_expired_upload_cleanup_candidates() finds two disjoint
-- categories: (a) upload_intents rows still 'pending' past their own
-- expires_at, and (b) truly orphaned storage.objects -- present in the
-- bucket, older than a 2-hour grace window, with no upload_intents row and
-- no *_files row referencing their storage_object_key at all. The 2-hour
-- window matters: it is longer than a signed upload URL's own ~2h validity
-- on Supabase's side, so this deliberately never targets an object whose
-- signed URL might still be legitimately in flight.
create function private.list_expired_upload_cleanup_candidates()
returns table (intent_id uuid, storage_object_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select ui.id, ui.storage_object_key
  from public.upload_intents ui
  where ui.status = 'pending' and ui.expires_at < now()

  union all

  select null::uuid, o.name
  from storage.objects o
  where o.bucket_id = 'attachments'
    and o.created_at < now() - interval '2 hours'
    and not exists (select 1 from public.upload_intents ui2 where ui2.storage_object_key = o.name)
    and not exists (select 1 from public.assignment_files f where f.storage_object_key = o.name)
    and not exists (select 1 from public.submission_files f where f.storage_object_key = o.name)
    and not exists (select 1 from public.audio_submission_files f where f.storage_object_key = o.name)
$$;

-- Called by the cleanup Edge Function only after the matching Storage
-- object has actually been removed via the Storage API's remove() -- see
-- supabase/functions/cleanup-expired-uploads/index.ts. Only ever clears
-- upload_intents bookkeeping; orphaned storage.objects rows (intent_id is
-- null candidates) have no corresponding DB row to clean up here at all.
create function public.purge_expired_upload_intents(p_intent_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.upload_intents where id = any (p_intent_ids) and status = 'pending';
$$;

revoke execute on function private.list_expired_upload_cleanup_candidates() from public;
revoke execute on function public.purge_expired_upload_intents(uuid[]) from public, anon;
grant execute on function private.list_expired_upload_cleanup_candidates() to service_role;
grant execute on function public.purge_expired_upload_intents(uuid[]) to service_role;

-- ============================================================================
-- pg_cron / pg_net: schedule the cleanup Edge Function every 15 minutes.
--
-- Operational note (runs once, by hand, outside this migration): the actual
-- service_role key must be stored via `select vault.create_secret(
-- '<the key>', 'edge_function_service_role_key');` run directly in the
-- Supabase SQL Editor -- never in a migration file, since migrations are
-- committed to git and a secret value must never enter version history.
-- This migration only ever references the secret by *name*
-- ('edge_function_service_role_key'); cron.schedule() itself contains no
-- secret material, so it is safe to commit.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'cleanup-expired-uploads',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://sdfmfcrkgsvqsvuhyfli.supabase.co/functions/v1/cleanup-expired-uploads',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
;
