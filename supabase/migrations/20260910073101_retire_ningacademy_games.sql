-- Forward-only retirement of the NingAcademy Games database subsystem.
--
-- IMPORTANT: authoring and replaying this file locally does not authorize a
-- Production migration. The destructive portion removes Games data by design,
-- while preserving every non-Games application table and public.audit_log.
--
-- This migration is written against the Production-applied Games sequence
-- through 20260818021000_fix_p2p_room_code_random_source.sql. It also removes
-- later Games-only objects when they exist in a full local replay, without
-- depending on those unapproved migrations being present in Production.

-- ---------------------------------------------------------------------------
-- Fail-closed preflight
-- ---------------------------------------------------------------------------

do $preflight$
declare
  v_game_owner oid := pg_catalog.to_regrole('game_api_owner');
  v_login_memberships text;
  v_unexpected text;
  v_executor_oid oid;
  v_executor_can_manage_roles boolean;
  v_executor_is_superuser boolean;
  v_current_database oid;
begin
  select d.oid into v_current_database
  from pg_catalog.pg_database d
  where d.datname = current_database();

  if v_game_owner is null
     or pg_catalog.to_regrole('game_server') is null
     or pg_catalog.to_regrole('games_api') is null then
    raise exception 'Games teardown expected game_api_owner, game_server, and games_api to exist';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles r
    where r.rolname in ('game_api_owner', 'game_server', 'games_api')
      and (
        r.rolcanlogin
        or r.rolinherit
        or r.rolsuper
        or r.rolcreatedb
        or r.rolcreaterole
        or r.rolreplication
        or r.rolbypassrls
      )
  ) then
    raise exception 'Games teardown found a Games role with unexpected LOGIN or elevated attributes';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_db_role_setting setting
    where setting.setrole in (
      pg_catalog.to_regrole('game_api_owner'),
      pg_catalog.to_regrole('game_server'),
      pg_catalog.to_regrole('games_api')
    )
  ) then
    raise exception 'Games teardown found database/role settings attached to a Games role';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_shdepend dependency
    where dependency.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass::oid
      and dependency.refobjid in (
        pg_catalog.to_regrole('game_api_owner'),
        pg_catalog.to_regrole('game_server'),
        pg_catalog.to_regrole('games_api')
      )
      and dependency.dbid not in (0, v_current_database)
  ) then
    raise exception 'Games teardown found Games role dependencies in another database';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_namespace n
    where n.nspname in ('game', 'game_private')
      and n.nspowner = v_game_owner
    group by n.nspowner
    having pg_catalog.count(*) = 2
  ) then
    raise exception 'Games teardown expected game and game_private to exist and be owned by game_api_owner';
  end if;

  if pg_catalog.to_regclass('public.assignments') is null
     or not exists (
       select 1
       from pg_catalog.pg_attribute a
       where a.attrelid = 'public.assignments'::pg_catalog.regclass
         and a.attname = 'assignment_kind'
         and a.attnotnull
         and not a.attisdropped
     ) then
    raise exception 'public.assignments.assignment_kind is missing or nullable';
  end if;

  if exists (
    select 1
    from public.assignments a
    where a.assignment_kind not in ('plain', 'game')
  ) then
    raise exception 'public.assignments contains an unexpected assignment_kind';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.assignments'::pg_catalog.regclass
      and c.conname = 'assignments_assignment_kind_valid'
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%assignment_kind%plain%game%'
  ) then
    raise exception 'assignments_assignment_kind_valid no longer matches the reviewed plain/game contract';
  end if;

  -- A LOGIN membership is an external credential-management concern. Do not
  -- silently revoke or mutate it here. The normal hosted migration executor's
  -- pre-existing creator/admin edges are reviewed below; every other LOGIN
  -- membership must be removed separately after its exact role name is known.
  with recursive role_memberships(member_oid, role_oid) as (
    select m.member, m.roleid
    from pg_catalog.pg_auth_members m
    where m.set_option
    union
    select rm.member_oid, m.roleid
    from role_memberships rm
    join pg_catalog.pg_auth_members m on m.member = rm.role_oid
    where m.set_option
  ), login_edges as (
    select distinct member_role.rolname as login_role,
      target_role.rolname as game_role
    from role_memberships rm
    join pg_catalog.pg_roles member_role on member_role.oid = rm.member_oid
    join pg_catalog.pg_roles target_role on target_role.oid = rm.role_oid
    where member_role.rolcanlogin
      and member_role.rolname <> current_user
      and target_role.rolname in ('games_api', 'game_server', 'game_api_owner')
  )
  select pg_catalog.string_agg(
    pg_catalog.format('%I -> %I', login_role, game_role),
    ', ' order by login_role, game_role
  ) into v_login_memberships
  from login_edges;

  if v_login_memberships is not null then
    raise exception 'LOGIN role membership must be handled separately before Games teardown: %',
      v_login_memberships;
  end if;

  select pg_catalog.string_agg(
    pg_catalog.format('%I -> %I', member_role.rolname, granted_role.rolname),
    ', ' order by member_role.rolname, granted_role.rolname
  ) into v_unexpected
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles member_role on member_role.oid = membership.member
  join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
  where (
      membership.member in (
        pg_catalog.to_regrole('game_api_owner'),
        pg_catalog.to_regrole('game_server'),
        pg_catalog.to_regrole('games_api')
      )
      or membership.roleid in (
        pg_catalog.to_regrole('game_api_owner'),
        pg_catalog.to_regrole('game_server'),
        pg_catalog.to_regrole('games_api')
      )
    )
    and not (
      member_role.rolname = current_user
      and granted_role.rolname in ('game_api_owner', 'game_server', 'games_api')
    );

  if v_unexpected is not null then
    raise exception 'Games role membership must be removed separately before teardown: %',
      v_unexpected;
  end if;

  select r.oid, r.rolcreaterole, r.rolsuper
  into v_executor_oid, v_executor_can_manage_roles, v_executor_is_superuser
  from pg_catalog.pg_roles r
  where r.rolname = current_user;

  -- Hosted Supabase postgres is intentionally not a true superuser. The
  -- historical migrations record a permanent, supabase_admin-granted owner
  -- membership in addition to their self-canceling temporary edges. That
  -- expected membership is NOINHERIT, so require its existing SET capability;
  -- the reviewed Games-owned cleanup below enters and then resets the owner
  -- role without granting, revoking, or changing any membership.
  if not pg_catalog.pg_has_role(current_user, 'game_api_owner', 'SET') then
    raise exception 'Games teardown executor % cannot SET ROLE game_api_owner through the existing membership',
      current_user;
  end if;

  -- PostgreSQL 17 requires CREATEROLE plus ADMIN OPTION to drop a non-superuser
  -- role. The normal hosted executor created these roles historically, so its
  -- retained direct ADMIN edges are the narrow capability expected here.
  if not coalesce(v_executor_is_superuser, false)
     and not coalesce(v_executor_can_manage_roles, false) then
    raise exception 'Games teardown executor % lacks CREATEROLE required to drop Games roles',
      current_user;
  end if;

  select pg_catalog.string_agg(target.rolname, ', ' order by target.rolname)
  into v_unexpected
  from pg_catalog.pg_roles target
  where target.rolname in ('game_api_owner', 'game_server', 'games_api')
    and not exists (
      select 1
      from pg_catalog.pg_auth_members membership
      where membership.member = v_executor_oid
        and membership.roleid = target.oid
        and membership.admin_option
    );

  if not coalesce(v_executor_is_superuser, false)
     and v_unexpected is not null then
    raise exception 'Games teardown executor % lacks direct ADMIN OPTION for: %',
      current_user,
      v_unexpected;
  end if;

  -- DROP TRIGGER/POLICY, ALTER TABLE, DELETE, and table ACL revocation all
  -- require ownership-equivalent authority. Check every shared table this
  -- migration mutates instead of treating hosted postgres as superuser.
  select pg_catalog.string_agg(
    pg_catalog.format('%I.%I (owner=%I)', n.nspname, c.relname, owner.rolname),
    ', ' order by n.nspname, c.relname
  ) into v_unexpected
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_roles owner on owner.oid = c.relowner
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname in (
      'profiles',
      'teachers',
      'students',
      'classes',
      'enrollments',
      'assignments',
      'assignment_targets',
      'audit_log',
      'vocabulary_sets',
      'vocabulary_targets',
      'vocabulary_words',
      'vocabulary_word_alt_meanings',
      'vocabulary_word_alt_terms',
      'pronunciation_tasks',
      'submissions',
      'audio_submissions',
      'practice_sessions',
      'practice_session_words',
      'vocabulary_attempts',
      'vocabulary_audio_submissions',
      'vocabulary_audio_submission_files'
    )
    and not pg_catalog.pg_has_role(v_executor_oid, c.relowner, 'USAGE');

  if v_unexpected is not null then
    raise exception 'Games teardown executor lacks ownership-equivalent authority on shared tables: %',
      v_unexpected;
  end if;

  -- These objects are read during fail-closed preservation checks but are not
  -- changed by the teardown.
  select pg_catalog.string_agg(required_object, ', ' order by required_object)
  into v_unexpected
  from pg_catalog.unnest(array[
    'public.assignment_files',
    'public.upload_intents',
    'storage.buckets'
  ]::text[]) required_object
  where pg_catalog.to_regclass(required_object) is null
     or not pg_catalog.has_table_privilege(
       current_user,
       pg_catalog.to_regclass(required_object),
       'SELECT'
     );

  if v_unexpected is not null then
    raise exception 'Games teardown executor lacks required read access: %', v_unexpected;
  end if;

  -- Revoking shared helper/schema grants requires ownership-equivalent
  -- authority over those objects as well.
  select pg_catalog.string_agg(
    p.oid::pg_catalog.regprocedure::text,
    ', ' order by p.oid::pg_catalog.regprocedure::text
  ) into v_unexpected
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in (
      'current_game_user_id',
      'current_teacher_id',
      'current_student_id',
      'is_ready_profile',
      'teacher_owns_student',
      'can_view_assignment'
    )
    and not pg_catalog.pg_has_role(v_executor_oid, p.proowner, 'USAGE');

  if v_unexpected is not null then
    raise exception 'Games teardown executor lacks ownership-equivalent authority on shared/private helpers: %',
      v_unexpected;
  end if;

  select pg_catalog.string_agg(
    pg_catalog.format('%I (owner=%I)', n.nspname, owner.rolname),
    ', ' order by n.nspname
  ) into v_unexpected
  from pg_catalog.pg_namespace n
  join pg_catalog.pg_roles owner on owner.oid = n.nspowner
  where n.nspname in ('public', 'private')
    and not pg_catalog.pg_has_role(v_executor_oid, n.nspowner, 'USAGE');

  if v_unexpected is not null then
    raise exception 'Games teardown executor lacks ownership-equivalent authority on shared schemas: %',
      v_unexpected;
  end if;

  -- Game assignments were never meant to use the plain submission or
  -- attachment pipelines. Refuse to destroy a parent row if unexpected shared
  -- data exists; this preserves submissions, attachment metadata, Storage
  -- objects, and upload history rather than guessing how to migrate them.
  if exists (
    select 1
    from public.assignment_files f
    join public.assignments a on a.id = f.assignment_id
    where a.assignment_kind = 'game'
  ) then
    raise exception 'Games teardown blocked: a game assignment has assignment_files';
  end if;

  if exists (
    select 1
    from public.submissions s
    join public.assignments a on a.id = s.assignment_id
    where a.assignment_kind = 'game'
  ) then
    raise exception 'Games teardown blocked: a game assignment has submissions';
  end if;

  if exists (
    select 1
    from public.upload_intents i
    join public.assignments a on a.id = i.subject_id
    where i.purpose = 'assignment_file'
      and a.assignment_kind = 'game'
  ) then
    raise exception 'Games teardown blocked: a game assignment has upload_intents';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relowner = v_game_owner
      and c.relname in (
        'assignables',
        'game_assignment_configs',
        'game_assignment_accommodations',
        'game_assignment_vocabulary_sources',
        'game_assignment_versions',
        'game_unlock_requirements',
        'game_assignment_completion_status'
      )
  ) <> 7 then
    raise exception 'Games teardown expected all seven reviewed public Games support tables owned by game_api_owner';
  end if;

  -- game_api_owner is dedicated to Games. Abort if ownership has drifted to a
  -- non-Games object rather than allowing role cleanup to remove it implicitly.
  select pg_catalog.string_agg(
    pg_catalog.format('%I.%I', n.nspname, c.relname),
    ', ' order by n.nspname, c.relname
  ) into v_unexpected
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relowner = v_game_owner
    and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    and n.nspname not in ('game', 'game_private', 'pg_toast')
    and not (
      n.nspname = 'public'
      and c.relname in (
        'assignables',
        'game_assignment_configs',
        'game_assignment_accommodations',
        'game_assignment_vocabulary_sources',
        'game_assignment_versions',
        'game_unlock_requirements',
        'game_assignment_completion_status'
      )
    );

  if v_unexpected is not null then
    raise exception 'game_api_owner unexpectedly owns non-Games relations: %', v_unexpected;
  end if;

  select pg_catalog.string_agg(
    p.oid::pg_catalog.regprocedure::text,
    ', ' order by p.oid::pg_catalog.regprocedure::text
  ) into v_unexpected
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.proowner = v_game_owner
    and n.nspname not in ('game', 'game_private')
    and not (
      n.nspname = 'public'
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
        'get_game_access_status'
      )
    )
    and not (
      n.nspname = 'private'
      and p.proname in (
        'register_plain_assignable',
        'register_vocabulary_assignable',
        'register_pronunciation_assignable',
        'reject_game_unlock_snapshot_mutation',
        'get_assignable_completion',
        'game_access_allowed',
        'enforce_launch_ticket_game_access',
        'bind_game_auth_session_version'
      )
    );

  if v_unexpected is not null then
    raise exception 'game_api_owner unexpectedly owns non-Games routines: %', v_unexpected;
  end if;

  select pg_catalog.string_agg(
    p.oid::pg_catalog.regprocedure::text,
    ', ' order by p.oid::pg_catalog.regprocedure::text
  ) into v_unexpected
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
      'register_plain_assignable',
      'register_vocabulary_assignable',
      'register_pronunciation_assignable',
      'reject_game_unlock_snapshot_mutation',
      'get_assignable_completion',
      'game_access_allowed',
      'enforce_launch_ticket_game_access',
      'bind_game_auth_session_version'
    )
    and p.proowner <> v_game_owner;

  if v_unexpected is not null then
    raise exception 'verified Games routines have an unexpected owner: %', v_unexpected;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_namespace n
    where n.nspowner = v_game_owner
      and n.nspname not in ('game', 'game_private')
  ) then
    raise exception 'game_api_owner unexpectedly owns a non-Games schema';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('game', 'game_private')
      and (p.prokind <> 'f' or p.proowner <> v_game_owner)
  ) then
    raise exception 'Games teardown found a non-function or non-game_api_owner routine in game/game_private';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('game', 'game_private')
      and (
        c.relkind not in ('r', 'p', 'i', 'I', 'S', 't')
        or c.relowner <> v_game_owner
      )
  ) then
    raise exception 'Games teardown found an unreviewed relation kind or owner in game/game_private';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- Disconnect Games from shared NingAcademy tables
-- ---------------------------------------------------------------------------

drop trigger if exists assignments_assignment_kind_immutable on public.assignments;
drop trigger if exists assignments_game_config_required on public.assignments;
drop trigger if exists submissions_reject_game_assignment on public.submissions;
drop trigger if exists profiles_revoke_game_credentials on public.profiles;
drop trigger if exists assignments_revoke_game_credentials on public.assignments;
drop trigger if exists assignment_targets_revoke_game_credentials on public.assignment_targets;
drop trigger if exists enrollments_revoke_game_credentials on public.enrollments;
drop trigger if exists students_revoke_game_credentials on public.students;
drop trigger if exists assignments_register_plain_assignable on public.assignments;
drop trigger if exists vocabulary_sets_register_assignable on public.vocabulary_sets;
drop trigger if exists pronunciation_tasks_register_assignable on public.pronunciation_tasks;

drop policy if exists "profiles_game_api_owner_select" on public.profiles;
drop policy if exists "teachers_game_api_owner_select" on public.teachers;
drop policy if exists "students_game_api_owner_select" on public.students;
drop policy if exists "classes_game_api_owner_select" on public.classes;
drop policy if exists "enrollments_game_api_owner_select" on public.enrollments;
drop policy if exists "assignments_game_api_owner_select" on public.assignments;
drop policy if exists "assignments_game_api_owner_insert" on public.assignments;
drop policy if exists "assignment_targets_game_api_owner_select" on public.assignment_targets;
drop policy if exists "assignment_targets_game_api_owner_insert" on public.assignment_targets;
drop policy if exists "audit_log_game_api_owner_insert" on public.audit_log;
drop policy if exists "vocabulary_sets_game_api_owner_select" on public.vocabulary_sets;
drop policy if exists "vocabulary_targets_game_api_owner_select" on public.vocabulary_targets;
drop policy if exists "vocabulary_words_game_api_owner_select" on public.vocabulary_words;
drop policy if exists "vocabulary_word_alt_meanings_game_api_owner_select" on public.vocabulary_word_alt_meanings;
drop policy if exists "vocabulary_word_alt_terms_game_api_owner_select" on public.vocabulary_word_alt_terms;
drop policy if exists "pronunciation_tasks_game_api_owner_select" on public.pronunciation_tasks;
drop policy if exists "submissions_game_api_owner_select" on public.submissions;
drop policy if exists "audio_submissions_game_api_owner_select" on public.audio_submissions;
drop policy if exists "practice_sessions_game_api_owner_select" on public.practice_sessions;
drop policy if exists "practice_session_words_game_api_owner_select" on public.practice_session_words;
drop policy if exists "vocabulary_attempts_game_api_owner_select" on public.vocabulary_attempts;
drop policy if exists "vocabulary_audio_submissions_game_api_owner_select" on public.vocabulary_audio_submissions;
drop policy if exists "vocabulary_audio_submission_files_game_api_owner_select" on public.vocabulary_audio_submission_files;

-- Enter the dedicated owner only for cleanup of its own default privileges
-- and reviewed public Games API. The existing membership was validated above;
-- this migration does not mutate any role edge.
set role game_api_owner;

-- Remove every default-privilege entry installed by the Games migrations.
-- EXECUTE-for-PUBLIC is PostgreSQL's built-in function default, so granting it
-- back here removes game_api_owner's non-default pg_default_acl row. No Games
-- function is created afterward, and the owner role is dropped in this same
-- transaction. Table/sequence defaults are no-access, hence REVOKE for those.
alter default privileges for role game_api_owner
  grant execute on functions to public;
alter default privileges for role game_api_owner in schema game
  revoke all on tables from public, anon, authenticated, service_role, game_server, games_api;
alter default privileges for role game_api_owner in schema game_private
  revoke all on tables from public, anon, authenticated, service_role, game_server, games_api;
alter default privileges for role game_api_owner in schema game
  revoke all on sequences from public, anon, authenticated, service_role, game_server, games_api;
alter default privileges for role game_api_owner in schema game_private
  revoke all on sequences from public, anon, authenticated, service_role, game_server, games_api;

-- Drop all signature variants of the verified public Games API. The owner and
-- name allowlists above prevent this catalog loop from expanding to an
-- unrelated public function.
do $drop_public_games_api$
declare
  v_functions text;
begin
  select pg_catalog.string_agg(
    p.oid::pg_catalog.regprocedure::text,
    ', ' order by p.oid::pg_catalog.regprocedure::text
  ) into v_functions
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proowner = pg_catalog.to_regrole('game_api_owner')
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
      'get_game_access_status'
    );

  if v_functions is not null then
    execute 'drop function ' || v_functions || ' restrict';
  end if;
end
$drop_public_games_api$;

reset role;

-- Build the same dependency direction PostgreSQL follows for a drop: objects
-- in the two Games schemas plus the explicitly reviewed public/private Games
-- objects are seeds; their internally/automatically owned objects are included
-- recursively. Any pg_depend edge from outside that exact drop set into it is
-- an unreviewed cross-boundary dependent and aborts before any Games table is
-- removed. The subsequent grouped DROP statements still use RESTRICT, making
-- PostgreSQL itself the final dependency-graph authority.
do $schema_dependency_preflight$
declare
  v_unexpected text;
begin
  with recursive seeds(classid, objid, objsubid) as (
    select 'pg_catalog.pg_namespace'::pg_catalog.regclass::oid, n.oid, 0
    from pg_catalog.pg_namespace n
    where n.nspname in ('game', 'game_private')

    union

    select 'pg_catalog.pg_class'::pg_catalog.regclass::oid, c.oid, 0
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
      )

    union

    select 'pg_catalog.pg_proc'::pg_catalog.regclass::oid, p.oid, 0
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'current_game_user_id',
        'register_plain_assignable',
        'register_vocabulary_assignable',
        'register_pronunciation_assignable',
        'reject_game_unlock_snapshot_mutation',
        'get_assignable_completion',
        'game_access_allowed',
        'enforce_launch_ticket_game_access',
        'bind_game_auth_session_version'
      )
  ), drop_set(classid, objid, objsubid) as (
    select s.classid, s.objid, s.objsubid
    from seeds s

    union

    select d.classid, d.objid, d.objsubid
    from pg_catalog.pg_depend d
    join drop_set parent
      on parent.classid = d.refclassid
     and parent.objid = d.refobjid
    where d.deptype in ('a', 'i')
       or (
         parent.classid = 'pg_catalog.pg_namespace'::pg_catalog.regclass::oid
         and parent.objid in (
           pg_catalog.to_regnamespace('game'),
           pg_catalog.to_regnamespace('game_private')
         )
         and d.deptype = 'n'
       )
  ), drop_objects as (
    select distinct d.classid, d.objid
    from drop_set d
  ), crossings as (
    select distinct
      pg_catalog.pg_describe_object(
        dependency.classid,
        dependency.objid,
        dependency.objsubid
      ) as dependent_object,
      pg_catalog.pg_describe_object(
        dependency.refclassid,
        dependency.refobjid,
        dependency.refobjsubid
      ) as referenced_games_object,
      dependency.deptype
    from pg_catalog.pg_depend dependency
    join drop_objects referenced
      on referenced.classid = dependency.refclassid
     and referenced.objid = dependency.refobjid
    left join drop_objects dependent
      on dependent.classid = dependency.classid
     and dependent.objid = dependency.objid
    where dependent.objid is null
  )
  select pg_catalog.string_agg(
    pg_catalog.format(
      '%s --[%s]--> %s',
      dependent_object,
      deptype,
      referenced_games_object
    ),
    '; ' order by dependent_object, referenced_games_object
  ) into v_unexpected
  from crossings;

  if v_unexpected is not null then
    raise exception 'unexpected pg_depend edges cross into the Games drop set: %',
      v_unexpected;
  end if;

  select pg_catalog.string_agg(
    pg_catalog.format('%I.%I.%I', table_ns.nspname, table_rel.relname, t.tgname),
    ', ' order by table_ns.nspname, table_rel.relname, t.tgname
  ) into v_unexpected
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  join pg_catalog.pg_namespace function_ns on function_ns.oid = p.pronamespace
  join pg_catalog.pg_class table_rel on table_rel.oid = t.tgrelid
  join pg_catalog.pg_namespace table_ns on table_ns.oid = table_rel.relnamespace
  where not t.tgisinternal
    and function_ns.nspname in ('game', 'game_private')
    and table_ns.nspname not in ('game', 'game_private')
    and not (
      table_ns.nspname = 'public'
      and table_rel.relname in (
        'assignables',
        'game_assignment_configs',
        'game_assignment_accommodations',
        'game_assignment_vocabulary_sources',
        'game_assignment_versions',
        'game_unlock_requirements',
        'game_assignment_completion_status'
      )
    );

  if v_unexpected is not null then
    raise exception 'unexpected shared triggers still depend on Games schemas: %', v_unexpected;
  end if;

  select pg_catalog.string_agg(
    p.oid::pg_catalog.regprocedure::text,
    ', ' order by p.oid::pg_catalog.regprocedure::text
  ) into v_unexpected
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('game', 'game_private', 'pg_catalog', 'information_schema')
    and n.nspname !~ '^pg_'
    and p.prokind = 'f'
    and pg_catalog.pg_get_functiondef(p.oid) ~ '(^|[^a-zA-Z0-9_])(game|game_private)[.]'
    and not (
      n.nspname = 'private'
      and p.proname in (
        'current_game_user_id',
        'register_plain_assignable',
        'register_vocabulary_assignable',
        'register_pronunciation_assignable',
        'reject_game_unlock_snapshot_mutation',
        'get_assignable_completion',
        'game_access_allowed',
        'enforce_launch_ticket_game_access',
        'bind_game_auth_session_version'
      )
    );

  if v_unexpected is not null then
    raise exception 'unexpected shared routines still depend on Games schemas: %', v_unexpected;
  end if;

  select pg_catalog.string_agg(
    pg_catalog.format('%I.%I', n.nspname, c.relname),
    ', ' order by n.nspname, c.relname
  ) into v_unexpected
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('v', 'm')
    and n.nspname not in ('game', 'game_private')
    and pg_catalog.pg_get_viewdef(c.oid, true) ~ '(^|[^a-zA-Z0-9_])(game|game_private)[.]';

  if v_unexpected is not null then
    raise exception 'unexpected views still depend on Games schemas: %', v_unexpected;
  end if;

  select pg_catalog.string_agg(
    pg_catalog.format('%I.%I.%I', n.nspname, rel.relname, c.conname),
    ', ' order by n.nspname, rel.relname, c.conname
  ) into v_unexpected
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class rel on rel.oid = c.conrelid
  join pg_catalog.pg_namespace n on n.oid = rel.relnamespace
  where n.nspname not in ('game', 'game_private')
    and pg_catalog.pg_get_constraintdef(c.oid, true) ~ '(^|[^a-zA-Z0-9_])(game|game_private)[.]'
    and not (
      n.nspname = 'public'
      and rel.relname in (
        'assignables',
        'game_assignment_configs',
        'game_assignment_accommodations',
        'game_assignment_vocabulary_sources',
        'game_assignment_versions',
        'game_unlock_requirements',
        'game_assignment_completion_status'
      )
    );

  if v_unexpected is not null then
    raise exception 'unexpected shared constraints still depend on Games schemas: %', v_unexpected;
  end if;

  select pg_catalog.string_agg(
    pg_catalog.format('%I.%I.%I', n.nspname, c.relname, pol.polname),
    ', ' order by n.nspname, c.relname, pol.polname
  ) into v_unexpected
  from pg_catalog.pg_policy pol
  join pg_catalog.pg_class c on c.oid = pol.polrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('game', 'game_private')
    and (
      coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '')
        ~ '(^|[^a-zA-Z0-9_])(game|game_private)[.]'
      or coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '')
        ~ '(^|[^a-zA-Z0-9_])(game|game_private)[.]'
    );

  if v_unexpected is not null then
    raise exception 'unexpected shared policies still depend on Games schemas: %', v_unexpected;
  end if;
end
$schema_dependency_preflight$;

-- Normalize the one Games-only private helper that was historically
-- created under postgres so the reviewed grouped DROP has one owner.
grant create on schema private to game_api_owner;

alter function private.current_game_user_id() owner to game_api_owner;

revoke create on schema private from game_api_owner;

-- The dependency graph is now proven closed. Enter the dedicated owner only
-- for the reviewed Games-owned tables, routines, sequences, and schemas.
set role game_api_owner;

-- Drop every reviewed Games table in one RESTRICT operation. Grouping the
-- targets allows their mutual foreign keys to disappear together while an FK,
-- view, or any other dependent outside the exact list still blocks the drop.
do $drop_games_tables$
declare
  v_tables text;
begin
  select pg_catalog.string_agg(
    pg_catalog.format('%I.%I', n.nspname, c.relname),
    ', ' order by n.nspname, c.relname
  ) into v_tables
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and (
      n.nspname in ('game', 'game_private')
      or (
        n.nspname = 'public'
        and c.relname in (
          'assignables',
          'game_assignment_configs',
          'game_assignment_accommodations',
          'game_assignment_vocabulary_sources',
          'game_assignment_versions',
          'game_unlock_requirements',
          'game_assignment_completion_status'
        )
      )
    );

  if v_tables is null then
    raise exception 'Games teardown table inventory unexpectedly resolved empty';
  end if;

  execute 'drop table ' || v_tables || ' restrict';
end
$drop_games_tables$;

-- Drop all remaining Games routines together so dependencies within the set
-- are allowed but any external caller represented in pg_depend blocks it.
do $drop_games_functions$
declare
  v_functions text;
begin
  select pg_catalog.string_agg(
    p.oid::pg_catalog.regprocedure::text,
    ', ' order by p.oid::pg_catalog.regprocedure::text
  ) into v_functions
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.prokind = 'f'
    and (
      n.nspname in ('game', 'game_private')
      or (
        n.nspname = 'private'
        and p.proname in (
          'current_game_user_id',
          'register_plain_assignable',
          'register_vocabulary_assignable',
          'register_pronunciation_assignable',
          'reject_game_unlock_snapshot_mutation',
          'get_assignable_completion',
          'game_access_allowed',
          'enforce_launch_ticket_game_access',
          'bind_game_auth_session_version'
        )
      )
    );

  if v_functions is not null then
    execute 'drop function ' || v_functions || ' restrict';
  end if;
end
$drop_games_functions$;

-- Identity/owned sequences normally disappear with their tables. Remove any
-- reviewed standalone Games sequence explicitly, still without CASCADE.
do $drop_games_sequences$
declare
  v_sequences text;
begin
  select pg_catalog.string_agg(
    pg_catalog.format('%I.%I', n.nspname, c.relname),
    ', ' order by n.nspname, c.relname
  ) into v_sequences
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'S'
    and n.nspname in ('game', 'game_private');

  if v_sequences is not null then
    execute 'drop sequence ' || v_sequences || ' restrict';
  end if;
end
$drop_games_sequences$;

-- Empty-schema RESTRICT is the final structural proof. No object outside or
-- inside either schema may be removed implicitly.
drop schema game, game_private restrict;

-- Shared NingAcademy cleanup and final role deletion require the migration
-- executor, not the retired Games owner.
reset role;

-- Remove Games assignment targeting and then the game parent rows. The
-- preflight has already proved that no shared submission/attachment/upload
-- history would be lost. public.audit_log is deliberately not touched.
delete from public.assignment_targets t
using public.assignments a
where t.assignment_id = a.id
  and a.assignment_kind = 'game';

delete from public.assignments a
where a.assignment_kind = 'game';

-- The deployed main site still filters public.assignments by
-- assignment_kind='plain'. Keep the NOT NULL column and its default until a
-- separately deployed application change removes those reads. Tighten the
-- constraint so Games rows cannot be reintroduced after teardown.
alter table public.assignments
  drop constraint assignments_assignment_kind_valid;
alter table public.assignments
  alter column assignment_kind set default 'plain',
  alter column assignment_kind set not null;
alter table public.assignments
  add constraint assignments_assignment_kind_plain_only
  check (assignment_kind = 'plain');
comment on column public.assignments.assignment_kind is
  'Legacy main-site compatibility discriminator. NingAcademy Games is retired; every surviving assignment must be plain.';

-- Remove every remaining direct grant from shared objects.
revoke all privileges on table
  public.profiles,
  public.teachers,
  public.students,
  public.classes,
  public.enrollments,
  public.assignments,
  public.assignment_targets,
  public.audit_log,
  public.vocabulary_sets,
  public.vocabulary_targets,
  public.vocabulary_words,
  public.vocabulary_word_alt_meanings,
  public.vocabulary_word_alt_terms,
  public.pronunciation_tasks,
  public.submissions,
  public.audio_submissions,
  public.practice_sessions,
  public.practice_session_words,
  public.vocabulary_attempts,
  public.vocabulary_audio_submissions,
  public.vocabulary_audio_submission_files
from game_api_owner;

revoke execute on function private.current_teacher_id() from game_api_owner;
revoke execute on function private.current_student_id() from game_api_owner;
revoke execute on function private.is_ready_profile() from game_api_owner;
revoke execute on function private.teacher_owns_student(uuid) from game_api_owner;
revoke execute on function private.can_view_assignment(uuid) from game_api_owner;
revoke usage, create on schema public from game_api_owner;
revoke usage, create on schema private from game_api_owner;

-- pg_shdepend is PostgreSQL's cross-database/shared-object ownership and ACL
-- ledger. At this point it must be empty for all three roles. Memberships are
-- checked separately because pg_auth_members is the authoritative catalog.
-- Only the hosted executor's pre-existing, capability-checked ADMIN edges may
-- survive to DROP ROLE; PostgreSQL removes those edges with the retired roles.
-- This migration never grants, revokes, or changes a Games role membership.
do $role_dependency_preflight$
declare
  v_dependencies text;
  v_memberships text;
  v_current_database oid;
begin
  select d.oid into v_current_database
  from pg_catalog.pg_database d
  where d.datname = current_database();

  select pg_catalog.string_agg(
    case
      when dependency.dbid = v_current_database then
        pg_catalog.format(
          '%s (deptype=%s)',
          pg_catalog.pg_describe_object(
            dependency.classid,
            dependency.objid,
            dependency.objsubid
          ),
          dependency.deptype
        )
      else
        pg_catalog.format(
          'database_oid=%s classid=%s objid=%s objsubid=%s (deptype=%s)',
          dependency.dbid,
          dependency.classid,
          dependency.objid,
          dependency.objsubid,
          dependency.deptype
        )
    end,
    '; ' order by dependency.dbid, dependency.classid, dependency.objid, dependency.objsubid
  ) into v_dependencies
  from pg_catalog.pg_shdepend dependency
  where dependency.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass::oid
    and dependency.refobjid in (
      pg_catalog.to_regrole('game_api_owner'),
      pg_catalog.to_regrole('game_server'),
      pg_catalog.to_regrole('games_api')
    );

  if v_dependencies is not null then
    raise exception 'Games role ownership/ACL/default-privilege dependencies remain: %',
      v_dependencies;
  end if;

  select pg_catalog.string_agg(
    pg_catalog.format('%I -> %I', member_role.rolname, granted_role.rolname),
    ', ' order by member_role.rolname, granted_role.rolname
  ) into v_memberships
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles member_role on member_role.oid = membership.member
  join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
  where (
      membership.member in (
        pg_catalog.to_regrole('game_api_owner'),
        pg_catalog.to_regrole('game_server'),
        pg_catalog.to_regrole('games_api')
      )
      or membership.roleid in (
        pg_catalog.to_regrole('game_api_owner'),
        pg_catalog.to_regrole('game_server'),
        pg_catalog.to_regrole('games_api')
      )
    )
    and not (
      member_role.rolname = current_user
      and granted_role.rolname in ('game_api_owner', 'game_server', 'games_api')
    );

  if v_memberships is not null then
    raise exception 'unexpected Games role memberships remain: %', v_memberships;
  end if;
end
$role_dependency_preflight$;

-- DROP ROLE has no CASCADE form and remains the final fail-closed catalog
-- check: any dependency missed above aborts and rolls back the transaction.
drop role games_api;
drop role game_server;
drop role game_api_owner;

-- ---------------------------------------------------------------------------
-- Postconditions: Games is gone; shared NingAcademy remains
-- ---------------------------------------------------------------------------

do $postconditions$
declare
  v_missing text;
begin
  if pg_catalog.to_regnamespace('game') is not null
     or pg_catalog.to_regnamespace('game_private') is not null then
    raise exception 'Games schema removal postcondition failed';
  end if;

  if pg_catalog.to_regrole('games_api') is not null
     or pg_catalog.to_regrole('game_server') is not null
     or pg_catalog.to_regrole('game_api_owner') is not null then
    raise exception 'Games role removal postcondition failed';
  end if;

  if exists (select 1 from public.assignments where assignment_kind <> 'plain') then
    raise exception 'non-plain assignment survived Games teardown';
  end if;

  select pg_catalog.string_agg(required_name, ', ' order by required_name)
  into v_missing
  from pg_catalog.unnest(array[
    'public.audit_log',
    'public.assignment_files',
    'public.assignment_targets',
    'public.assignments',
    'public.audio_submission_files',
    'public.audio_submissions',
    'public.classes',
    'public.enrollments',
    'public.profiles',
    'public.pronunciation_tasks',
    'public.students',
    'public.submissions',
    'public.teachers',
    'public.vocabulary_audio_submission_files',
    'public.vocabulary_sets',
    'public.vocabulary_targets',
    'public.vocabulary_words'
  ]::text[]) required_name
  where pg_catalog.to_regclass(required_name) is null;

  if v_missing is not null then
    raise exception 'shared NingAcademy table preservation postcondition failed: %', v_missing;
  end if;

  if pg_catalog.to_regclass('auth.users') is null then
    raise exception 'Supabase Auth preservation postcondition failed: auth.users is missing';
  end if;

  if pg_catalog.to_regclass('storage.buckets') is null
     or not exists (select 1 from storage.buckets where id = 'attachments') then
    raise exception 'Supabase Storage preservation postcondition failed: attachments bucket is missing';
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
    raise exception 'assignment_kind compatibility column/default/NOT NULL contract was not preserved';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.assignments'::pg_catalog.regclass
      and c.conname = 'assignments_assignment_kind_plain_only'
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%assignment_kind%plain%'
  ) then
    raise exception 'assignment_kind plain-only constraint was not preserved';
  end if;
end
$postconditions$;
