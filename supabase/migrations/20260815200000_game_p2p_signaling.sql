-- Host-authoritative WebRTC P2P signaling contract.
--
-- The browser never receives a database credential and never calls these
-- functions directly. game.ningacademy.org validates the opaque Games session
-- cookie and invokes this allowlist through a restricted games_api LOGIN member.
-- The shared Production Supabase stores only room membership, short-lived
-- signaling messages, and the latest host checkpoint; it does not simulate the
-- game world or relay RTCDataChannel traffic.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'games_api') then
    create role games_api nologin noinherit nobypassrls;
  else
    alter role games_api nologin noinherit nobypassrls;
  end if;

  execute pg_catalog.format('grant game_api_owner to %I', current_user);
end
$roles$;

set role game_api_owner;

create table game_private.p2p_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  assignment_id uuid not null references public.assignments (id) on delete restrict,
  create_request_id uuid not null unique,
  host_member_id uuid,
  status text not null default 'lobby',
  max_players smallint not null default 8,
  protocol_version smallint not null,
  ruleset_version text not null,
  topology_epoch integer not null default 1,
  checkpoint_sequence bigint not null default 0,
  checkpoint_payload jsonb,
  checkpoint_saved_at timestamptz,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  ended_at timestamptz,
  end_reason text,
  purge_after timestamptz not null default (now() + interval '26 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint p2p_rooms_code_format check (room_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  constraint p2p_rooms_status check (status in ('lobby', 'running', 'ended')),
  constraint p2p_rooms_capacity check (max_players between 2 and 8),
  constraint p2p_rooms_protocol check (protocol_version between 1 and 32767),
  constraint p2p_rooms_ruleset check (
    char_length(ruleset_version) between 1 and 64
    and ruleset_version ~ '^[A-Za-z0-9._-]+$'
  ),
  constraint p2p_rooms_topology_epoch check (topology_epoch > 0),
  constraint p2p_rooms_checkpoint_sequence check (checkpoint_sequence >= 0),
  constraint p2p_rooms_checkpoint_state check (
    (checkpoint_payload is null and checkpoint_sequence = 0 and checkpoint_saved_at is null)
    or (
      checkpoint_payload is not null
      and jsonb_typeof(checkpoint_payload) = 'object'
      and checkpoint_sequence > 0
      and checkpoint_saved_at is not null
      and pg_column_size(checkpoint_payload) <= 524288
      and not game_private.jsonb_has_sensitive_key(checkpoint_payload)
    )
  ),
  constraint p2p_rooms_expiry check (
    expires_at > created_at
    and expires_at <= created_at + interval '2 hours'
    and purge_after >= expires_at + interval '1 hour'
  ),
  constraint p2p_rooms_end_state check (
    (status <> 'ended' and ended_at is null and end_reason is null)
    or (
      status = 'ended'
      and ended_at is not null
      and end_reason in ('host_ended', 'empty', 'expired', 'host_migration_failed')
    )
  )
);

create index p2p_rooms_active_expiry_idx
  on game_private.p2p_rooms (expires_at, id)
  where status <> 'ended';

create index p2p_rooms_purge_idx
  on game_private.p2p_rooms (purge_after, id)
  where status = 'ended';

create table game_private.p2p_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references game_private.p2p_rooms (id) on delete cascade,
  game_auth_session_id uuid not null
    references game_private.game_auth_sessions (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  display_name text not null,
  join_request_id uuid not null unique,
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disconnected_at timestamptz,
  reconnect_until timestamptz not null default (now() + interval '3 minutes'),
  left_at timestamptz,
  constraint p2p_members_display_name check (
    char_length(btrim(display_name)) between 1 and 80
  ),
  constraint p2p_members_timing check (
    last_seen_at >= joined_at
    and reconnect_until >= last_seen_at
    and (disconnected_at is null or disconnected_at >= joined_at)
    and (left_at is null or left_at >= joined_at)
  )
);

alter table game_private.p2p_rooms
  add constraint p2p_rooms_host_member_fk
  foreign key (host_member_id) references game_private.p2p_members (id)
  on delete restrict deferrable initially deferred;

create unique index p2p_members_active_user_idx
  on game_private.p2p_members (room_id, user_id)
  where left_at is null;

create unique index p2p_members_active_auth_session_idx
  on game_private.p2p_members (game_auth_session_id)
  where left_at is null;

create index p2p_members_room_presence_idx
  on game_private.p2p_members (room_id, left_at, disconnected_at, joined_at, id);

create table game_private.p2p_signals (
  id bigint generated always as identity primary key,
  room_id uuid not null references game_private.p2p_rooms (id) on delete cascade,
  topology_epoch integer not null,
  sender_member_id uuid not null references game_private.p2p_members (id) on delete cascade,
  target_member_id uuid not null references game_private.p2p_members (id) on delete cascade,
  client_signal_id uuid not null,
  signal_type text not null,
  signal_payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  unique (sender_member_id, client_signal_id),
  constraint p2p_signals_distinct_members check (sender_member_id <> target_member_id),
  constraint p2p_signals_topology_epoch check (topology_epoch > 0),
  constraint p2p_signals_type check (signal_type in ('offer', 'answer', 'ice')),
  constraint p2p_signals_payload check (
    jsonb_typeof(signal_payload) = 'object'
    and pg_column_size(signal_payload) <= 65536
    and not game_private.jsonb_has_sensitive_key(signal_payload)
  ),
  constraint p2p_signals_expiry check (
    expires_at > created_at
    and expires_at <= created_at + interval '2 minutes'
  )
);

create index p2p_signals_target_poll_idx
  on game_private.p2p_signals (target_member_id, id);

create index p2p_signals_expiry_idx
  on game_private.p2p_signals (expires_at, id);

alter table game_private.game_auth_sessions
  add column active_p2p_room_id uuid
  references game_private.p2p_rooms (id) on delete set null;

create index game_auth_sessions_active_p2p_room_idx
  on game_private.game_auth_sessions (active_p2p_room_id)
  where active_p2p_room_id is not null;

revoke all on game_private.p2p_rooms, game_private.p2p_members,
  game_private.p2p_signals from public, anon, authenticated, service_role,
  game_server, games_api;

create function game_private.new_p2p_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
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
$$;

create function game_private.expire_p2p_presence(p_room_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_room game_private.p2p_rooms;
  v_next_host uuid;
begin
  select r.* into v_room
  from game_private.p2p_rooms r
  where r.id = p_room_id
  for update;

  if not found or v_room.status = 'ended' then
    return;
  end if;

  update game_private.p2p_members m
  set disconnected_at = coalesce(m.disconnected_at, pg_catalog.now())
  where m.room_id = p_room_id
    and m.left_at is null
    and m.disconnected_at is null
    and m.last_seen_at < pg_catalog.now() - interval '12 seconds';

  update game_private.p2p_members m
  set left_at = pg_catalog.now(), ready = false
  where m.room_id = p_room_id
    and m.left_at is null
    and m.disconnected_at is not null
    and m.reconnect_until <= pg_catalog.now();

  if v_room.expires_at <= pg_catalog.now() then
    update game_private.p2p_rooms r
    set status = 'ended', ended_at = pg_catalog.now(), end_reason = 'expired',
        updated_at = pg_catalog.now()
    where r.id = p_room_id and r.status <> 'ended';
    update game_private.game_auth_sessions gas
    set active_p2p_room_id = null
    where gas.active_p2p_room_id = p_room_id;
    return;
  end if;

  if not exists (
    select 1
    from game_private.p2p_members host
    where host.id = v_room.host_member_id
      and host.room_id = p_room_id
      and host.left_at is null
      and host.disconnected_at is null
  ) then
    select m.id into v_next_host
    from game_private.p2p_members m
    where m.room_id = p_room_id
      and m.left_at is null
      and m.disconnected_at is null
    order by m.joined_at, m.id
    limit 1;

    if v_next_host is null then
      if not exists (
        select 1 from game_private.p2p_members m
        where m.room_id = p_room_id and m.left_at is null
      ) then
        update game_private.p2p_rooms r
        set status = 'ended', host_member_id = null,
            ended_at = pg_catalog.now(), end_reason = 'empty',
            updated_at = pg_catalog.now()
        where r.id = p_room_id;
        update game_private.game_auth_sessions gas
        set active_p2p_room_id = null
        where gas.active_p2p_room_id = p_room_id;
      end if;
    else
      update game_private.p2p_rooms r
      set host_member_id = v_next_host,
          topology_epoch = r.topology_epoch + 1,
          updated_at = pg_catalog.now()
      where r.id = p_room_id;

      delete from game_private.p2p_signals s
      where s.room_id = p_room_id;
    end if;
  end if;
end;
$$;

create function game_private.p2p_members_payload(p_room_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'memberId', m.id,
      'displayName', m.display_name,
      'ready', m.ready,
      'connected', m.disconnected_at is null,
      'joinedAt', m.joined_at,
      'reconnectUntil', m.reconnect_until
    ) order by m.joined_at, m.id
  ), '[]'::jsonb)
  from game_private.p2p_members m
  where m.room_id = p_room_id
    and m.left_at is null
$$;

create function game_private.require_p2p_member(
  p_game_session_token text,
  p_room_id uuid
)
returns table (
  auth_session_id uuid,
  authenticated_user_id uuid,
  assignment_id uuid,
  member_id uuid,
  force_exit_at timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  v_identity record;
  v_member game_private.p2p_members;
begin
  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);

  select m.* into v_member
  from game_private.p2p_members m
  where m.room_id = p_room_id
    and m.game_auth_session_id = v_identity.auth_session_id
    and m.user_id = v_identity.authenticated_user_id
    and m.left_at is null
  for update;

  if not found or v_member.reconnect_until <= pg_catalog.now() then
    raise exception 'active P2P room membership is required' using errcode = '28000';
  end if;

  return query select
    v_identity.auth_session_id,
    v_identity.authenticated_user_id,
    v_identity.bound_assignment_id,
    v_member.id,
    v_identity.force_exit_at;
end;
$$;

create function game.create_p2p_room_v1(
  p_game_session_token text,
  p_request_id uuid,
  p_max_players smallint,
  p_protocol_version smallint,
  p_ruleset_version text
)
returns table (
  room_id uuid,
  room_code text,
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
  v_existing game_private.p2p_rooms;
  v_room game_private.p2p_rooms;
  v_member game_private.p2p_members;
  v_context jsonb;
  v_code text;
  v_attempt integer;
begin
  if p_request_id is null
     or p_max_players not between 2 and 8
     or p_protocol_version not between 1 and 32767
     or p_ruleset_version is null
     or p_ruleset_version !~ '^[A-Za-z0-9._-]{1,64}$' then
    raise exception 'invalid P2P room creation request' using errcode = '22023';
  end if;

  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);

  if v_identity.bound_assignment_id is null then
    raise exception 'an assignment-bound game session is required' using errcode = '28000';
  end if;

  select r.* into v_existing
  from game_private.p2p_rooms r
  where r.create_request_id = p_request_id;

  if found then
    select m.* into v_member
    from game_private.p2p_members m
    where m.room_id = v_existing.id
      and m.game_auth_session_id = v_identity.auth_session_id
      and m.left_at is null;
    if not found then
      raise exception 'room request id belongs to another session' using errcode = '22000';
    end if;
    return query select v_existing.id, v_existing.room_code, v_member.id,
      v_existing.host_member_id, v_existing.topology_epoch, v_existing.expires_at;
    return;
  end if;

  if exists (
    select 1
    from game_private.game_auth_sessions gas
    join game_private.p2p_rooms r on r.id = gas.active_p2p_room_id
    where gas.id = v_identity.auth_session_id and r.status <> 'ended'
  ) then
    raise exception 'the game session is already in an active P2P room' using errcode = '22000';
  end if;

  v_context := game_private.build_launch_context(
    v_identity.authenticated_user_id,
    v_identity.bound_assignment_id
  );

  for v_attempt in 1..32 loop
    v_code := game_private.new_p2p_room_code();
    begin
      insert into game_private.p2p_rooms (
        room_code, assignment_id, create_request_id, max_players,
        protocol_version, ruleset_version
      ) values (
        v_code, v_identity.bound_assignment_id, p_request_id, p_max_players,
        p_protocol_version, p_ruleset_version
      ) returning * into v_room;
      exit;
    exception when unique_violation then
      if v_attempt = 32 then
        raise exception 'unable to allocate a unique room code' using errcode = '54000';
      end if;
    end;
  end loop;

  insert into game_private.p2p_members (
    room_id, game_auth_session_id, user_id, display_name, join_request_id
  ) values (
    v_room.id,
    v_identity.auth_session_id,
    v_identity.authenticated_user_id,
    v_context #>> '{profile,displayName}',
    p_request_id
  ) returning * into v_member;

  update game_private.p2p_rooms r
  set host_member_id = v_member.id, updated_at = pg_catalog.now()
  where r.id = v_room.id
  returning * into v_room;

  update game_private.game_auth_sessions gas
  set active_p2p_room_id = v_room.id
  where gas.id = v_identity.auth_session_id;

  return query select v_room.id, v_room.room_code, v_member.id,
    v_room.host_member_id, v_room.topology_epoch, v_room.expires_at;
end;
$$;

create function game.join_p2p_room_v1(
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
    select r.* into v_room from game_private.p2p_rooms r where r.id = v_member.room_id;
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
  select r.* into v_room from game_private.p2p_rooms r where r.id = v_room.id for update;

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
        last_seen_at = pg_catalog.now(), disconnected_at = null,
        reconnect_until = pg_catalog.now() + interval '3 minutes'
    where m.id = v_member.id
    returning * into v_member;
  else
    if v_room.status <> 'lobby' then
      raise exception 'new players may only join a lobby' using errcode = '28000';
    end if;
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

create function game.poll_p2p_room_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_after_signal_id bigint default 0
)
returns table (
  room_id uuid,
  room_code text,
  member_id uuid,
  host_member_id uuid,
  room_status text,
  max_players smallint,
  topology_epoch integer,
  members jsonb,
  signals jsonb,
  checkpoint_sequence bigint,
  checkpoint_payload jsonb,
  force_exit_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
  v_room game_private.p2p_rooms;
  v_signals jsonb;
begin
  if p_after_signal_id < 0 then
    raise exception 'invalid signaling cursor' using errcode = '22023';
  end if;

  select * into v_membership
  from game_private.require_p2p_member(p_game_session_token, p_room_id);

  update game_private.p2p_members m
  set last_seen_at = pg_catalog.now(), disconnected_at = null,
      reconnect_until = pg_catalog.now() + interval '3 minutes'
  where m.id = v_membership.member_id;

  perform game_private.expire_p2p_presence(p_room_id);

  delete from game_private.p2p_signals s
  where s.room_id = p_room_id and s.expires_at <= pg_catalog.now();

  select r.* into v_room
  from game_private.p2p_rooms r
  where r.id = p_room_id;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', s.id,
      'topologyEpoch', s.topology_epoch,
      'senderMemberId', s.sender_member_id,
      'type', s.signal_type,
      'payload', s.signal_payload
    ) order by s.id
  ), '[]'::jsonb) into v_signals
  from (
    select queued.*
    from game_private.p2p_signals queued
    where queued.target_member_id = v_membership.member_id
      and queued.id > p_after_signal_id
      and queued.expires_at > pg_catalog.now()
    order by queued.id
    limit 128
  ) s;

  return query select
    v_room.id,
    v_room.room_code,
    v_membership.member_id,
    v_room.host_member_id,
    v_room.status,
    v_room.max_players,
    v_room.topology_epoch,
    game_private.p2p_members_payload(v_room.id),
    v_signals,
    v_room.checkpoint_sequence,
    v_room.checkpoint_payload,
    v_membership.force_exit_at,
    v_room.expires_at;
end;
$$;

create function game.send_p2p_signal_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_target_member_id uuid,
  p_client_signal_id uuid,
  p_topology_epoch integer,
  p_signal_type text,
  p_signal_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
  v_room game_private.p2p_rooms;
  v_signal_id bigint;
begin
  if p_target_member_id is null
     or p_client_signal_id is null
     or p_topology_epoch <= 0
     or p_signal_type not in ('offer', 'answer', 'ice')
     or p_signal_payload is null
     or pg_catalog.jsonb_typeof(p_signal_payload) <> 'object'
     or pg_column_size(p_signal_payload) > 65536
     or game_private.jsonb_has_sensitive_key(p_signal_payload) then
    raise exception 'invalid P2P signal' using errcode = '22023';
  end if;

  select * into v_membership
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  perform game_private.expire_p2p_presence(p_room_id);

  select r.* into v_room
  from game_private.p2p_rooms r
  where r.id = p_room_id
  for update;

  if v_room.status = 'ended'
     or v_room.topology_epoch <> p_topology_epoch
     or not exists (
       select 1 from game_private.p2p_members target
       where target.id = p_target_member_id
         and target.room_id = p_room_id
         and target.left_at is null
         and target.disconnected_at is null
     )
     or not (
       v_membership.member_id = v_room.host_member_id
       or p_target_member_id = v_room.host_member_id
     ) then
    raise exception 'signal violates the current star topology' using errcode = '28000';
  end if;

  insert into game_private.p2p_signals (
    room_id, topology_epoch, sender_member_id, target_member_id,
    client_signal_id, signal_type, signal_payload
  ) values (
    p_room_id, p_topology_epoch, v_membership.member_id, p_target_member_id,
    p_client_signal_id, p_signal_type, p_signal_payload
  )
  on conflict (sender_member_id, client_signal_id) do update
  set client_signal_id = excluded.client_signal_id
  returning id into v_signal_id;

  return v_signal_id;
end;
$$;

create function game.set_p2p_ready_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_ready boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
begin
  select * into v_membership
  from game_private.require_p2p_member(p_game_session_token, p_room_id);

  if not exists (
    select 1 from game_private.p2p_rooms r
    where r.id = p_room_id and r.status = 'lobby'
  ) then
    raise exception 'readiness may only change in a lobby' using errcode = '22000';
  end if;

  update game_private.p2p_members m
  set ready = p_ready, last_seen_at = pg_catalog.now(), disconnected_at = null,
      reconnect_until = pg_catalog.now() + interval '3 minutes'
  where m.id = v_membership.member_id;
end;
$$;

create function game.start_p2p_room_v1(
  p_game_session_token text,
  p_room_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
  v_room game_private.p2p_rooms;
  v_connected_count integer;
begin
  select * into v_membership
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  perform game_private.expire_p2p_presence(p_room_id);

  select r.* into v_room
  from game_private.p2p_rooms r where r.id = p_room_id for update;
  if v_room.status <> 'lobby' or v_room.host_member_id <> v_membership.member_id then
    raise exception 'only the current host may start a lobby' using errcode = '28000';
  end if;

  select pg_catalog.count(*) into v_connected_count
  from game_private.p2p_members m
  where m.room_id = p_room_id
    and m.left_at is null
    and m.disconnected_at is null;

  if v_connected_count < 2 or exists (
    select 1 from game_private.p2p_members m
    where m.room_id = p_room_id
      and m.left_at is null
      and m.disconnected_at is null
      and not m.ready
  ) then
    raise exception 'two or more connected ready players are required' using errcode = '22000';
  end if;

  update game_private.p2p_rooms r
  set status = 'running', updated_at = pg_catalog.now()
  where r.id = p_room_id;
end;
$$;

create function game.save_p2p_checkpoint_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_topology_epoch integer,
  p_checkpoint_sequence bigint,
  p_checkpoint_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
  v_room game_private.p2p_rooms;
begin
  if p_checkpoint_sequence <= 0
     or p_checkpoint_payload is null
     or pg_catalog.jsonb_typeof(p_checkpoint_payload) <> 'object'
     or pg_column_size(p_checkpoint_payload) > 524288
     or game_private.jsonb_has_sensitive_key(p_checkpoint_payload) then
    raise exception 'invalid P2P checkpoint' using errcode = '22023';
  end if;

  select * into v_membership
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  select r.* into v_room
  from game_private.p2p_rooms r where r.id = p_room_id for update;

  if v_room.status <> 'running'
     or v_room.host_member_id <> v_membership.member_id
     or v_room.topology_epoch <> p_topology_epoch then
    raise exception 'only the current host may save a checkpoint' using errcode = '28000';
  end if;

  if p_checkpoint_sequence <= v_room.checkpoint_sequence then
    return;
  end if;

  update game_private.p2p_rooms r
  set checkpoint_sequence = p_checkpoint_sequence,
      checkpoint_payload = p_checkpoint_payload,
      checkpoint_saved_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where r.id = p_room_id;
end;
$$;

create function game.leave_p2p_room_v1(
  p_game_session_token text,
  p_room_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
begin
  select * into v_membership
  from game_private.require_p2p_member(p_game_session_token, p_room_id);

  update game_private.p2p_members m
  set left_at = pg_catalog.now(), ready = false,
      disconnected_at = coalesce(m.disconnected_at, pg_catalog.now())
  where m.id = v_membership.member_id;

  update game_private.game_auth_sessions gas
  set active_p2p_room_id = null
  where gas.id = v_membership.auth_session_id
    and gas.active_p2p_room_id = p_room_id;

  perform game_private.expire_p2p_presence(p_room_id);
end;
$$;

create function game.end_p2p_room_v1(
  p_game_session_token text,
  p_room_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
  v_room game_private.p2p_rooms;
begin
  select * into v_membership
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  select r.* into v_room
  from game_private.p2p_rooms r where r.id = p_room_id for update;

  if v_room.host_member_id <> v_membership.member_id then
    raise exception 'only the current host may end the room' using errcode = '28000';
  end if;

  update game_private.p2p_rooms r
  set status = 'ended', ended_at = pg_catalog.now(), end_reason = 'host_ended',
      updated_at = pg_catalog.now()
  where r.id = p_room_id and r.status <> 'ended';

  update game_private.p2p_members m
  set left_at = coalesce(m.left_at, pg_catalog.now()), ready = false
  where m.room_id = p_room_id;

  update game_private.game_auth_sessions gas
  set active_p2p_room_id = null
  where gas.active_p2p_room_id = p_room_id;
end;
$$;

create function game.cleanup_p2p_data_v1(
  p_before timestamptz,
  p_limit integer default 1000
)
returns table (
  signals_deleted integer,
  rooms_expired integer,
  rooms_deleted integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signals integer := 0;
  v_expired integer := 0;
  v_rooms integer := 0;
begin
  if p_before is null
     or p_before > pg_catalog.now()
     or p_limit not between 1 and 10000 then
    raise exception 'invalid P2P cleanup request' using errcode = '22023';
  end if;

  with selected as (
    select s.id from game_private.p2p_signals s
    where s.expires_at <= p_before
    order by s.expires_at, s.id
    limit p_limit
    for update skip locked
  ), deleted as (
    delete from game_private.p2p_signals s
    using selected where s.id = selected.id returning s.id
  ) select pg_catalog.count(*)::integer into v_signals from deleted;

  with expired as (
    select r.id from game_private.p2p_rooms r
    where r.status <> 'ended' and r.expires_at <= p_before
    order by r.expires_at, r.id
    limit p_limit
    for update skip locked
  ), updated as (
    update game_private.p2p_rooms r
    set status = 'ended', ended_at = pg_catalog.now(), end_reason = 'expired',
        updated_at = pg_catalog.now()
    from expired where r.id = expired.id returning r.id
  ) select pg_catalog.count(*)::integer into v_expired from updated;

  update game_private.game_auth_sessions gas
  set active_p2p_room_id = null
  where exists (
    select 1 from game_private.p2p_rooms r
    where r.id = gas.active_p2p_room_id and r.status = 'ended'
  );

  with selected as (
    select r.id from game_private.p2p_rooms r
    where r.status = 'ended' and r.purge_after <= p_before
    order by r.purge_after, r.id
    limit p_limit
    for update skip locked
  ), deleted as (
    delete from game_private.p2p_rooms r
    using selected where r.id = selected.id returning r.id
  ) select pg_catalog.count(*)::integer into v_rooms from deleted;

  return query select v_signals, v_expired, v_rooms;
end;
$$;

do $ownership$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('game', 'game_private')
      and p.proname in (
        'new_p2p_room_code',
        'expire_p2p_presence',
        'p2p_members_payload',
        'require_p2p_member',
        'create_p2p_room_v1',
        'join_p2p_room_v1',
        'poll_p2p_room_v1',
        'send_p2p_signal_v1',
        'set_p2p_ready_v1',
        'start_p2p_room_v1',
        'save_p2p_checkpoint_v1',
        'leave_p2p_room_v1',
        'end_p2p_room_v1',
        'cleanup_p2p_data_v1'
      )
  loop
    execute pg_catalog.format('alter function %s owner to game_api_owner', v_function);
  end loop;
end
$ownership$;

revoke execute on all functions in schema game, game_private
  from public, anon, authenticated, service_role, game_server, games_api;
revoke usage on schema game from public, anon, authenticated, service_role, game_server;
grant usage on schema game to games_api;

do $runtime_grants$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'game'
      and p.proname in (
        'redeem_game_launch_ticket_v1',
        'validate_game_session_v2',
        'authorize_game_join_v1',
        'freeze_question_v1',
        'submit_game_answer_v1',
        'void_learning_attempt_v1',
        'record_domain_event_v1',
        'finalize_game_attempt_v1',
        'save_session_checkpoint_v1',
        'leave_game_session_v1',
        'end_game_session_v1',
        'create_p2p_room_v1',
        'join_p2p_room_v1',
        'poll_p2p_room_v1',
        'send_p2p_signal_v1',
        'set_p2p_ready_v1',
        'start_p2p_room_v1',
        'save_p2p_checkpoint_v1',
        'leave_p2p_room_v1',
        'end_p2p_room_v1',
        'cleanup_p2p_data_v1'
      )
  loop
    execute pg_catalog.format('grant execute on function %s to games_api', v_function);
  end loop;
end
$runtime_grants$;

alter default privileges for role game_api_owner in schema game
  revoke execute on functions from public;
alter default privileges for role game_api_owner in schema game_private
  revoke execute on functions from public;
alter default privileges for role game_api_owner in schema game
  revoke all on tables from public, anon, authenticated, service_role,
  game_server, games_api;
alter default privileges for role game_api_owner in schema game_private
  revoke all on tables from public, anon, authenticated, service_role,
  game_server, games_api;

reset role;

do $drop_temporary_membership$
begin
  execute pg_catalog.format('revoke game_api_owner from %I', current_user);
end
$drop_temporary_membership$;
