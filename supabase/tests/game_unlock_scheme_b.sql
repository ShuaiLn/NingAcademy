-- Run with psql after all active migrations, inside one transaction. This file
-- creates deterministic fixtures and intentionally leaves cleanup to ROLLBACK.
-- It is safe only against a disposable/replay database or with psql -1 plus an
-- explicit final ROLLBACK supplied by the caller.

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');

insert into public.profiles (id, username, full_name, role) values
  ('10000000-0000-4000-8000-000000000001', 'schemeb_teacher', 'Scheme B Teacher', 'teacher'),
  ('10000000-0000-4000-8000-000000000002', 'schemeb_student', 'Scheme B Student', 'student');
insert into public.teachers (id) values ('10000000-0000-4000-8000-000000000001');
insert into public.students (id, teacher_id) values (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.assignments (
  id, teacher_id, title, published_at, assignment_kind
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Plain requirement', now(), 'plain'
);
insert into public.assignment_targets (assignment_id, student_id) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
);

insert into public.vocabulary_sets (
  id, teacher_id, title, published_at, practice_engine_version
) values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Vocabulary requirement', now(), 2
);
insert into public.vocabulary_targets (set_id, student_id) values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
);
insert into public.vocabulary_words (id, set_id, term, meaning) values (
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  'alpha', 'first'
);

insert into public.pronunciation_tasks (
  id, teacher_id, title, published_at
) values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Pronunciation requirement', now()
);
insert into public.pronunciation_targets (task_id, student_id) values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
);

do $assert_registry$
begin
  if (
    select count(*)
    from public.assignables
    where assignment_id = '20000000-0000-4000-8000-000000000001'
       or vocabulary_set_id = '30000000-0000-4000-8000-000000000001'
       or pronunciation_task_id = '40000000-0000-4000-8000-000000000001'
  ) <> 3 then
    raise exception 'expected one registry row for each fixture assignable';
  end if;
  if exists (
    select 1 from public.assignables where assignable_kind not in ('plain', 'vocabulary', 'pronunciation')
  ) then
    raise exception 'registry contains a forbidden kind';
  end if;
end
$assert_registry$;

do $authenticated_membership$
begin
  execute pg_catalog.format('grant authenticated to %I', current_user);
end
$authenticated_membership$;
create temporary table scheme_b_assignables as
select id, assignable_kind
from public.assignables
where assignment_id = '20000000-0000-4000-8000-000000000001'
   or vocabulary_set_id = '30000000-0000-4000-8000-000000000001'
   or pronunciation_task_id = '40000000-0000-4000-8000-000000000001';
grant select on scheme_b_assignables to authenticated;
create temporary table scheme_b_game (game_assignment_id uuid not null);
grant insert, select on scheme_b_game to authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
insert into scheme_b_game
select public.create_and_publish_game_assignment_v2(
  'Scheme B game', 'fixture', now() + interval '1 day',
  array[]::uuid[], array['10000000-0000-4000-8000-000000000002'::uuid],
  array['30000000-0000-4000-8000-000000000001'::uuid],
  array['pve']::text[], 'house', 'standard', 1, 1, 60,
  0::smallint, false, 'off', 'off', false, false, false, false, 1.0,
  'scheme-b-test', 'scheme-b-test', now() + interval '30 days',
  array(select id from scheme_b_assignables order by id),
  '50000000-0000-4000-8000-000000000001'
);
reset role;

do $assert_created$
begin
  if (select game_assignment_id from scheme_b_game) is null then
    raise exception 'game assignment was not created';
  end if;
  if exists (
    select 1 from public.assignables ar
    where ar.assignment_id = (select game_assignment_id from scheme_b_game)
  ) then
    raise exception 'game assignment entered the unlock registry';
  end if;
  if (select count(*) from public.game_assignment_versions
      where game_assignment_id = (select game_assignment_id from scheme_b_game)) <> 1 then
    raise exception 'version 1 was not created';
  end if;
  if (select count(*) from public.game_unlock_requirements r
      join public.game_assignment_versions v on v.id = r.game_assignment_version_id
      where v.game_assignment_id = (select game_assignment_id from scheme_b_game)) <> 3 then
    raise exception 'three requirements were not snapshotted';
  end if;
end
$assert_created$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
set local role authenticated;

do $assert_locked$
declare
  v_status record;
begin
  select * into v_status
  from public.get_game_access_status((select game_assignment_id from scheme_b_game));
  if v_status.allowed or pg_catalog.jsonb_array_length(v_status.requirements) <> 3 then
    raise exception 'student should be locked with three visible requirements';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_status.requirements) requirement
    where (requirement ->> 'completed')::boolean
  ) then
    raise exception 'no requirement should initially be complete';
  end if;

  begin
    perform * from public.issue_game_launch_ticket_v1(
      (select game_assignment_id from scheme_b_game),
      '50000000-0000-4000-8000-000000000002',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    raise exception 'locked student received a launch ticket';
  exception when sqlstate '42501' then
    null;
  end;
end
$assert_locked$;
reset role;

insert into public.submissions (
  assignment_id, student_id, attempt_no, submitted_at
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002', 1, now()
);

set local role authenticated;
do $assert_partial$
declare
  v_status record;
begin
  select * into v_status
  from public.get_game_access_status((select game_assignment_id from scheme_b_game));
  if v_status.allowed then
    raise exception 'one of three completed requirements must remain locked';
  end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(v_status.requirements) r
      where (r ->> 'completed')::boolean) <> 1 then
    raise exception 'partial completion evidence is incorrect';
  end if;
end
$assert_partial$;
reset role;

insert into public.audio_submissions (
  task_id, student_id, attempt_no, submitted_at
) values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002', 1, now()
);

insert into public.practice_sessions (
  id, student_id, set_id, completed_at, total_words,
  practice_engine_version, audio_word_count
) values (
  '30000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001', now(), 1, 2, 0
);
insert into public.practice_session_words (
  session_id, word_id, sort_order, prompt_text, correct_answer,
  prompt_term, prompt_meaning, input_mode, correct_answers
) values (
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000002', 0, 'first', 'alpha',
  'alpha', 'first', 'type_english', array['alpha']::text[]
);
insert into public.vocabulary_attempts (
  session_id, word_id, prompt_text, correct_answer, submitted_spelling,
  is_correct, prompt_term, correct_answers, attempt_no, input_mode
) values (
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000002', 'first', 'alpha', 'alpha',
  true, 'alpha', array['alpha']::text[], 1, 'type_english'
);

create temporary table scheme_b_ticket (
  launch_ticket text not null,
  expires_at timestamptz not null,
  assignment_id uuid
);
grant insert, select on scheme_b_ticket to authenticated;
set local role authenticated;
do $assert_allowed$
declare
  v_status record;
begin
  select * into v_status
  from public.get_game_access_status((select game_assignment_id from scheme_b_game));
  if not v_status.allowed then
    raise exception 'all completed requirements should unlock the game';
  end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(v_status.requirements) r
      where (r ->> 'completed')::boolean) <> 3 then
    raise exception 'completed requirement evidence is incorrect';
  end if;
end
$assert_allowed$;

insert into scheme_b_ticket
select * from public.issue_game_launch_ticket_v1(
  (select game_assignment_id from scheme_b_game),
  '50000000-0000-4000-8000-000000000003',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
);
reset role;

do $assert_ticket$
begin
  if not exists (
    select 1
    from game_private.launch_tickets lt
    join public.game_assignment_configs c
      on c.assignment_id = lt.assignment_id
     and c.current_unlock_version_id = lt.assignment_version_id
    where lt.token_hash = pg_catalog.sha256(pg_catalog.convert_to(
      (select launch_ticket from scheme_b_ticket), 'UTF8'
    ))
      and lt.used_at is null
      and lt.expires_at <= lt.created_at + interval '60 seconds'
  ) then
    raise exception 'ticket is not bound to the current unlock version';
  end if;
end
$assert_ticket$;

grant select on scheme_b_ticket, scheme_b_game to games_api;
do $test_role_membership$
begin
  execute pg_catalog.format(
    'grant games_api to %I with set true, inherit false, admin false',
    current_user
  );
  execute pg_catalog.format(
    'grant game_api_owner to %I with set true, inherit false, admin false',
    current_user
  );
end
$test_role_membership$;
set local role games_api;

do $assert_invalid_ticket$
begin
  begin
    perform * from game.redeem_game_launch_ticket_v1(
      'forged-ticket-that-is-long-enough-to-pass-shape-validation-000000',
      '50000000-0000-4000-8000-000000000004'
    );
    raise exception 'forged ticket was redeemed';
  exception when sqlstate '28000' then
    null;
  end;
end
$assert_invalid_ticket$;

create temporary table scheme_b_session as
select * from game.redeem_game_launch_ticket_v1(
  (select launch_ticket from scheme_b_ticket),
  '50000000-0000-4000-8000-000000000005'
);

do $assert_session_and_replay$
declare
  v_validated_v2 record;
begin
  select * into v_validated_v2 from game.validate_game_session_v2(
    (select game_session_token from scheme_b_session)
  );
  if v_validated_v2.auth_session_id is null
     or v_validated_v2.user_id <> '10000000-0000-4000-8000-000000000002'::uuid
     or v_validated_v2.assignment_id <> (select game_assignment_id from scheme_b_game) then
    raise exception 'game session identity binding is incorrect';
  end if;

  begin
    perform * from game.redeem_game_launch_ticket_v1(
      (select launch_ticket from scheme_b_ticket),
      '50000000-0000-4000-8000-000000000006'
    );
    raise exception 'launch ticket replay succeeded';
  exception when sqlstate '28000' then
    null;
  end;
end
$assert_session_and_replay$;

create temporary table scheme_b_p2p_room as
select * from game.create_p2p_room_v1(
  (select game_session_token from scheme_b_session),
  '50000000-0000-4000-8000-000000000010',
  8::smallint,
  1::smallint,
  'scheme-b-test'
);

select game.set_p2p_ready_v1(
  (select game_session_token from scheme_b_session),
  (select room_id from scheme_b_p2p_room),
  true
);

do $assert_p2p_room$
declare
  v_room record;
begin
  select * into v_room
  from game.poll_p2p_room_v1(
    (select game_session_token from scheme_b_session),
    (select room_id from scheme_b_p2p_room),
    0
  );

  if v_room.room_code !~ '^[A-HJ-NP-Z2-9]{6}$'
     or v_room.member_id <> v_room.host_member_id
     or v_room.room_status <> 'lobby'
     or pg_catalog.jsonb_array_length(v_room.members) <> 1
     or not (v_room.members -> 0 ->> 'ready')::boolean then
    raise exception 'P2P room creation or polling contract is incorrect';
  end if;

  begin
    perform game.start_p2p_room_v1(
      (select game_session_token from scheme_b_session),
      v_room.room_id
    );
    raise exception 'a one-player P2P lobby was started';
  exception when sqlstate '22000' then
    null;
  end;

  begin
    perform * from game.poll_p2p_room_v1(
      'forged-session-that-is-long-enough-to-pass-shape-validation-0000',
      v_room.room_id,
      0
    );
    raise exception 'forged Games session accessed P2P signaling';
  exception when sqlstate '28000' then
    null;
  end;
end
$assert_p2p_room$;

select game.end_p2p_room_v1(
  (select game_session_token from scheme_b_session),
  (select room_id from scheme_b_p2p_room)
);

reset role;

create temporary table scheme_b_expired_ticket (
  launch_ticket text not null,
  expires_at timestamptz not null,
  assignment_id uuid
);
grant insert, select on scheme_b_expired_ticket to authenticated;
set local role authenticated;
insert into scheme_b_expired_ticket
select * from public.issue_game_launch_ticket_v1(
  (select game_assignment_id from scheme_b_game),
  '50000000-0000-4000-8000-000000000007',
  'ccccccccccccccccccccccccccccccccccccccccccc'
);
reset role;
grant select on scheme_b_expired_ticket to game_api_owner;
set local role game_api_owner;
update game_private.launch_tickets
set created_at = now() - interval '61 seconds',
    expires_at = now() - interval '1 second'
where token_hash = pg_catalog.sha256(pg_catalog.convert_to(
  (select launch_ticket from scheme_b_expired_ticket), 'UTF8'
));
reset role;
grant select on scheme_b_expired_ticket to games_api;
set local role games_api;

do $assert_expired$
begin
  begin
    perform * from game.redeem_game_launch_ticket_v1(
      (select launch_ticket from scheme_b_expired_ticket),
      '50000000-0000-4000-8000-000000000008'
    );
    raise exception 'expired ticket was redeemed';
  exception when sqlstate '28000' then
    null;
  end;
end
$assert_expired$;

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
create temporary table scheme_b_version_2 (version_2_id uuid not null);
grant insert, select on scheme_b_version_2 to authenticated;
set local role authenticated;
insert into scheme_b_version_2
select public.set_game_unlock_requirements_v1(
  (select game_assignment_id from scheme_b_game),
  array[(select id from scheme_b_assignables where assignable_kind = 'plain')],
  '50000000-0000-4000-8000-000000000009'
);
reset role;

do $assert_version_switch$
begin
  if (select version_no from public.game_assignment_versions
      where id = (select version_2_id from scheme_b_version_2)) <> 2 then
    raise exception 'requirement edit did not create version 2';
  end if;
  if not exists (
    select 1 from game_private.game_auth_sessions
    where assignment_id = (select game_assignment_id from scheme_b_game)
      and revoked_at is not null
  ) then
    raise exception 'version switch did not revoke the existing game session';
  end if;
end
$assert_version_switch$;

do $assert_grants$
begin
  if not pg_catalog.has_function_privilege(
    'authenticated', 'public.get_game_access_status(uuid)', 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'games_api', 'game.redeem_game_launch_ticket_v1(text,uuid)', 'EXECUTE'
  ) or (
    pg_catalog.to_regprocedure('game.validate_game_session_v2(text)') is not null
    and not pg_catalog.has_function_privilege(
      'games_api', 'game.validate_game_session_v2(text)', 'EXECUTE'
    )
  ) or not pg_catalog.has_function_privilege(
    'games_api',
    'game.finalize_game_attempt_v1(text,uuid,uuid,text,text,integer,integer,boolean,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'required RPC grant is missing';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.assignables', 'SELECT')
     or pg_catalog.has_schema_privilege('authenticated', 'game', 'USAGE')
     or pg_catalog.has_table_privilege('games_api', 'game_private.launch_tickets', 'SELECT')
     or pg_catalog.has_schema_privilege('game_server', 'game', 'USAGE') then
    raise exception 'a runtime role received forbidden direct access';
  end if;
end
$assert_grants$;

do $test_role_membership$
begin
  execute pg_catalog.format('revoke games_api from %I', current_user);
  execute pg_catalog.format('revoke game_api_owner from %I', current_user);
  execute pg_catalog.format('revoke authenticated from %I', current_user);
end
$test_role_membership$;

select 'game_unlock_scheme_b PASS' as result;
