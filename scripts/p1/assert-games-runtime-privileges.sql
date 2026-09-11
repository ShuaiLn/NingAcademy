\set ON_ERROR_STOP on

-- Catalog assertion for the post-migration-35 Games runtime boundary. This is
-- read-only: it inspects role/object metadata and raises on any mismatch.
do $audit$
declare
  v_expected constant text[] := array[
    'game.authorize_p2p_listening_audio_v2(text,uuid,uuid,integer,uuid)',
    'game.consume_p2p_listening_delivery_v2(text,uuid,uuid,uuid,uuid,integer,text,text,text)',
    'game.create_p2p_room_v1(text,uuid,smallint,smallint,text)',
    'game.end_p2p_room_v1(text,uuid)',
    'game.expire_p2p_question_v1(text,uuid,uuid,text,uuid,integer,uuid)',
    'game.finalize_p2p_attempt_v1(text,uuid,uuid,integer,uuid)',
    'game.freeze_p2p_question_v2(text,uuid,uuid,integer,uuid,text,text,integer,integer,integer)',
    'game.get_p2p_assignment_requirements_v2(text,uuid,uuid)',
    'game.join_p2p_room_v2(text,uuid,text,smallint)',
    'game.leave_p2p_room_v1(text,uuid)',
    'game.poll_p2p_room_v3(text,uuid,bigint)',
    'game.record_p2p_run_result_v1(text,uuid,uuid,integer,bigint)',
    'game.redeem_game_launch_ticket_v1(text,uuid)',
    'game.save_p2p_checkpoint_v1(text,uuid,integer,bigint,jsonb)',
    'game.send_p2p_signal_v1(text,uuid,uuid,uuid,integer,text,jsonb)',
    'game.set_p2p_ready_v1(text,uuid,boolean)',
    'game.start_p2p_room_v1(text,uuid)',
    'game.submit_p2p_answer_v1(text,uuid,uuid,integer,text,uuid,integer,uuid,text)',
    'game.validate_game_session_v2(text)',
    'game.verify_p2p_answer_settlement_v1(text,uuid,uuid,text,uuid,integer,uuid,uuid)',
    'game.verify_p2p_attempt_finalization_v1(text,uuid,uuid,uuid,uuid)',
    'game.verify_p2p_frozen_question_metadata_v1(text,uuid,uuid,text,uuid,uuid,integer)'
  ];
  v_role text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles r
    where r.rolname = 'games_api'
      and not r.rolcanlogin
      and not r.rolinherit
      and not r.rolsuper
      and not r.rolcreatedb
      and not r.rolcreaterole
      and not r.rolreplication
      and not r.rolbypassrls
  ) then
    raise exception 'games_api role attributes are broader than the reviewed contract';
  end if;

  if not pg_catalog.has_schema_privilege('games_api', 'game', 'USAGE')
     or pg_catalog.has_schema_privilege('games_api', 'game', 'CREATE')
     or pg_catalog.has_schema_privilege('games_api', 'game_private', 'USAGE')
     or pg_catalog.has_schema_privilege('games_api', 'game_private', 'CREATE') then
    raise exception 'games_api schema privileges differ from the reviewed contract';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('game', 'game_private')
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (
        pg_catalog.has_table_privilege('games_api', c.oid, 'SELECT')
        or pg_catalog.has_table_privilege('games_api', c.oid, 'INSERT')
        or pg_catalog.has_table_privilege('games_api', c.oid, 'UPDATE')
        or pg_catalog.has_table_privilege('games_api', c.oid, 'DELETE')
        or pg_catalog.has_table_privilege('games_api', c.oid, 'TRUNCATE')
        or pg_catalog.has_table_privilege('games_api', c.oid, 'REFERENCES')
        or pg_catalog.has_table_privilege('games_api', c.oid, 'TRIGGER')
      )
  ) then
    raise exception 'games_api has direct game/game_private table privileges';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('game', 'game_private')
      and c.relkind = 'S'
      and (
        pg_catalog.has_sequence_privilege('games_api', c.oid, 'USAGE')
        or pg_catalog.has_sequence_privilege('games_api', c.oid, 'SELECT')
        or pg_catalog.has_sequence_privilege('games_api', c.oid, 'UPDATE')
      )
  ) then
    raise exception 'games_api has direct game/game_private sequence privileges';
  end if;

  if exists (
    with actual(signature) as (
      select p.oid::pg_catalog.regprocedure::text
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('game', 'game_private')
        and pg_catalog.has_function_privilege('games_api', p.oid, 'EXECUTE')
    ), missing(signature) as (
      select expected.signature
      from pg_catalog.unnest(v_expected) expected(signature)
      except
      select actual.signature from actual
    ), unexpected(signature) as (
      select actual.signature from actual
      except
      select expected.signature from pg_catalog.unnest(v_expected) expected(signature)
    ), differences(signature) as (
      select signature from missing
      union all
      select signature from unexpected
    )
    select 1 from differences
  ) then
    raise exception 'games_api callable RPC inventory differs from the 22-signature allowlist';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.oid::pg_catalog.regprocedure::text = any(v_expected)
      and (
        n.nspname <> 'game'
        or pg_catalog.pg_get_userbyid(p.proowner) <> 'game_api_owner'
        or not p.prosecdef
        or pg_catalog.pg_get_functiondef(p.oid) !~ E'SET search_path TO \'\';'
      )
  ) then
    raise exception 'a callable Games RPC has unexpected owner/security/search_path metadata';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where n.nspname in ('game', 'game_private')
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute a game/game_private function';
  end if;

  foreach v_role in array array[
    'anon', 'authenticated', 'service_role', 'game_server'
  ] loop
    if exists (
      select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('game', 'game_private')
        and pg_catalog.has_function_privilege(v_role, p.oid, 'EXECUTE')
    ) then
      raise exception 'role % can execute a game/game_private function', v_role;
    end if;
  end loop;
end
$audit$;

select 'PASS: games_api has exactly 22 reviewed RPCs and no direct table/sequence access.'
  as games_runtime_privilege_audit;
