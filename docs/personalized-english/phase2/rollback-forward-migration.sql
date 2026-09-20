-- TEMPLATE ONLY: do not apply from this path. After a deployed Phase 2
-- rollback is authorized, generate a new timestamped Supabase migration and
-- copy this statement into it. Data and schema remain compatible for recovery.
revoke execute on function public.upsert_personal_words_bulk_v1(uuid, jsonb)
  from authenticated;

comment on function public.upsert_personal_words_bulk_v1(uuid, jsonb) is
  'Phase 2 data retained; authenticated execution disabled by an authorized forward rollback migration.';
