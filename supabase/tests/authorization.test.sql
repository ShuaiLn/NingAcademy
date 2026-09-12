begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

create schema test_support;

create function test_support.capture_sqlstate(p_sql text)
returns text
language plpgsql
set search_path = ''
as $$
begin
  execute p_sql;
  return null;
exception
  when others then
    return sqlstate;
end;
$$;

create function test_support.capture_row_count(p_sql text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_row_count bigint;
begin
  execute p_sql;
  get diagnostics v_row_count = row_count;
  return v_row_count;
end;
$$;

grant usage on schema extensions, test_support to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;
grant execute on function test_support.capture_sqlstate(text) to anon, authenticated, service_role;
grant execute on function test_support.capture_row_count(text) to anon, authenticated, service_role;

select plan(98);

-- Synthetic identities. Authentication is simulated with the same database
-- role and request.jwt.claim.* settings PostgREST uses; no login or password
-- change is performed.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'auth-test-teacher-a@users.ningacademy.internal',
    'not-used',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'auth-test-teacher-b@users.ningacademy.internal',
    'not-used',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'auth-test-student-a@users.ningacademy.internal',
    'not-used',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'auth-test-student-b@users.ningacademy.internal',
    'not-used',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '20000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'auth-test-service-created@users.ningacademy.internal',
    'not-used',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.profiles (
  id, username, full_name, role, is_active, must_change_password
)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'auth_test_teacher_a',
    'Authorization Test Teacher A',
    'teacher',
    true,
    false
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'auth_test_teacher_b',
    'Authorization Test Teacher B',
    'teacher',
    true,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000001',
    'auth_test_student_a',
    'Authorization Test Student A',
    'student',
    true,
    false
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'auth_test_student_b',
    'Authorization Test Student B',
    'student',
    true,
    false
  );

insert into public.teachers (id)
values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002');

insert into public.students (id, teacher_id)
values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002'
  );

insert into public.assignments (id, teacher_id, title, description)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Authorization targeted assignment',
    'Published and targeted during the test.'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'Authorization private assignment',
    'Must remain visible only to its owner.'
  );

insert into public.vocabulary_sets (
  id,
  teacher_id,
  title,
  description,
  published_at,
  practice_engine_version
)
values (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Authorization vocabulary set',
  'Disposable v1 practice fixture.',
  now(),
  1
);

insert into public.vocabulary_words (
  id, set_id, term, meaning, sort_order
)
values (
  '60000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  'hello',
  'greeting',
  0
);

insert into public.vocabulary_targets (set_id, student_id)
values (
  '50000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001'
);

insert into public.practice_sessions (
  id, student_id, set_id, total_words, practice_engine_version
)
values (
  '70000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  1,
  1
);

insert into public.practice_session_words (
  session_id,
  word_id,
  sort_order,
  prompt_text,
  correct_answer
)
values (
  '70000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  0,
  'greeting',
  'hello'
);

-- Audit-table catalog contract after NA-SEC-001.
select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'audit_log'
  ),
  'audit_log keeps RLS enabled'
);

select ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.audit_log', 'INSERT'
  ),
  'authenticated has no direct audit_log INSERT privilege'
);

select ok(
  not pg_catalog.has_table_privilege('anon', 'public.audit_log', 'INSERT'),
  'anon has no direct audit_log INSERT privilege'
);

select ok(
  pg_catalog.has_table_privilege('service_role', 'public.audit_log', 'INSERT'),
  'service_role keeps its explicit audit_log INSERT privilege'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'audit_log'
      and cmd = 'INSERT'
      and (
        'authenticated'::name = any (roles)
        or 'public'::name = any (roles)
      )
  ),
  0::bigint,
  'no INSERT policy is reachable by authenticated through its role or PUBLIC'
);

-- Teacher A: owning assignment operations and trusted audit RPC writes.
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  current_user,
  'authenticated'::name,
  'Teacher A tests run as the authenticated database role'
);

select is(
  (select auth.uid()),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'Teacher A auth.uid() context is active'
);

select is(
  (
    select count(*)
    from public.assignments
    where id = '30000000-0000-0000-0000-000000000002'
  ),
  1::bigint,
  'Teacher A can read their private assignment'
);

update public.assignments
set title = 'Authorization private assignment updated by owner'
where id = '30000000-0000-0000-0000-000000000002';

select is(
  (
    select title
    from public.assignments
    where id = '30000000-0000-0000-0000-000000000002'
  ),
  'Authorization private assignment updated by owner'::text,
  'Teacher A can directly update an allowed column on their assignment'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.publish_assignment(
        '30000000-0000-0000-0000-000000000001'::uuid
      )
    $sql$
  ),
  null::text,
  'Teacher A can publish their valid assignment'
);

select ok(
  (
    select published_at is not null
    from public.assignments
    where id = '30000000-0000-0000-0000-000000000001'
  ),
  'publish_assignment changes the owner assignment to published'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.assign_assignment_to_targets(
        '30000000-0000-0000-0000-000000000001'::uuid,
        null::uuid[],
        array['20000000-0000-0000-0000-000000000001'::uuid]
      )
    $sql$
  ),
  null::text,
  'Teacher A can target their assignment to Student A'
);

select is(
  (
    select count(*)
    from public.assignment_targets
    where assignment_id = '30000000-0000-0000-0000-000000000001'
      and student_id = '20000000-0000-0000-0000-000000000001'
      and revoked_at is null
  ),
  1::bigint,
  'the legitimate assignment target is visible to Teacher A'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.assign_assignment_to_targets(
        '30000000-0000-0000-0000-000000000001'::uuid,
        null::uuid[],
        array['20000000-0000-0000-0000-000000000002'::uuid]
      )
    $sql$
  ),
  '42501',
  'Teacher A cannot target a student owned by Teacher B'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      insert into public.audit_log (
        actor_user_id,
        actor_type,
        action,
        target_table,
        request_id,
        outcome,
        detail
      ) values (
        '10000000-0000-0000-0000-000000000001'::uuid,
        'student',
        'fabricated.teacher.event',
        'assignments',
        '80000000-0000-0000-0000-000000000001'::uuid,
        'succeeded',
        '{"fabricated":true}'::jsonb
      )
    $sql$
  ),
  '42501',
  'Teacher A cannot fabricate an audit row through direct INSERT'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.complete_password_change(
        '81000000-0000-0000-0000-000000000001'::uuid
      )
    $sql$
  ),
  null::text,
  'Teacher A can use a legitimate SECURITY DEFINER audit writer'
);

-- Teacher B: every cross-teacher assignment path stays denied.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select auth.uid()),
  '10000000-0000-0000-0000-000000000002'::uuid,
  'Teacher B auth.uid() context is active'
);

select is(
  (
    select count(*)
    from public.assignments
    where id = '30000000-0000-0000-0000-000000000002'
  ),
  0::bigint,
  'Teacher B cannot read Teacher A private assignment'
);

select is(
  (
    select count(*)
    from public.assignments
    where id = '30000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'Teacher B cannot read Teacher A published targeted assignment'
);

select is(
  test_support.capture_row_count(
    $sql$
      update public.assignments
      set title = 'forged cross-teacher update'
      where id = '30000000-0000-0000-0000-000000000001'
    $sql$
  ),
  0::bigint,
  'Teacher B cannot directly update Teacher A assignment'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.assignments
      where id = '30000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Teacher B cannot directly delete Teacher A assignment'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.publish_assignment(
        '30000000-0000-0000-0000-000000000001'::uuid
      )
    $sql$
  ),
  '42501',
  'Teacher B cannot publish Teacher A assignment'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.assign_assignment_to_targets(
        '30000000-0000-0000-0000-000000000001'::uuid,
        null::uuid[],
        array['20000000-0000-0000-0000-000000000002'::uuid]
      )
    $sql$
  ),
  '42501',
  'Teacher B cannot change targeting on Teacher A assignment'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      insert into public.audit_log (
        actor_user_id,
        actor_type,
        action,
        target_table,
        request_id,
        outcome,
        detail
      ) values (
        '10000000-0000-0000-0000-000000000002'::uuid,
        'system',
        'fabricated.system.event',
        'profiles',
        '80000000-0000-0000-0000-000000000002'::uuid,
        'failed',
        '{"fabricated":true}'::jsonb
      )
    $sql$
  ),
  '42501',
  'Teacher B cannot fabricate an audit row through direct INSERT'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.complete_password_change(
        '81000000-0000-0000-0000-000000000002'::uuid
      )
    $sql$
  ),
  null::text,
  'Teacher B can use a legitimate SECURITY DEFINER audit writer'
);

-- Student A: targeted assignment, own submission/session, and no teacher
-- mutation or audit-forgery capability.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select auth.uid()),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'Student A auth.uid() context is active'
);

select is(
  (
    select count(*)
    from public.assignments
    where id = '30000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'Student A can read the published assignment legitimately targeted to them'
);

select is(
  (
    select count(*)
    from public.assignments
    where id = '30000000-0000-0000-0000-000000000002'
  ),
  0::bigint,
  'Student A cannot read Teacher A unassigned private assignment'
);

select is(
  test_support.capture_row_count(
    $sql$
      update public.assignments
      set title = 'forged student update'
      where id = '30000000-0000-0000-0000-000000000001'
    $sql$
  ),
  0::bigint,
  'Student A cannot directly update a teacher assignment'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.assignments
      where id = '30000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Student A cannot directly delete a teacher assignment'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.publish_assignment(
        '30000000-0000-0000-0000-000000000001'::uuid
      )
    $sql$
  ),
  '42501',
  'Student A cannot invoke publish_assignment successfully'
);

do $test$
begin
  perform public.create_submission(
    '30000000-0000-0000-0000-000000000001'::uuid,
    'Student A authorization fixture'
  );
end;
$test$;

select is(
  (
    select student_id
    from public.submissions
    where assignment_id = '30000000-0000-0000-0000-000000000001'
      and student_id = '20000000-0000-0000-0000-000000000001'
  ),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'create_submission derives Student A identity from auth.uid()'
);

select is(
  (
    select count(*)
    from public.submissions
    where assignment_id = '30000000-0000-0000-0000-000000000001'
      and student_id = '20000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'Student A can read their own submission'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.create_submission(
        '30000000-0000-0000-0000-000000000002'::uuid,
        'not assigned'
      )
    $sql$
  ),
  '42501',
  'Student A cannot create a submission for an unassigned private assignment'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      insert into public.submissions (
        assignment_id, student_id, attempt_no, note
      ) values (
        '30000000-0000-0000-0000-000000000001'::uuid,
        '20000000-0000-0000-0000-000000000002'::uuid,
        99,
        'forged Student B identity'
      )
    $sql$
  ),
  '42501',
  'Student A cannot directly forge a submission for Student B'
);

select is(
  test_support.capture_row_count(
    $sql$
      update public.submissions
      set score = 100
      where assignment_id = '30000000-0000-0000-0000-000000000001'
        and student_id = '20000000-0000-0000-0000-000000000001'
    $sql$
  ),
  0::bigint,
  'Student A cannot directly grade their submission'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.submissions
      where assignment_id = '30000000-0000-0000-0000-000000000001'
        and student_id = '20000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Student A cannot directly delete their submission'
);

select is(
  (
    select count(*)
    from public.practice_sessions
    where id = '70000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'Student A can read their own practice session'
);

select is(
  (
    select count(*)
    from public.get_practice_words(
      '70000000-0000-0000-0000-000000000001'::uuid
    )
  ),
  1::bigint,
  'Student A can read frozen prompts through get_practice_words'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      update public.practice_sessions
      set completed_at = now()
      where id = '70000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Student A cannot directly update a practice session'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.practice_sessions
      where id = '70000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Student A cannot directly delete a practice session'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      insert into public.audit_log (
        actor_user_id,
        actor_type,
        action,
        target_table,
        request_id,
        outcome,
        detail
      ) values (
        '20000000-0000-0000-0000-000000000001'::uuid,
        'system',
        'fabricated.student.event',
        'audit_log',
        '80000000-0000-0000-0000-000000000003'::uuid,
        'succeeded',
        '{"actor_type":"forged","detail":"arbitrary"}'::jsonb
      )
    $sql$
  ),
  '42501',
  'Student A cannot fabricate arbitrary audit fields through direct INSERT'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.complete_password_change(
        '81000000-0000-0000-0000-000000000003'::uuid
      )
    $sql$
  ),
  null::text,
  'Student A can use a legitimate SECURITY DEFINER audit writer'
);

-- Student B: unrelated assignment, submission, and practice data stay hidden.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-0000-0000-000000000002';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select auth.uid()),
  '20000000-0000-0000-0000-000000000002'::uuid,
  'Student B auth.uid() context is active'
);

select is(
  (
    select count(*)
    from public.assignments
    where id = '30000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'Student B cannot read an assignment targeted only to Student A'
);

select is(
  (
    select count(*)
    from public.submissions
    where assignment_id = '30000000-0000-0000-0000-000000000001'
      and student_id = '20000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'Student B cannot read Student A submission'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.create_submission(
        '30000000-0000-0000-0000-000000000001'::uuid,
        'unrelated student attempt'
      )
    $sql$
  ),
  '42501',
  'Student B cannot create a submission for Student A targeted assignment'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      insert into public.submissions (
        assignment_id, student_id, attempt_no, note
      ) values (
        '30000000-0000-0000-0000-000000000001'::uuid,
        '20000000-0000-0000-0000-000000000001'::uuid,
        99,
        'forged Student A identity'
      )
    $sql$
  ),
  '42501',
  'Student B cannot directly create a submission for Student A'
);

select is(
  test_support.capture_row_count(
    $sql$
      update public.submissions
      set score = 0
      where assignment_id = '30000000-0000-0000-0000-000000000001'
        and student_id = '20000000-0000-0000-0000-000000000001'
    $sql$
  ),
  0::bigint,
  'Student B cannot directly update Student A submission'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.submissions
      where assignment_id = '30000000-0000-0000-0000-000000000001'
        and student_id = '20000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Student B cannot directly delete Student A submission'
);

select is(
  (
    select count(*)
    from public.practice_sessions
    where id = '70000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'Student B cannot read Student A practice session'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select *
      from public.get_practice_words(
        '70000000-0000-0000-0000-000000000001'::uuid
      )
    $sql$
  ),
  '42501',
  'Student B cannot call get_practice_words for Student A session'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      update public.practice_sessions
      set completed_at = now()
      where id = '70000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Student B cannot directly update Student A practice session'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.practice_sessions
      where id = '70000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Student B cannot directly delete Student A practice session'
);

-- Anonymous: protected tables and reviewed RPCs fail with insufficient
-- privilege, including the PostgreSQL 42501 SQLSTATE.
reset role;
set local role anon;
set local "request.jwt.claim.sub" = '';
set local "request.jwt.claim.role" = 'anon';
set local "request.jwt.claims" = '{"role":"anon"}';

select is(current_user, 'anon'::name, 'anonymous tests run as the anon role');
select ok((select auth.uid()) is null, 'anonymous auth.uid() is null');

select is(
  test_support.capture_sqlstate(
    $sql$select * from public.assignments$sql$
  ),
  '42501',
  'anonymous cannot read assignments'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      update public.assignments
      set title = 'anonymous update'
      where id = '30000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'anonymous cannot update assignments'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.assignments
      where id = '30000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'anonymous cannot delete assignments'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.publish_assignment(
        '30000000-0000-0000-0000-000000000001'::uuid
      )
    $sql$
  ),
  '42501',
  'anonymous cannot invoke publish_assignment'
);

select is(
  test_support.capture_sqlstate(
    $sql$select * from public.submissions$sql$
  ),
  '42501',
  'anonymous cannot read submissions'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      update public.submissions
      set score = 100
      where assignment_id = '30000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'anonymous cannot update submissions'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.submissions
      where assignment_id = '30000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'anonymous cannot delete submissions'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.create_submission(
        '30000000-0000-0000-0000-000000000001'::uuid,
        'anonymous attempt'
      )
    $sql$
  ),
  '42501',
  'anonymous cannot invoke create_submission'
);

select is(
  test_support.capture_sqlstate(
    $sql$select * from public.practice_sessions$sql$
  ),
  '42501',
  'anonymous cannot read practice_sessions'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      update public.practice_sessions
      set completed_at = now()
      where id = '70000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'anonymous cannot update practice_sessions'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.practice_sessions
      where id = '70000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'anonymous cannot delete practice_sessions'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select *
      from public.get_practice_words(
        '70000000-0000-0000-0000-000000000001'::uuid
      )
    $sql$
  ),
  '42501',
  'anonymous cannot invoke get_practice_words'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      insert into public.audit_log (
        actor_user_id,
        actor_type,
        action,
        target_table,
        request_id,
        outcome,
        detail
      ) values (
        null,
        'system',
        'fabricated.anonymous.event',
        'audit_log',
        '80000000-0000-0000-0000-000000000004'::uuid,
        'succeeded',
        '{"fabricated":true}'::jsonb
      )
    $sql$
  ),
  '42501',
  'anonymous cannot directly insert audit_log rows'
);

-- Verify the audit rows produced through SECURITY DEFINER functions before
-- exercising submission grading and service-role paths.
reset role;

select is(
  (
    select count(*)
    from public.audit_log
    where actor_user_id = '10000000-0000-0000-0000-000000000001'
      and request_id = '81000000-0000-0000-0000-000000000001'
      and action = 'change_password'
      and outcome = 'succeeded'
  ),
  1::bigint,
  'Teacher A SECURITY DEFINER audit event was written'
);

select is(
  (
    select count(*)
    from public.audit_log
    where actor_user_id = '10000000-0000-0000-0000-000000000002'
      and request_id = '81000000-0000-0000-0000-000000000002'
      and action = 'change_password'
      and outcome = 'succeeded'
  ),
  1::bigint,
  'Teacher B SECURITY DEFINER audit event was written'
);

select is(
  (
    select count(*)
    from public.audit_log
    where actor_user_id = '20000000-0000-0000-0000-000000000001'
      and request_id = '81000000-0000-0000-0000-000000000003'
      and action = 'change_password'
      and outcome = 'succeeded'
  ),
  1::bigint,
  'Student A SECURITY DEFINER audit event was written'
);

update public.submissions
set submitted_at = now()
where assignment_id = '30000000-0000-0000-0000-000000000001'
  and student_id = '20000000-0000-0000-0000-000000000001';

-- Teacher A: intended owning-teacher submission/session access works.
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select auth.uid()),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'Teacher A auth.uid() is restored for submission and session tests'
);

select is(
  (
    select count(*)
    from public.submissions
    where assignment_id = '30000000-0000-0000-0000-000000000001'
      and student_id = '20000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'Teacher A can read their student submission'
);

select is(
  test_support.capture_row_count(
    $sql$
      update public.submissions
      set score = 95
      where assignment_id = '30000000-0000-0000-0000-000000000001'
        and student_id = '20000000-0000-0000-0000-000000000001'
    $sql$
  ),
  1::bigint,
  'Teacher A can grade their submitted student work'
);

select is(
  (
    select score
    from public.submissions
    where assignment_id = '30000000-0000-0000-0000-000000000001'
      and student_id = '20000000-0000-0000-0000-000000000001'
  ),
  95::numeric,
  'Teacher A grading update persisted inside the disposable transaction'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.submissions
      where assignment_id = '30000000-0000-0000-0000-000000000001'
        and student_id = '20000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Teacher A cannot directly delete a submission'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.create_submission(
        '30000000-0000-0000-0000-000000000001'::uuid,
        'teacher impersonation attempt'
      )
    $sql$
  ),
  '28000',
  'Teacher A cannot use create_submission as a student'
);

select is(
  (
    select count(*)
    from public.practice_sessions
    where id = '70000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'Teacher A can read their student practice session'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select *
      from public.get_practice_words(
        '70000000-0000-0000-0000-000000000001'::uuid
      )
    $sql$
  ),
  '42501',
  'get_practice_words remains restricted to the owning student'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      update public.practice_sessions
      set completed_at = now()
      where id = '70000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Teacher A cannot directly update a practice session'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.practice_sessions
      where id = '70000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Teacher A cannot directly delete a practice session'
);

-- Teacher B: unrelated submission and practice-session access stays denied.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select auth.uid()),
  '10000000-0000-0000-0000-000000000002'::uuid,
  'Teacher B auth.uid() is restored for submission and session tests'
);

select is(
  (
    select count(*)
    from public.submissions
    where assignment_id = '30000000-0000-0000-0000-000000000001'
      and student_id = '20000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'Teacher B cannot read Teacher A student submission'
);

select is(
  test_support.capture_row_count(
    $sql$
      update public.submissions
      set score = 0
      where assignment_id = '30000000-0000-0000-0000-000000000001'
        and student_id = '20000000-0000-0000-0000-000000000001'
    $sql$
  ),
  0::bigint,
  'Teacher B cannot grade Teacher A student submission'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.submissions
      where assignment_id = '30000000-0000-0000-0000-000000000001'
        and student_id = '20000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Teacher B cannot directly delete Teacher A student submission'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select public.create_submission(
        '30000000-0000-0000-0000-000000000001'::uuid,
        'teacher impersonation attempt'
      )
    $sql$
  ),
  '28000',
  'Teacher B cannot use create_submission on behalf of Student A'
);

select is(
  (
    select count(*)
    from public.practice_sessions
    where id = '70000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'Teacher B cannot read Teacher A student practice session'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      select *
      from public.get_practice_words(
        '70000000-0000-0000-0000-000000000001'::uuid
      )
    $sql$
  ),
  '42501',
  'Teacher B cannot call get_practice_words for Student A session'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      update public.practice_sessions
      set completed_at = now()
      where id = '70000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Teacher B cannot directly update Student A practice session'
);

select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.practice_sessions
      where id = '70000000-0000-0000-0000-000000000001'
    $sql$
  ),
  '42501',
  'Teacher B cannot directly delete Student A practice session'
);

-- service_role remains a trusted direct writer and retains access to the
-- service-only SECURITY DEFINER student-finalization path.
reset role;
set local role service_role;
set local "request.jwt.claim.sub" = '';
set local "request.jwt.claim.role" = 'service_role';
set local "request.jwt.claims" = '{"role":"service_role"}';

select is(
  current_user,
  'service_role'::name,
  'trusted-writer tests run as service_role'
);

select ok((select auth.uid()) is null, 'service_role test has no forged user identity');

select is(
  test_support.capture_sqlstate(
    $sql$
      insert into public.audit_log (
        actor_user_id,
        actor_type,
        action,
        target_table,
        request_id,
        outcome,
        detail
      ) values (
        null,
        'system',
        'authorization_test.service_writer',
        'audit_log',
        '82000000-0000-0000-0000-000000000001'::uuid,
        'succeeded',
        '{"trusted":true}'::jsonb
      )
    $sql$
  ),
  null::text,
  'service_role can still insert a trusted audit event directly'
);

select is(
  public.finalize_student_creation(
    '20000000-0000-0000-0000-000000000003'::uuid,
    'auth_test_service_created',
    'Authorization Test Service-Created Student',
    '10000000-0000-0000-0000-000000000001'::uuid,
    '82000000-0000-0000-0000-000000000002'::uuid
  ),
  true,
  'service_role can still invoke the trusted student-finalization writer'
);

reset role;

select is(
  (
    select count(*)
    from public.audit_log
    where request_id = '82000000-0000-0000-0000-000000000001'
      and action = 'authorization_test.service_writer'
      and outcome = 'succeeded'
  ),
  1::bigint,
  'the service_role direct audit event exists inside the test transaction'
);

select is(
  (
    select count(*)
    from public.students
    where id = '20000000-0000-0000-0000-000000000003'
      and teacher_id = '10000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'the trusted finalizer created the synthetic student for Teacher A'
);

select is(
  (
    select count(*)
    from public.audit_log
    where actor_user_id = '10000000-0000-0000-0000-000000000001'
      and target_id = '20000000-0000-0000-0000-000000000003'
      and request_id = '82000000-0000-0000-0000-000000000002'
      and action = 'student_create'
      and outcome = 'succeeded'
  ),
  1::bigint,
  'the trusted finalizer still writes its legitimate audit event'
);

select * from finish();
rollback;
