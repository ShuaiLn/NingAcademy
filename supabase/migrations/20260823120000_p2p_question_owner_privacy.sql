-- Owner-only P2P prompt privacy.
--
-- Migration 32 correctly kept expected answers private, but its Host proof RPC
-- returned the owner's sanitized prompt. This forward-only sibling exposes
-- only the immutable identity/timing metadata needed by Host authority. The
-- owning member continues to receive its prompt from freeze_p2p_question_v1
-- under that member's own game-session credential.

create function game.verify_p2p_frozen_question_metadata_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_target_member_id uuid,
  p_node_id text,
  p_question_instance_id uuid,
  p_issue_request_id uuid,
  p_question_revision integer
)
returns table (
  question_instance_id uuid,
  question_type text,
  timed boolean,
  timeout_ms integer,
  expires_at timestamptz,
  counts_for_assignment boolean,
  question_revision integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_room game_private.p2p_rooms;
begin
  select * into v_caller
  from game_private.require_p2p_member(p_game_session_token, p_room_id);

  select r.* into v_room
  from game_private.p2p_rooms r
  where r.id = p_room_id;

  if p_target_member_id <> v_caller.member_id
     and v_room.host_member_id is distinct from v_caller.member_id then
    raise exception 'only the current Host may verify a peer frozen question'
      using errcode = '42501';
  end if;

  return query
  select qi.id, qi.question_type, qi.timed, qi.timeout_ms, qi.expires_at,
    qi.counts_for_assignment, b.question_revision
  from game_private.p2p_question_bindings b
  join game_private.question_instances qi on qi.id = b.question_instance_id
  where b.room_id = p_room_id
    and b.member_id = p_target_member_id
    and b.node_id = p_node_id
    and b.question_instance_id = p_question_instance_id
    and b.issue_request_id = p_issue_request_id
    and b.question_revision = p_question_revision;

  if not found then
    raise exception 'frozen Question metadata proof is invalid' using errcode = '42501';
  end if;
end;
$$;

do $ownership_and_grants$
declare
  v_function regprocedure;
  v_prompt_function regprocedure;
begin
  v_function := pg_catalog.to_regprocedure(
    'game.verify_p2p_frozen_question_metadata_v1(text,uuid,uuid,text,uuid,uuid,integer)'
  );

  if v_function is null then
    raise exception 'owner-only frozen question metadata function is missing';
  end if;

  execute pg_catalog.format('alter function %s owner to game_api_owner', v_function);
  execute pg_catalog.format(
    'revoke execute on function %s from public, anon, authenticated, service_role, game_server, games_api',
    v_function
  );
  execute pg_catalog.format('grant execute on function %s to games_api', v_function);

  v_prompt_function := pg_catalog.to_regprocedure(
    'game.verify_p2p_frozen_question_v1(text,uuid,uuid,text,uuid,uuid,integer)'
  );

  if v_prompt_function is null then
    raise exception 'legacy prompt-bearing frozen question verifier is missing';
  end if;

  execute pg_catalog.format(
    'revoke execute on function %s from public, anon, authenticated, service_role, game_server, games_api',
    v_prompt_function
  );
end
$ownership_and_grants$;

-- --------------------------------------------------------------------------
-- Trusted listening delivery foundation
-- --------------------------------------------------------------------------
-- Assets are deliberately unprovisioned by this migration. Once a release is
-- provisioned, the trigger derives its opaque object key from a private,
-- release-rotated salt. Browser authorization returns only a delivery id and
-- session-binding digest; object keys and salts never cross the RPC boundary.

create extension if not exists pgcrypto with schema extensions;

create function game_private.base32_no_padding(p_value bytea)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_alphabet constant text := 'abcdefghijklmnopqrstuvwxyz234567';
  v_bits integer := 0;
  v_buffer bigint := 0;
  v_index integer;
  v_output text := '';
begin
  for v_index in 0..pg_catalog.length(p_value) - 1 loop
    v_buffer := (v_buffer << 8) | pg_catalog.get_byte(p_value, v_index);
    v_bits := v_bits + 8;
    while v_bits >= 5 loop
      v_output := v_output || pg_catalog.substr(
        v_alphabet,
        (((v_buffer >> (v_bits - 5)) & 31)::integer) + 1,
        1
      );
      v_bits := v_bits - 5;
    end loop;
    if v_bits = 0 then
      v_buffer := 0;
    else
      v_buffer := v_buffer & ((1::bigint << v_bits) - 1);
    end if;
  end loop;
  if v_bits > 0 then
    v_output := v_output || pg_catalog.substr(
      v_alphabet,
      (((v_buffer << (5 - v_bits)) & 31)::integer) + 1,
      1
    );
  end if;
  return v_output;
end;
$$;

create table game_private.listening_content_releases (
  content_release_id text primary key,
  content_release_salt bytea not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint listening_content_release_id_format check (
    content_release_id ~ '^[A-Za-z0-9._-]{1,128}$'
  ),
  constraint listening_content_release_salt_length check (
    octet_length(content_release_salt) = 32
  ),
  constraint listening_content_release_retired_after_creation check (
    retired_at is null or retired_at >= created_at
  )
);

create table game_private.listening_audio_assets (
  id uuid primary key default gen_random_uuid(),
  content_release_id text not null
    references game_private.listening_content_releases (content_release_id)
    on delete restrict,
  source_word_id uuid not null references public.vocabulary_words (id) on delete restrict,
  voice_id text not null,
  variant smallint not null,
  object_key text not null unique,
  mime_type text not null default 'audio/ogg',
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  unique (content_release_id, source_word_id, voice_id, variant),
  constraint listening_audio_voice_id_format check (voice_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  constraint listening_audio_variant_range check (variant between 1 and 3),
  constraint listening_audio_object_key_format check (object_key ~ '^[a-z2-7]{32}$'),
  constraint listening_audio_mime_type check (mime_type = 'audio/ogg'),
  constraint listening_audio_retired_after_creation check (
    retired_at is null or retired_at >= created_at
  )
);

create function game_private.derive_listening_audio_object_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salt bytea;
begin
  select r.content_release_salt into v_salt
  from game_private.listening_content_releases r
  where r.content_release_id = new.content_release_id
    and r.retired_at is null;

  if not found then
    raise exception 'active listening content release is unavailable' using errcode = '42501';
  end if;

  new.object_key := pg_catalog.substr(game_private.base32_no_padding(
    extensions.hmac(
      pg_catalog.convert_to(
        new.source_word_id::text || new.voice_id || new.variant::text,
        'UTF8'
      ),
      v_salt,
      'sha256'
    )
  ), 1, 32);
  return new;
end;
$$;

create trigger listening_audio_assets_derive_object_key
before insert or update of content_release_id, source_word_id, voice_id, variant
on game_private.listening_audio_assets
for each row execute function game_private.derive_listening_audio_object_key();

create table game_private.listening_audio_deliveries (
  id uuid primary key default gen_random_uuid(),
  question_instance_id uuid not null
    references game_private.question_instances (id) on delete cascade,
  room_id uuid not null references game_private.p2p_rooms (id) on delete cascade,
  member_id uuid not null references game_private.p2p_members (id) on delete cascade,
  game_auth_session_id uuid not null
    references game_private.game_auth_sessions (id) on delete cascade,
  audio_asset_id uuid not null
    references game_private.listening_audio_assets (id) on delete restrict,
  expires_at timestamptz not null,
  retention_until timestamptz not null default (now() + interval '30 days'),
  personal_data_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (question_instance_id, game_auth_session_id),
  constraint listening_audio_delivery_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '90 seconds'
  )
);

create table game_private.listening_audio_accesses (
  id bigint generated always as identity primary key,
  question_instance_id uuid not null
    references game_private.question_instances (id) on delete cascade,
  delivery_id uuid references game_private.listening_audio_deliveries (id) on delete cascade,
  game_auth_session_id uuid not null
    references game_private.game_auth_sessions (id) on delete cascade,
  request_id uuid not null,
  allowed boolean not null,
  denial_reason text,
  requested_at timestamptz not null default now(),
  retention_until timestamptz not null default (now() + interval '30 days'),
  personal_data_deleted_at timestamptz,
  unique (question_instance_id, request_id),
  constraint listening_audio_access_reason check (
    (allowed and denial_reason is null and delivery_id is not null)
    or (not allowed and denial_reason in ('asset_unavailable', 'expired', 'request_limit', 'settled'))
  )
);

create index listening_audio_access_question_idx
  on game_private.listening_audio_accesses (question_instance_id, requested_at);
create index listening_audio_delivery_retention_idx
  on game_private.listening_audio_deliveries (retention_until)
  where personal_data_deleted_at is null;
create index listening_audio_access_retention_idx
  on game_private.listening_audio_accesses (retention_until)
  where personal_data_deleted_at is null;

create function game.authorize_p2p_listening_audio_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_question_instance_id uuid,
  p_question_revision integer,
  p_request_id uuid
)
returns table (
  authorized boolean,
  denial_reason text,
  delivery_id uuid,
  session_binding text,
  expires_at timestamptz,
  request_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
  v_question game_private.question_instances;
  v_binding game_private.p2p_question_bindings;
  v_session game_private.game_auth_sessions;
  v_room game_private.p2p_rooms;
  v_game_session game.game_sessions;
  v_asset game_private.listening_audio_assets;
  v_delivery game_private.listening_audio_deliveries;
  v_access game_private.listening_audio_accesses;
  v_allowed_count integer;
  v_expires_at timestamptz;
  v_settled boolean;
begin
  if p_question_instance_id is null
     or p_question_revision is null
     or p_question_revision < 1
     or p_request_id is null then
    raise exception 'listening authorization ids are required' using errcode = '22023';
  end if;

  select * into v_member
  from game_private.require_p2p_member(p_game_session_token, p_room_id);

  select b, qi into v_binding, v_question
  from game_private.p2p_question_bindings b
  join game_private.question_instances qi on qi.id = b.question_instance_id
  where b.room_id = p_room_id
    and b.member_id = v_member.member_id
    and b.question_instance_id = p_question_instance_id
    and b.question_revision = p_question_revision
  for update of qi;

  if not found or v_question.question_type <> 'listening_spelling' then
    raise exception 'listening question is not owned by this room member' using errcode = '42501';
  end if;

  select gas.* into v_session
  from game_private.game_auth_sessions gas
  where gas.id = v_member.game_auth_session_id;
  select r.* into v_room from game_private.p2p_rooms r where r.id = p_room_id;
  select gs.* into v_game_session
  from game.game_attempts ga
  join game.session_players sp on sp.id = ga.session_player_id
  join game.game_sessions gs on gs.id = sp.game_session_id
  where ga.id = v_binding.game_attempt_id;

  select a.* into v_access
  from game_private.listening_audio_accesses a
  where a.question_instance_id = p_question_instance_id
    and a.request_id = p_request_id;

  select pg_catalog.count(*)::integer into v_allowed_count
  from game_private.listening_audio_accesses a
  where a.question_instance_id = p_question_instance_id and a.allowed;

  select exists(
    select 1 from game.learning_attempts la
    where la.question_instance_id = p_question_instance_id
  ) into v_settled;

  if v_settled then
    if v_access.id is null then
      insert into game_private.listening_audio_accesses (
        question_instance_id, game_auth_session_id, request_id, allowed, denial_reason
      ) values (
        p_question_instance_id, v_member.game_auth_session_id, p_request_id, false, 'settled'
      );
    end if;
    return query select false, 'settled'::text, null::uuid, null::text,
      null::timestamptz, v_allowed_count;
    return;
  end if;

  if v_access.id is not null then
    if v_access.game_auth_session_id <> v_member.game_auth_session_id then
      raise exception 'listening request id belongs to another session' using errcode = '42501';
    end if;
    if v_access.allowed then
      select d.* into v_delivery
      from game_private.listening_audio_deliveries d where d.id = v_access.delivery_id;
    end if;
    return query select v_access.allowed, v_access.denial_reason, v_delivery.id,
      case when v_delivery.id is null then null else game_private.base64url(
        game_private.sha256_text(v_member.game_auth_session_id::text || v_delivery.id::text)
      ) end,
      v_delivery.expires_at, v_allowed_count;
    return;
  end if;

  if v_allowed_count >= 3 then
    insert into game_private.listening_audio_accesses (
      question_instance_id, game_auth_session_id, request_id, allowed, denial_reason
    ) values (
      p_question_instance_id, v_member.game_auth_session_id, p_request_id, false, 'request_limit'
    );
    return query select false, 'request_limit'::text, null::uuid, null::text,
      null::timestamptz, v_allowed_count;
    return;
  end if;

  v_expires_at := least(
    pg_catalog.now() + interval '90 seconds',
    v_session.expires_at,
    v_room.expires_at,
    coalesce(v_question.expires_at, pg_catalog.now() + interval '90 seconds')
  );

  if v_expires_at <= pg_catalog.now() then
    insert into game_private.listening_audio_accesses (
      question_instance_id, game_auth_session_id, request_id, allowed, denial_reason
    ) values (
      p_question_instance_id, v_member.game_auth_session_id, p_request_id, false, 'expired'
    );
    return query select false, 'expired'::text, null::uuid, null::text,
      null::timestamptz, v_allowed_count;
    return;
  end if;

  select a.* into v_asset
  from game_private.listening_audio_assets a
  join game_private.listening_content_releases r
    on r.content_release_id = a.content_release_id and r.retired_at is null
  where a.content_release_id = v_game_session.content_release_id
    and a.source_word_id = v_question.source_word_id
    and a.retired_at is null
  order by pg_catalog.md5(p_question_instance_id::text || a.id::text), a.variant, a.id
  limit 1;

  if not found then
    insert into game_private.listening_audio_accesses (
      question_instance_id, game_auth_session_id, request_id, allowed, denial_reason
    ) values (
      p_question_instance_id, v_member.game_auth_session_id, p_request_id,
      false, 'asset_unavailable'
    );
    return query select false, 'asset_unavailable'::text, null::uuid, null::text,
      null::timestamptz, v_allowed_count;
    return;
  end if;

  insert into game_private.listening_audio_deliveries (
    question_instance_id, room_id, member_id, game_auth_session_id,
    audio_asset_id, expires_at
  ) values (
    p_question_instance_id, p_room_id, v_member.member_id,
    v_member.game_auth_session_id, v_asset.id, v_expires_at
  )
  on conflict (question_instance_id, game_auth_session_id)
  do update set
    audio_asset_id = excluded.audio_asset_id,
    expires_at = excluded.expires_at
  returning * into v_delivery;

  insert into game_private.listening_audio_accesses (
    question_instance_id, delivery_id, game_auth_session_id,
    request_id, allowed
  ) values (
    p_question_instance_id, v_delivery.id, v_member.game_auth_session_id,
    p_request_id, true
  );
  v_allowed_count := v_allowed_count + 1;

  return query select true, null::text, v_delivery.id,
    game_private.base64url(game_private.sha256_text(
      v_member.game_auth_session_id::text || v_delivery.id::text
    )),
    v_delivery.expires_at, v_allowed_count;
end;
$$;

do $listening_ownership_and_grants$
declare
  v_function regprocedure;
  v_table regclass;
begin
  foreach v_table in array array[
    'game_private.listening_content_releases'::regclass,
    'game_private.listening_audio_assets'::regclass,
    'game_private.listening_audio_deliveries'::regclass,
    'game_private.listening_audio_accesses'::regclass
  ] loop
    execute pg_catalog.format('alter table %s owner to game_api_owner', v_table);
    execute pg_catalog.format(
      'revoke all privileges on table %s from public, anon, authenticated, service_role, game_server, games_api',
      v_table
    );
  end loop;

  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('game', 'game_private')
      and p.proname in (
        'base32_no_padding',
        'derive_listening_audio_object_key',
        'authorize_p2p_listening_audio_v1'
      )
  loop
    execute pg_catalog.format('alter function %s owner to game_api_owner', v_function);
    execute pg_catalog.format(
      'revoke execute on function %s from public, anon, authenticated, service_role, game_server, games_api',
      v_function
    );
    if v_function = 'game.authorize_p2p_listening_audio_v1(text,uuid,uuid,integer,uuid)'::regprocedure then
      execute pg_catalog.format('grant execute on function %s to games_api', v_function);
    end if;
  end loop;
end
$listening_ownership_and_grants$;
