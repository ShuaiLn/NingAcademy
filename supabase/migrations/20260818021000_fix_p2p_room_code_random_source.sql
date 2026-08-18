-- game_private.new_p2p_room_code() called the unqualified gen_random_bytes(6)
-- under `set search_path = ''`. gen_random_bytes() lives only in the
-- extensions schema, and game_api_owner (the function's owner, and the only
-- role ever granted EXECUTE on it) has no USAGE on that schema, so every
-- call has been failing in Production with "function gen_random_bytes
-- (integer) does not exist" -- surfaced to players as a 503 on
-- POST /api/p2p/rooms via create_p2p_room_v1. pg_catalog.gen_random_uuid()/
-- uuid_send() are core Postgres (not pgcrypto), already reachable under the
-- empty search_path, so this needs no new schema grants.
--
-- CREATE OR REPLACE runs under an explicit SET ROLE game_api_owner rather
-- than relying on the migration executor's own privileges, so this needs a
-- temporary, self-scoped membership grant -- same acquire/SET ROLE/revoke
-- pattern as 20260815200000_game_p2p_signaling.sql. GRANTED BY here matters:
-- it scopes the later revoke to only the grant edge this migration adds, so
-- it can never strip the executor's own pre-existing game_api_owner
-- membership.
do $grant_temporary_membership$
begin
  execute pg_catalog.format(
    'grant game_api_owner to %I granted by %I',
    current_user,
    current_user
  );
end
$grant_temporary_membership$;

set role game_api_owner;

create or replace function game_private.new_p2p_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
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
$$;

set role postgres;

do $drop_temporary_membership$
begin
  execute pg_catalog.format(
    'revoke game_api_owner from %I granted by %I',
    current_user,
    current_user
  );
end
$drop_temporary_membership$;
