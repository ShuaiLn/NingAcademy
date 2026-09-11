-- V2 keeps the reconnect/idempotency behavior of join_p2p_room_v1 while
-- admitting a brand-new assignment-eligible member to an already-running
-- room. The Games Host remains responsible for creating the gameplay entity
-- and sending a reliable authoritative world baseline.

create function game.join_p2p_room_v2(
  p_game_session_token text,
  p_request_id uuid,
  p_room_code text,
  p_protocol_version smallint
)
returns table (
  room_id uuid,
  normalized_room_code text,
  member_id uuid,
  host_member_id uuid,
  topology_epoch integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_room game_private.p2p_rooms;
  v_member game_private.p2p_members;
  v_context jsonb;
  v_code text := pg_catalog.upper(pg_catalog.btrim(p_room_code));
begin
  if p_request_id is null
     or v_code is null
     or v_code !~ '^[A-HJ-NP-Z2-9]{6}$'
     or p_protocol_version not between 1 and 32767 then
    raise exception 'invalid P2P room join request' using errcode = '22023';
  end if;

  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);

  select m.* into v_member
  from game_private.p2p_members m
  where m.join_request_id = p_request_id;
  if found then
    if v_member.game_auth_session_id is distinct from v_identity.auth_session_id then
      raise exception 'join request id belongs to another session' using errcode = '22000';
    end if;
    select r.* into v_room
    from game_private.p2p_rooms r
    where r.id = v_member.room_id;
    return query select v_room.id, v_room.room_code, v_member.id,
      v_room.host_member_id, v_room.topology_epoch, v_room.expires_at;
    return;
  end if;

  select r.* into v_room
  from game_private.p2p_rooms r
  where r.room_code = v_code
  for update;

  if not found
     or v_room.status = 'ended'
     or v_room.expires_at <= pg_catalog.now()
     or v_room.assignment_id is distinct from v_identity.bound_assignment_id
     or v_room.protocol_version <> p_protocol_version then
    raise exception 'P2P room is unavailable' using errcode = '28000';
  end if;

  perform game_private.expire_p2p_presence(v_room.id);
  select r.* into v_room
  from game_private.p2p_rooms r
  where r.id = v_room.id
  for update;

  select m.* into v_member
  from game_private.p2p_members m
  where m.room_id = v_room.id
    and m.user_id = v_identity.authenticated_user_id
    and m.left_at is null
  for update;

  if found then
    update game_private.game_auth_sessions gas
    set active_p2p_room_id = null
    where gas.id = v_member.game_auth_session_id
      and gas.id <> v_identity.auth_session_id
      and gas.active_p2p_room_id = v_room.id;

    update game_private.p2p_members m
    set game_auth_session_id = v_identity.auth_session_id,
        last_seen_at = pg_catalog.now(),
        disconnected_at = null,
        reconnect_until = pg_catalog.now() + interval '3 minutes'
    where m.id = v_member.id
    returning * into v_member;
  else
    if (
      select pg_catalog.count(*)
      from game_private.p2p_members m
      where m.room_id = v_room.id and m.left_at is null
    ) >= v_room.max_players then
      raise exception 'P2P room is full' using errcode = '54000';
    end if;

    v_context := game_private.build_launch_context(
      v_identity.authenticated_user_id,
      v_identity.bound_assignment_id
    );
    insert into game_private.p2p_members (
      room_id, game_auth_session_id, user_id, display_name, join_request_id
    ) values (
      v_room.id, v_identity.auth_session_id, v_identity.authenticated_user_id,
      v_context #>> '{profile,displayName}', p_request_id
    ) returning * into v_member;
  end if;

  update game_private.game_auth_sessions gas
  set active_p2p_room_id = v_room.id
  where gas.id = v_identity.auth_session_id;

  return query select v_room.id, v_room.room_code, v_member.id,
    v_room.host_member_id, v_room.topology_epoch, v_room.expires_at;
end;
$$;

alter function game.join_p2p_room_v2(text, uuid, text, smallint)
  owner to game_api_owner;

revoke execute on function game.join_p2p_room_v2(text, uuid, text, smallint)
  from public, anon, authenticated, service_role, game_server, games_api;
grant execute on function game.join_p2p_room_v2(text, uuid, text, smallint)
  to games_api;
