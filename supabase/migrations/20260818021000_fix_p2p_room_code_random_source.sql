-- game_private.new_p2p_room_code() called the unqualified gen_random_bytes(6)
-- under `set search_path = ''`. gen_random_bytes() lives only in the
-- extensions schema, and game_api_owner (the function's owner, and the only
-- role ever granted EXECUTE on it) has no USAGE on that schema, so every
-- call has been failing in Production with "function gen_random_bytes
-- (integer) does not exist" -- surfaced to players as a 503 on
-- POST /api/p2p/rooms via create_p2p_room_v1. pg_catalog.gen_random_uuid()/
-- uuid_send() are core Postgres (not pgcrypto), already reachable under the
-- empty search_path, so this needs no new schema grants.
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
