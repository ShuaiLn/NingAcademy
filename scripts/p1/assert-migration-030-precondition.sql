\set ON_ERROR_STOP on

-- supabase/migrations/20260818021000_fix_p2p_room_code_random_source.sql is
-- the sole migration approved-pending-migrations.mjs currently lets this
-- audit tolerate Production lacking (see compare-migration-history.mjs's
-- --allow-declared-pending mode). That exemption is only sound if Production
-- is actually still in the exact pre-migration-30 state the migration was
-- authored and read-only-preflighted against. This asserts that directly,
-- rather than relying solely on the general schema diff to notice: the
-- function must still be defined with `set search_path = ''` calling the
-- unqualified `gen_random_bytes(6)` (confirmed live 2026-08-17, reproduced
-- exactly below via pg_get_functiondef, which is fully deterministic for a
-- given catalog state), and must still be owned by game_api_owner. Any
-- deviation -- migration 30 already applied out of band, the function
-- edited some other way, or an owner change -- fails this audit closed.

begin transaction read only;

select pg_catalog.to_regprocedure('game_private.new_p2p_room_code()') is not null
  as function_exists
\gset
\if :function_exists
\else
  \echo 'Refusing Production audit: game_private.new_p2p_room_code() does not exist.'
  do $$ begin raise exception 'Refusing Production audit: game_private.new_p2p_room_code() does not exist.' using errcode = 'P0001'; end; $$;
\endif

select pg_catalog.pg_get_functiondef('game_private.new_p2p_room_code()'::pg_catalog.regprocedure) = $expected_def$CREATE OR REPLACE FUNCTION game_private.new_p2p_room_code()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := gen_random_bytes(6);
  v_code text := '';
  v_index integer;
begin
  for v_index in 0..5 loop
    v_code := v_code || pg_catalog.substr(
      v_alphabet,
      (pg_catalog.get_byte(v_bytes, v_index) % pg_catalog.char_length(v_alphabet)) + 1,
      1
    );
  end loop;
  return v_code;
end;
$function$
$expected_def$ as definition_matches_pre_migration_30_state
\gset
\if :definition_matches_pre_migration_30_state
\else
  \echo 'Refusing Production audit: game_private.new_p2p_room_code() no longer matches the expected pre-migration-30 definition -- either migration 30 was already applied out of band, or the function changed some other way. Re-run the read-only preflight and update this script (and approved-pending-migrations.mjs) before trusting the pending exemption again.'
  do $$ begin raise exception 'Refusing Production audit: game_private.new_p2p_room_code() no longer matches the expected pre-migration-30 definition.' using errcode = 'P0001'; end; $$;
\endif

select pg_catalog.pg_get_userbyid(proowner) = 'game_api_owner' as owner_matches
from pg_catalog.pg_proc
where oid = pg_catalog.to_regprocedure('game_private.new_p2p_room_code()')
\gset
\if :owner_matches
\else
  \echo 'Refusing Production audit: game_private.new_p2p_room_code() owner is not game_api_owner.'
  do $$ begin raise exception 'Refusing Production audit: game_private.new_p2p_room_code() owner is not game_api_owner.' using errcode = 'P0001'; end; $$;
\endif

select current_database() as audited_database,
       'game_private.new_p2p_room_code()'::text as target_function,
       'precondition holds: pre-migration-30 definition and owner confirmed'::text as result;

commit;
