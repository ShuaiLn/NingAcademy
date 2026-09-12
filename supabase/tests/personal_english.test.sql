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

grant usage on schema extensions, test_support to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;
grant execute on function test_support.capture_sqlstate(text)
  to anon, authenticated, service_role;

select no_plan();

-- Synthetic identities only. No login, password change, hosted database, or
-- Production data is involved in this disposable-test transaction.
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
    '11000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'personal-english-teacher@users.ningacademy.internal',
    'not-used',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '21000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'personal-english-student-a@users.ningacademy.internal',
    'not-used',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '21000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'personal-english-student-b@users.ningacademy.internal',
    'not-used',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.profiles (
  id,
  username,
  full_name,
  role,
  is_active,
  must_change_password
)
values
  (
    '11000000-0000-0000-0000-000000000001',
    'personal_english_teacher',
    'Personal English Teacher',
    'teacher',
    true,
    false
  ),
  (
    '21000000-0000-0000-0000-000000000001',
    'personal_english_student_a',
    'Personal English Student A',
    'student',
    true,
    false
  ),
  (
    '21000000-0000-0000-0000-000000000002',
    'personal_english_student_b',
    'Personal English Student B',
    'student',
    true,
    false
  );

insert into public.teachers (id)
values ('11000000-0000-0000-0000-000000000001');

insert into public.students (id, teacher_id)
values
  (
    '21000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001'
  ),
  (
    '21000000-0000-0000-0000-000000000002',
    '11000000-0000-0000-0000-000000000001'
  );

insert into public.vocabulary_sets (
  id,
  teacher_id,
  title,
  published_at,
  practice_engine_version
)
values
  (
    '51000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    'Personal English visible vocabulary',
    now(),
    1
  ),
  (
    '51000000-0000-0000-0000-000000000002',
    '11000000-0000-0000-0000-000000000001',
    'Personal English private vocabulary',
    null,
    1
  );

insert into public.vocabulary_words (id, set_id, term, meaning, sort_order)
values
  (
    '61000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001',
    'appointment',
    '预约',
    0
  ),
  (
    '61000000-0000-0000-0000-000000000002',
    '51000000-0000-0000-0000-000000000002',
    'private',
    '私人的',
    0
  );

insert into public.vocabulary_targets (set_id, student_id)
values (
  '51000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001'
);

insert into public.pronunciation_tasks (
  id,
  teacher_id,
  title,
  published_at
)
values (
  '71000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Personal English pronunciation fixture',
  now()
);

insert into public.pronunciation_task_words (
  id,
  task_id,
  text_prompt,
  sort_order
)
values (
  '72000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  'Make an appointment',
  0
);

insert into public.pronunciation_targets (task_id, student_id)
values (
  '71000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001'
);

-- Direct table writes are unavailable to authenticated; both tables retain
-- RLS even though authenticated receives only SELECT.
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.personal_words',
    'INSERT'
  ),
  'authenticated cannot INSERT personal_words directly'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.personal_words',
    'UPDATE'
  ),
  'authenticated cannot UPDATE personal_words directly'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.personal_words',
    'DELETE'
  ),
  'authenticated cannot DELETE personal_words directly'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.personal_word_sources',
    'INSERT'
  ),
  'authenticated cannot INSERT personal_word_sources directly'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.personal_word_sources',
    'UPDATE'
  ),
  'authenticated cannot UPDATE personal_word_sources directly'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.personal_word_sources',
    'DELETE'
  ),
  'authenticated cannot DELETE personal_word_sources directly'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.personal_words'::pg_catalog.regclass
  ),
  'personal_words has RLS enabled'
);
select ok(
  (
    select relation.relrowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'public.personal_word_sources'::pg_catalog.regclass
  ),
  'personal_word_sources has RLS enabled'
);

-- Teacher identity sanity.
set local role authenticated;
set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  current_user,
  'authenticated'::name,
  'teacher tests run as authenticated'
);
select is(
  (select auth.uid()),
  '11000000-0000-0000-0000-000000000001'::uuid,
  'teacher auth.uid() context is active'
);

-- Student A owns the first library row and all attached provenance.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '21000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  current_user,
  'authenticated'::name,
  'Student A tests run as authenticated'
);
select is(
  (select auth.uid()),
  '21000000-0000-0000-0000-000000000001'::uuid,
  'Student A auth.uid() context is active'
);

select is(
  test_support.capture_sqlstate(
    $sql$select public.upsert_personal_word_v1('Apple', '苹果')$sql$
  ),
  null::text,
  'Student A can add a personal word'
);
select is(
  (
    select count(*)
    from public.personal_words
    where normalized_term = 'apple'
  ),
  1::bigint,
  'the normalized term is stored once'
);
select is(
  test_support.capture_sqlstate(
    $sql$select public.upsert_personal_word_v1(' apple ', '苹果（水果）')$sql$
  ),
  null::text,
  'Student A can re-add a differently formatted duplicate'
);
select is(
  (
    select count(*)
    from public.personal_words
    where normalized_term = 'apple'
  ),
  1::bigint,
  'normalized re-add does not create a duplicate row'
);
select is(
  (
    select meaning
    from public.personal_words
    where normalized_term = 'apple'
  ),
  '苹果（水果）'::text,
  'a nonblank re-add patches meaning'
);
select is(
  test_support.capture_sqlstate(
    $sql$select public.upsert_personal_word_v1('APPLE', '   ')$sql$
  ),
  null::text,
  'Student A can re-add with blank meaning'
);
select is(
  (
    select meaning
    from public.personal_words
    where normalized_term = 'apple'
  ),
  '苹果（水果）'::text,
  'blank meaning preserves the existing meaning'
);

-- Keep the generated word id in a transaction-local setting so later actor
-- tests can pass the real id without relying on RLS-invisible subqueries.
select set_config('test.personal_word_id', id::text, true)
from public.personal_words
where normalized_term = 'apple';

select is(
  test_support.capture_sqlstate(
    pg_catalog.format(
      'select public.attach_personal_word_source_v1(%L::uuid, %L, null)',
      current_setting('test.personal_word_id'),
      'self_added'
    )
  ),
  null::text,
  'Student A can attach self_added provenance'
);
select is(
  test_support.capture_sqlstate(
    pg_catalog.format(
      'select public.attach_personal_word_source_v1(%L::uuid, %L, null)',
      current_setting('test.personal_word_id'),
      'self_added'
    )
  ),
  null::text,
  'attaching self_added provenance twice is idempotent'
);
select is(
  (
    select count(*)
    from public.personal_word_sources
    where personal_word_id = current_setting('test.personal_word_id')::uuid
      and source_type = 'self_added'
  ),
  1::bigint,
  'self_added provenance has exactly one row'
);

select is(
  test_support.capture_sqlstate(
    pg_catalog.format(
      'select public.attach_personal_word_source_v1(%L::uuid, %L, %L::uuid)',
      current_setting('test.personal_word_id'),
      'self_added',
      '61000000-0000-0000-0000-000000000001'
    )
  ),
  '22023',
  'self_added rejects a non-null source id'
);
select is(
  test_support.capture_sqlstate(
    pg_catalog.format(
      'select public.attach_personal_word_source_v1(%L::uuid, %L, null)',
      current_setting('test.personal_word_id'),
      'teacher_vocabulary_word'
    )
  ),
  '22023',
  'teacher vocabulary provenance requires a source id'
);
select is(
  test_support.capture_sqlstate(
    pg_catalog.format(
      'select public.attach_personal_word_source_v1(%L::uuid, null, null)',
      current_setting('test.personal_word_id')
    )
  ),
  '22023',
  'a null source type is rejected as unknown'
);
select is(
  test_support.capture_sqlstate(
    pg_catalog.format(
      'select public.attach_personal_word_source_v1(%L::uuid, %L, %L::uuid)',
      current_setting('test.personal_word_id'),
      'teacher_vocabulary_word',
      '61000000-0000-0000-0000-000000000002'
    )
  ),
  '42501',
  'Student A cannot cite an unpublished untargeted vocabulary word'
);

-- Student B identity sanity and cross-student mutation denial.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '21000000-0000-0000-0000-000000000002';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"21000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  current_user,
  'authenticated'::name,
  'Student B tests run as authenticated'
);
select is(
  (select auth.uid()),
  '21000000-0000-0000-0000-000000000002'::uuid,
  'Student B auth.uid() context is active'
);
select is(
  test_support.capture_sqlstate(
    pg_catalog.format(
      'select public.attach_personal_word_source_v1(%L::uuid, %L, null)',
      current_setting('test.personal_word_id'),
      'self_added'
    )
  ),
  '42501',
  'Student B cannot attach provenance to Student A word'
);
select is(
  test_support.capture_sqlstate(
    pg_catalog.format(
      'select public.archive_personal_word_v1(%L::uuid)',
      current_setting('test.personal_word_id')
    )
  ),
  '42501',
  'Student B cannot archive Student A word'
);

-- Student A may cite currently visible teacher-authored sources.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '21000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  test_support.capture_sqlstate(
    pg_catalog.format(
      'select public.attach_personal_word_source_v1(%L::uuid, %L, %L::uuid)',
      current_setting('test.personal_word_id'),
      'teacher_vocabulary_word',
      '61000000-0000-0000-0000-000000000001'
    )
  ),
  null::text,
  'Student A can cite a published targeted vocabulary word'
);
select is(
  (
    select count(*)
    from public.personal_word_sources
    where personal_word_id = current_setting('test.personal_word_id')::uuid
      and vocabulary_word_id = '61000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'teacher vocabulary provenance is stored once'
);

-- Delete as the migration-test executor, exactly as the existing
-- authorization suite transitions back before direct fixture maintenance.
reset role;
select is(
  test_support.capture_sqlstate(
    $sql$
      delete from public.vocabulary_words
      where id = '61000000-0000-0000-0000-000000000001'
    $sql$
  ),
  null::text,
  'deleting the cited vocabulary word does not violate the source CHECK'
);
select is(
  (
    select count(*)
    from public.personal_word_sources
    where personal_word_id = current_setting('test.personal_word_id')::uuid
      and source_type = 'teacher_vocabulary_word'
  ),
  1::bigint,
  'vocabulary provenance survives deletion of the cited word'
);
select ok(
  (
    select vocabulary_word_id is null
    from public.personal_word_sources
    where personal_word_id = current_setting('test.personal_word_id')::uuid
      and source_type = 'teacher_vocabulary_word'
  ),
  'surviving vocabulary provenance has a null source FK'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '21000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  test_support.capture_sqlstate(
    pg_catalog.format(
      'select public.attach_personal_word_source_v1(%L::uuid, %L, %L::uuid)',
      current_setting('test.personal_word_id'),
      'teacher_pronunciation_word',
      '72000000-0000-0000-0000-000000000001'
    )
  ),
  null::text,
  'Student A can cite a visible pronunciation task word'
);
select is(
  (
    select count(*)
    from public.personal_word_sources
    where personal_word_id = current_setting('test.personal_word_id')::uuid
      and pronunciation_task_word_id = '72000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'teacher pronunciation provenance is stored once'
);

select is(
  test_support.capture_sqlstate(
    pg_catalog.format(
      'select public.archive_personal_word_v1(%L::uuid)',
      current_setting('test.personal_word_id')
    )
  ),
  null::text,
  'Student A can archive their word'
);
select ok(
  (
    select archived_at is not null
    from public.personal_words
    where id = current_setting('test.personal_word_id')::uuid
  ),
  'archive sets archived_at'
);
select is(
  test_support.capture_sqlstate(
    $sql$select public.upsert_personal_word_v1(' apple ', null)$sql$
  ),
  null::text,
  're-adding an archived normalized term succeeds'
);
select is(
  (
    select count(*)
    from public.personal_words
    where normalized_term = 'apple'
      and archived_at is null
  ),
  1::bigint,
  're-add unarchives the same single row'
);

-- RLS isolation with the same normalized term owned independently by B.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '21000000-0000-0000-0000-000000000002';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"21000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  test_support.capture_sqlstate(
    $sql$select public.upsert_personal_word_v1('apple', 'B 的苹果')$sql$
  ),
  null::text,
  'Student B can create an independent normalized apple row'
);
select is(
  (
    select count(*)
    from public.personal_words
    where student_id = '21000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'Student B cannot see Student A word'
);
select is(
  (select count(*) from public.personal_word_sources),
  0::bigint,
  'Student B cannot see Student A source rows'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '21000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claims" = '{"sub":"21000000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (
    select count(*)
    from public.personal_words
    where student_id = '21000000-0000-0000-0000-000000000002'
  ),
  0::bigint,
  'Student A cannot see Student B word'
);

select * from finish();
rollback;
