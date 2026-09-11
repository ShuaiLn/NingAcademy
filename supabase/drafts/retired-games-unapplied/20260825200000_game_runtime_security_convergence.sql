-- Forward-only security convergence after migrations 31-34.
--
-- This migration does not repair the earlier migrations' executor-role
-- assumptions: a from-zero replay must still be able to apply every preceding
-- file on its own. It hardens the final state once that queue has applied by:
--   * enabling RLS explicitly on every table added by migrations 32-33;
--   * projecting a peer checkpoint fail closed even when the learning shape is
--     malformed;
--   * giving listening authorization and consumption one lock order; and
--   * rebuilding the games_api EXECUTE surface from exact signatures so stale
--     V1/prompt-capable/unprojected RPCs are no longer callable at runtime.

do $roles$
begin
  execute pg_catalog.format(
    'grant game_api_owner to %I granted by %I',
    current_user,
    current_user
  );
end
$roles$;

set role game_api_owner;

alter table game_private.p2p_attempt_requirements enable row level security;
alter table game_private.p2p_question_bindings enable row level security;
alter table game_private.p2p_run_results enable row level security;
alter table game_private.listening_content_releases enable row level security;
alter table game_private.listening_audio_assets enable row level security;
alter table game_private.listening_audio_deliveries enable row level security;
alter table game_private.listening_audio_accesses enable row level security;

-- Peers receive exactly their own academic branch. Rebuild the learning object
-- from an allowlist instead of modifying it only when the Host checkpoint has
-- the expected shape; malformed/missing learning data must not return the
-- unprojected room checkpoint.
create function game.poll_p2p_room_v3(
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
  v_poll record;
  v_checkpoint jsonb;
  v_own_learning jsonb;
  v_learning_revision jsonb;
begin
  select * into v_poll
  from game.poll_p2p_room_v1(
    p_game_session_token,
    p_room_id,
    p_after_signal_id
  );

  v_checkpoint := v_poll.checkpoint_payload;
  if v_checkpoint is not null
     and v_poll.member_id is distinct from v_poll.host_member_id then
    if pg_catalog.jsonb_typeof(v_checkpoint) <> 'object' then
      v_checkpoint := null;
    else
      v_own_learning := case
        when pg_catalog.jsonb_typeof(v_checkpoint #> '{learning,players}') = 'object'
          then v_checkpoint #> array['learning', 'players', v_poll.member_id::text]
        else null
      end;
      v_learning_revision := case
        when pg_catalog.jsonb_typeof(v_checkpoint #> '{learning,revision}') = 'number'
          then v_checkpoint #> '{learning,revision}'
        else '0'::jsonb
      end;
      v_checkpoint := pg_catalog.jsonb_set(
        v_checkpoint,
        '{learning}',
        pg_catalog.jsonb_build_object(
          'configuration', null,
          'players', case when v_own_learning is null then '{}'::jsonb
            else pg_catalog.jsonb_build_object(v_poll.member_id::text, v_own_learning)
          end,
          'revision', v_learning_revision
        ),
        true
      );
    end if;
  end if;

  return query select
    v_poll.room_id,
    v_poll.room_code,
    v_poll.member_id,
    v_poll.host_member_id,
    v_poll.room_status,
    v_poll.max_players,
    v_poll.topology_epoch,
    v_poll.members,
    v_poll.signals,
    v_poll.checkpoint_sequence,
    v_checkpoint,
    v_poll.force_exit_at,
    v_poll.expires_at;
end;
$$;

-- Lock order for both authorization and consumption is now:
-- question_instances -> listening_audio_accesses -> listening_audio_deliveries.
-- authorize_p2p_listening_audio_v2 already locks the question first. The V1
-- consumer locked access/delivery before question and could deadlock against a
-- concurrent authorization that refreshed the same delivery row.
create function game.consume_p2p_listening_delivery_v2(
  p_game_session_token text,
  p_room_id uuid,
  p_delivery_id uuid,
  p_question_instance_id uuid,
  p_grant_request_id uuid,
  p_question_revision integer,
  p_session_binding text,
  p_member_binding text,
  p_attempt_binding text
)
returns table (
  object_key text,
  mime_type text,
  content_sha256 text,
  byte_length integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
  v_access game_private.listening_audio_accesses;
  v_delivery game_private.listening_audio_deliveries;
  v_binding game_private.p2p_question_bindings;
  v_question game_private.question_instances;
  v_asset game_private.listening_audio_assets;
begin
  if p_game_session_token is null
     or p_room_id is null
     or p_delivery_id is null
     or p_question_instance_id is null
     or p_grant_request_id is null
     or p_question_revision is null or p_question_revision < 1
     or p_session_binding is null or p_session_binding !~ '^[A-Za-z0-9_-]{43}$'
     or p_member_binding is null or p_member_binding !~ '^[A-Za-z0-9_-]{43}$'
     or p_attempt_binding is null or p_attempt_binding !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'malformed listening delivery claim' using errcode = '22023';
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

  select a.* into v_access
  from game_private.listening_audio_accesses a
  where a.question_instance_id = p_question_instance_id
    and a.request_id = p_grant_request_id
  for update;

  select d.* into v_delivery
  from game_private.listening_audio_deliveries d
  where d.id = p_delivery_id
  for update;

  if v_binding.question_instance_id is null
     or v_access.id is null
     or not v_access.allowed
     or v_access.delivery_id is distinct from p_delivery_id
     or v_access.game_auth_session_id <> v_member.game_auth_session_id
     or v_access.fetched_at is not null
     or v_delivery.id is null
     or v_delivery.room_id <> p_room_id
     or v_delivery.member_id <> v_member.member_id
     or v_delivery.game_auth_session_id <> v_member.game_auth_session_id
     or v_delivery.question_instance_id <> p_question_instance_id
     or v_delivery.expires_at <= pg_catalog.now()
     or v_question.question_type <> 'listening_spelling'
     or v_question.answer_mode <> 'standard'
     or v_question.listening_audio_asset_id <> v_delivery.audio_asset_id
     or exists (
       select 1 from game.learning_attempts la
       where la.question_instance_id = p_question_instance_id
     )
     or p_session_binding <> game_private.base64url(game_private.sha256_text(
       v_member.game_auth_session_id::text || p_delivery_id::text
     ))
     or p_member_binding <> game_private.base64url(game_private.sha256_text(
       v_member.member_id::text || p_delivery_id::text
     ))
     or p_attempt_binding <> game_private.base64url(game_private.sha256_text(
       v_binding.game_attempt_id::text || p_delivery_id::text
     )) then
    raise exception 'listening delivery claim is invalid, consumed, expired, or not owner-bound'
      using errcode = '42501';
  end if;

  select a.* into v_asset
  from game_private.listening_audio_assets a
  where a.id = v_delivery.audio_asset_id
    and a.retired_at is null
    and a.provisioned_at is not null;
  if not found then
    raise exception 'listening asset is unavailable' using errcode = '42501';
  end if;

  update game_private.listening_audio_accesses a
  set fetched_at = pg_catalog.now()
  where a.id = v_access.id;

  return query select
    v_asset.object_key,
    v_asset.mime_type,
    pg_catalog.encode(v_asset.content_sha256, 'hex'),
    v_asset.byte_length;
end;
$$;

-- Revoke first, then grant exact regprocedure signatures. This removes the
-- legacy unprojected poll, V1 academic/listening siblings, unused generic
-- academic mutators, and cleanup surface from the runtime role.
revoke execute on all functions in schema game, game_private
  from public, anon, authenticated, service_role, game_server, games_api;
revoke usage on schema game from public, anon, authenticated, service_role, game_server;
revoke usage on schema game_private
  from public, anon, authenticated, service_role, game_server, games_api;
grant usage on schema game to games_api;

revoke all privileges on all tables in schema game, game_private
  from public, anon, authenticated, service_role, game_server, games_api;
revoke all privileges on all sequences in schema game, game_private
  from public, anon, authenticated, service_role, game_server, games_api;

do $runtime_grants$
declare
  v_signature text;
  v_function regprocedure;
  v_signatures constant text[] := array[
    'game.redeem_game_launch_ticket_v1(text,uuid)',
    'game.validate_game_session_v2(text)',
    'game.create_p2p_room_v1(text,uuid,smallint,smallint,text)',
    'game.join_p2p_room_v2(text,uuid,text,smallint)',
    'game.poll_p2p_room_v3(text,uuid,bigint)',
    'game.send_p2p_signal_v1(text,uuid,uuid,uuid,integer,text,jsonb)',
    'game.set_p2p_ready_v1(text,uuid,boolean)',
    'game.start_p2p_room_v1(text,uuid)',
    'game.save_p2p_checkpoint_v1(text,uuid,integer,bigint,jsonb)',
    'game.leave_p2p_room_v1(text,uuid)',
    'game.end_p2p_room_v1(text,uuid)',
    'game.get_p2p_assignment_requirements_v2(text,uuid,uuid)',
    'game.freeze_p2p_question_v2(text,uuid,uuid,integer,uuid,text,text,integer,integer,integer)',
    'game.verify_p2p_frozen_question_metadata_v1(text,uuid,uuid,text,uuid,uuid,integer)',
    'game.authorize_p2p_listening_audio_v2(text,uuid,uuid,integer,uuid)',
    'game.consume_p2p_listening_delivery_v2(text,uuid,uuid,uuid,uuid,integer,text,text,text)',
    'game.submit_p2p_answer_v1(text,uuid,uuid,integer,text,uuid,integer,uuid,text)',
    'game.verify_p2p_answer_settlement_v1(text,uuid,uuid,text,uuid,integer,uuid,uuid)',
    'game.expire_p2p_question_v1(text,uuid,uuid,text,uuid,integer,uuid)',
    'game.record_p2p_run_result_v1(text,uuid,uuid,integer,bigint)',
    'game.finalize_p2p_attempt_v1(text,uuid,uuid,integer,uuid)',
    'game.verify_p2p_attempt_finalization_v1(text,uuid,uuid,uuid,uuid)'
  ];
begin
  foreach v_signature in array v_signatures loop
    v_function := pg_catalog.to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'required Games runtime RPC is missing: %', v_signature;
    end if;
    execute pg_catalog.format('grant execute on function %s to games_api', v_function);
  end loop;
end
$runtime_grants$;

alter default privileges for role game_api_owner
  revoke execute on functions from public;
alter default privileges for role game_api_owner in schema game
  revoke all on tables from public, anon, authenticated, service_role,
  game_server, games_api;
alter default privileges for role game_api_owner in schema game_private
  revoke all on tables from public, anon, authenticated, service_role,
  game_server, games_api;
alter default privileges for role game_api_owner in schema game
  revoke all on sequences from public, anon, authenticated, service_role,
  game_server, games_api;
alter default privileges for role game_api_owner in schema game_private
  revoke all on sequences from public, anon, authenticated, service_role,
  game_server, games_api;

reset role;

do $drop_temporary_membership$
begin
  execute pg_catalog.format(
    'revoke game_api_owner from %I granted by %I',
    current_user,
    current_user
  );
end
$drop_temporary_membership$;
