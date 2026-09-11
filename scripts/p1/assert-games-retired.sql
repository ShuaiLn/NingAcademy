\set ON_ERROR_STOP on

-- Read-only catalog assertion for the post-teardown replay state.
do $audit$
declare
  v_remaining text;
begin
  if pg_catalog.to_regnamespace('game') is not null
     or pg_catalog.to_regnamespace('game_private') is not null then
    raise exception 'a retired Games schema still exists';
  end if;

  if pg_catalog.to_regrole('game_api_owner') is not null
     or pg_catalog.to_regrole('game_server') is not null
     or pg_catalog.to_regrole('games_api') is not null then
    raise exception 'a retired Games role still exists';
  end if;

  select pg_catalog.string_agg(c.relname, ', ' order by c.relname)
  into v_remaining
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'assignables',
      'game_assignment_configs',
      'game_assignment_accommodations',
      'game_assignment_vocabulary_sources',
      'game_assignment_versions',
      'game_unlock_requirements',
      'game_assignment_completion_status'
    );

  if v_remaining is not null then
    raise exception 'retired public Games tables remain: %', v_remaining;
  end if;

  select pg_catalog.string_agg(
    p.oid::pg_catalog.regprocedure::text,
    ', ' order by p.oid::pg_catalog.regprocedure::text
  ) into v_remaining
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.proname in (
      'create_and_publish_game_assignment_v1',
      'create_and_publish_game_assignment_v2',
      'create_and_publish_game_assignment_v3',
      'set_game_assignment_accommodation_v1',
      'set_game_assignment_accommodation_v2',
      'issue_game_launch_ticket_v1',
      'revoke_game_sessions_v1',
      'get_my_game_profile_v1',
      'get_my_game_profile_v2',
      'get_teacher_game_report_v1',
      'get_teacher_game_report_v2',
      'get_game_assignment_completion_v1',
      'purge_expired_game_private_data_v1',
      'list_my_assignables_v1',
      'list_game_unlock_candidates_v1',
      'set_game_unlock_requirements_v1',
      'get_game_access_status',
      'current_game_user_id',
      'register_plain_assignable',
      'register_vocabulary_assignable',
      'register_pronunciation_assignable',
      'reject_game_unlock_snapshot_mutation',
      'get_assignable_completion',
      'game_access_allowed',
      'enforce_launch_ticket_game_access',
      'bind_game_auth_session_version'
    );

  if v_remaining is not null then
    raise exception 'retired public/private Games routines remain: %', v_remaining;
  end if;

  if exists (
    select 1 from public.assignments where assignment_kind <> 'plain'
  ) then
    raise exception 'a non-plain assignment survived Games retirement';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid
     and d.adnum = a.attnum
    where a.attrelid = 'public.assignments'::pg_catalog.regclass
      and a.attname = 'assignment_kind'
      and a.attnotnull
      and not a.attisdropped
      and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = '''plain''::text'
  ) then
    raise exception 'assignment_kind plain compatibility contract is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.assignments'::pg_catalog.regclass
      and c.conname = 'assignments_assignment_kind_plain_only'
      and c.contype = 'c'
  ) then
    raise exception 'assignment_kind plain-only constraint is missing';
  end if;
end
$audit$;

select 'PASS: Games schemas, roles, public support objects, and assignments are retired.'
  as games_retirement_audit;
