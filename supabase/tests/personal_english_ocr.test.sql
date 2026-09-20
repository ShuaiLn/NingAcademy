begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
create schema test_support;
create function test_support.state(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return '00000'; exception when others then return sqlstate; end; $$;
grant usage on schema extensions, test_support to authenticated, anon;
grant execute on all functions in schema extensions, test_support to authenticated, anon;
select no_plan();

insert into auth.users(id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
select ('32000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid, 'authenticated', 'authenticated', 'ocr-test-' || n || '@example.invalid', 'not-used', '{}'::jsonb, '{}'::jsonb
from generate_series(1,6) n;
insert into public.profiles(id, username, full_name, role, is_active, must_change_password)
select ('32000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid, 'ocr_test_'||n, 'Synthetic OCR Test',
 case when n=1 then 'teacher' else 'student' end, n<>4, n=5 from generate_series(1,6) n;
insert into public.teachers(id) values ('32000000-0000-0000-0000-000000000001');
insert into public.students(id,teacher_id)
select ('32000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,'32000000-0000-0000-0000-000000000001'::uuid from generate_series(2,6) n;
select has_table('public','personal_word_ocr_imports','ledger exists');
select has_column('public','personal_word_sources','ocr_import_id','source import column');
select has_column('public','personal_word_sources','ocr_item_index','source ordinal column');
select col_type_is('public','personal_word_ocr_imports','payload_hash','bytea','digest is binary');
select col_type_is('public','personal_word_ocr_imports','confirmed_count','smallint','count uses bounded smallint');
select ok(exists(select 1 from pg_constraint where conrelid='public.personal_word_ocr_imports'::regclass
  and conname='personal_word_ocr_imports_payload_hash_length_check'),'digest constraint has governed name');
select ok(exists(select 1 from pg_constraint where conrelid='public.personal_word_ocr_imports'::regclass
  and conname='personal_word_ocr_imports_confirmed_count_check'),'count constraint has governed name');
select ok(obj_description('public.personal_word_ocr_imports'::regclass) like '%never photo, captured plaintext%','ledger privacy comment');
select ok(col_description('public.personal_word_sources'::regclass,(select attnum from pg_attribute where attrelid='public.personal_word_sources'::regclass and attname='ocr_item_index')) like '%ordinal%','ordinal comment');
select ok((select relrowsecurity from pg_class where oid='public.personal_word_ocr_imports'::regclass),'ledger RLS enabled');
select is((select count(*)::integer from pg_policy where polrelid='public.personal_word_ocr_imports'::regclass),1,'one combined SELECT policy');
select has_index('public','personal_word_sources','personal_word_sources_ocr_word_uidx','word/import unique index');
select has_index('public','personal_word_sources','personal_word_sources_ocr_item_uidx','import/ordinal unique index');
select ok((select indisunique and
  (select array_agg(a.attname order by k.ord) from unnest(i.indkey::smallint[]) with ordinality k(attnum,ord)
    join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum) = array['personal_word_id','ocr_import_id']::name[] and
  pg_get_expr(i.indpred,i.indrelid) = '((source_type = ''ocr_import''::text) AND (ocr_import_id IS NOT NULL))'
  from pg_index i where i.indexrelid='public.personal_word_sources_ocr_word_uidx'::regclass),
  'word/import index has exact uniqueness, columns, order, and predicate');
select ok((select indisunique and
  (select array_agg(a.attname order by k.ord) from unnest(i.indkey::smallint[]) with ordinality k(attnum,ord)
    join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum) = array['ocr_import_id','ocr_item_index']::name[] and
  pg_get_expr(i.indpred,i.indrelid) = '((source_type = ''ocr_import''::text) AND (ocr_import_id IS NOT NULL) AND (ocr_item_index IS NOT NULL))'
  from pg_index i where i.indexrelid='public.personal_word_sources_ocr_item_uidx'::regclass),
  'import/ordinal index has exact uniqueness, columns, order, and predicate');
select ok((select confdeltype='c' and confrelid='public.personal_word_ocr_imports'::regclass and
  (select array_agg(a.attname order by k.ord) from unnest(c.conkey) with ordinality k(attnum,ord)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum) = array['ocr_import_id']::name[] and
  (select array_agg(a.attname order by k.ord) from unnest(c.confkey) with ordinality k(attnum,ord)
    join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum) = array['id']::name[]
  from pg_constraint c where c.conname='personal_word_sources_ocr_import_id_fkey'),
  'source FK has exact source column, referenced table/column, and cascade');
select ok((select confdeltype='c' and confrelid='public.students'::regclass and
  (select array_agg(a.attname order by k.ord) from unnest(c.conkey) with ordinality k(attnum,ord)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum) = array['student_id']::name[] and
  (select array_agg(a.attname order by k.ord) from unnest(c.confkey) with ordinality k(attnum,ord)
    join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum) = array['id']::name[]
  from pg_constraint c where c.conname='personal_word_ocr_imports_student_id_fkey'),
  'ledger FK has exact source column, referenced table/column, and cascade');
select ok(not exists(select 1 from pg_constraint where conrelid='public.personal_word_sources'::regclass and not convalidated),'all source checks validated');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
 where oid in ('private.captured_text_has_high_confidence_pii_v1(text)'::regprocedure,'private.canonicalize_ocr_confirmation_text_v1(text)'::regprocedure,
 'private.set_personal_word_example(uuid,uuid,text,text)'::regprocedure,
 'private.attach_personal_word_ocr_source_v1(uuid,uuid,uuid,smallint)'::regprocedure,'public.upsert_personal_words_bulk_v1(uuid,jsonb)'::regprocedure)),'new functions secured');
-- BEGIN GENERATED NORMALIZATION PARITY (scripts/phase2/policy-governance.mjs)
select is(private.normalize_spelling(input), expected, 'Postgres/TypeScript normalization fixture: ' || label)
from jsonb_to_recordset($fixtures$[{"label":"ascii","input":"  Mixed   CASE  ","expected":"mixed case"},{"label":"newline","input":"line\nbreak","expected":"line break"},{"label":"tab","input":"tab\tspace","expected":"tab space"},{"label":"blank-spacing","input":"\t\r\n","expected":""},{"label":"NEL","input":"nelspace","expected":"nel space"},{"label":"em-space","input":"em space","expected":"em space"},{"label":"ideographic-space","input":"full　width","expected":"full width"},{"label":"NBSP-spacing","input":"nbsp gap","expected":"nbsp gap"},{"label":"figure-space-spacing","input":"figure space","expected":"figure space"},{"label":"narrow-NBSP-spacing","input":"narrow space","expected":"narrow space"},{"label":"leading-BOM-excluded","input":"﻿leading","expected":"﻿leading"},{"label":"trailing-BOM-excluded","input":"trailing﻿","expected":"trailing﻿"},{"label":"capital-I-dot","input":"İ","expected":"i̇"},{"label":"final-sigma","input":"ΟΣ","expected":"ος"},{"label":"interior-sigma","input":"ΟΣΑ","expected":"οσα"}]$fixtures$::jsonb)
  as fixtures(label text, input text, expected text);
-- END GENERATED NORMALIZATION PARITY

create table test_support.example_helper_calls(p_student_id uuid, p_personal_word_id uuid, p_sentence text, p_source text);
alter function private.set_personal_word_example(uuid,uuid,text,text) rename to set_personal_word_example_implementation_test;
create function private.set_personal_word_example(
  p_student_id uuid, p_personal_word_id uuid, p_sentence text, p_source text
) returns void language plpgsql security definer set search_path = '' as $delegate$
begin
  insert into test_support.example_helper_calls values (p_student_id,p_personal_word_id,p_sentence,p_source);
  perform private.set_personal_word_example_implementation_test(p_student_id,p_personal_word_id,p_sentence,p_source);
end;
$delegate$;
revoke all on function private.set_personal_word_example(uuid,uuid,text,text) from public, anon, authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000002',true);
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1('42000000-0000-0000-0000-000000000001','[{"term":" Read ","meaning":"阅读","exampleSentence":"Read the book."},{"term":"Write"}]')$q$),'00000','first batch succeeds');
reset role;
select ok(exists(select 1 from test_support.example_helper_calls where p_sentence='Read the book.' and p_source='own_context'),
  'bulk RPC delegates example mutation to the tested private helper');
drop function private.set_personal_word_example(uuid,uuid,text,text);
alter function private.set_personal_word_example_implementation_test(uuid,uuid,text,text) rename to set_personal_word_example;
set local role authenticated;
select set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000002',true);
select is((select count(*)::integer from public.personal_word_ocr_imports),1,'one ledger');
select is((select confirmed_count::integer from public.personal_word_ocr_imports),2,'confirmed count');
select is((select count(*)::integer from public.personal_word_sources where ocr_import_id is not null),2,'one source per item');
select is((select example_sentence_source from public.personal_words where normalized_term='read'),'own_context','example source atomic');
select results_eq($q$select ocr_item_index::integer from public.upsert_personal_words_bulk_v1('42000000-0000-0000-0000-000000000001','[{"term":"Read","meaning":"阅读","exampleSentence":"Read the book."},{"term":"Write","meaning":null,"exampleSentence":""}]')$q$,array[0,1],'canonical same payload replays ordinal order');
select is((select count(*)::integer from public.personal_word_sources),2,'replay has no new sources');
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1('42000000-0000-0000-0000-000000000001','[{"term":"Changed"}]')$q$),'22023','same UUID changed payload rejected');
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1('42000000-0000-0000-0000-000000000001','[{"term":"Write"},{"term":"Read","meaning":"阅读","exampleSentence":"Read the book."}]')$q$),'22023','payload order part of identity');
select is(test_support.state(format('select * from public.upsert_personal_words_bulk_v1(gen_random_uuid(), %L::jsonb)', value)), '22023', 'invalid batch rejected')
from (values ('null'),('{}'),('[]'),('[null]'),('[{"term":3}]'),('[{"term":" "}]'),('[{"term":"a","raw":"private"}]'),('[{"term":"a","meaning":false}]'),('[{"term":"a","exampleSentence":{}}]'),('[{"term":"Read"},{"term":" read "}]')) t(value);
select is(test_support.state(format('select * from public.upsert_personal_words_bulk_v1(gen_random_uuid(), %L::jsonb)',jsonb_build_array(jsonb_build_object('term',repeat('a',101))))),'22023','term length');
select is(test_support.state(format('select * from public.upsert_personal_words_bulk_v1(gen_random_uuid(), %L::jsonb)',jsonb_build_array(jsonb_build_object('term','word','meaning',repeat('字',1001))))),'22023','meaning DB character length');
select is(test_support.state(format('select * from public.upsert_personal_words_bulk_v1(gen_random_uuid(), %L::jsonb)',jsonb_build_array(jsonb_build_object('term','word','exampleSentence',repeat('a',2001))))),'22023','example length');
select is(test_support.state(format('select * from public.upsert_personal_words_bulk_v1(gen_random_uuid(), %L::jsonb)', (select jsonb_agg(jsonb_build_object('term','word'||n)) from generate_series(1,101)n))),'22023','101 items rejected');
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1(null,'[{"term":"word"}]')$q$),'22023','null UUID rejected');
select is((select count(*)::integer from public.personal_word_ocr_imports),1,'invalid batches leave no ledger');

-- Every server-side Stage 1 family, every allowed field; whole batch rolls back.
select is(test_support.state(format('select * from public.upsert_personal_words_bulk_v1(gen_random_uuid(), %L::jsonb)',
  jsonb_build_array(jsonb_build_object('term','untouched') || jsonb_build_object(field,value)))), '22023', 'PII rejected in '||field||' / '||family)
from (values ('email','learner@example.invalid'),('phone','555-123-4567'),('identifier','Member ID: A1234'),('dob','DOB: 2000-01-01'),
 ('url','https://example.invalid/users/learner'),('postal','123 Main Street'),('label','Employee: John Smith / Costco Wholesale'),('unicode','Ｅｍａｉｌ： learner@example.invalid')) t(family,value)
cross join (values ('term'),('meaning'),('exampleSentence')) f(field);
select is((select count(*)::integer from public.personal_words),2,'PII leaves existing words untouched');
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1(gen_random_uuid(),'[{"term":"rollback-word"},{"term":"Name: John"}]')$q$),'22023','mixed batch rollback');
select is((select count(*)::integer from public.personal_words where normalized_term='rollback-word'),0,'no prefix commit');
reset role;
create function test_support.fail_second_ocr_source() returns trigger language plpgsql as $$
begin
  if new.ocr_import_id='42000000-0000-0000-0000-000000000099' and new.ocr_item_index=1 then
    raise exception 'induced failure after first item';
  end if;
  return new;
end;
$$;
create trigger fail_second_ocr_source before insert on public.personal_word_sources
for each row execute function test_support.fail_second_ocr_source();
set local role authenticated;
select set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000002',true);
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1('42000000-0000-0000-0000-000000000099','[{"term":"mutation-one"},{"term":"mutation-two"}]')$q$),'P0001',
  'failure after the first item mutation aborts the batch');
reset role;
drop trigger fail_second_ocr_source on public.personal_word_sources;
drop function test_support.fail_second_ocr_source();
select is((select count(*)::integer from public.personal_word_ocr_imports where id='42000000-0000-0000-0000-000000000099'),0,
  'post-mutation failure rolls back the ledger');
select is((select count(*)::integer from public.personal_words where normalized_term in ('mutation-one','mutation-two')),0,
  'post-mutation failure rolls back earlier and current word mutations');
select is((select count(*)::integer from public.personal_word_sources where ocr_import_id='42000000-0000-0000-0000-000000000099'),0,
  'post-mutation failure rolls back earlier provenance');
set local role authenticated;
select set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000002',true);
select public.archive_personal_word_v1((select id from public.personal_words where normalized_term='read'));
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1('42000000-0000-0000-0000-000000000002',jsonb_build_array(jsonb_build_object('term','READ','meaning',E'\t\n','exampleSentence',E'\r\n')))$q$),'00000','upsert unarchives with canonical blank optional fields');
select ok((select archived_at is null and meaning='阅读' and example_sentence='Read the book.' and example_sentence_source='own_context' from public.personal_words where normalized_term='read'),'blank optional fields preserve values and source');
select is((select count(*)::integer from public.personal_word_sources),3,'new import adds provenance');
select is(test_support.state($q$select public.attach_personal_word_source_v1((select id from public.personal_words limit 1),'ocr_import',null)$q$),'22023','legacy source RPC cannot create OCR source');
select is(test_support.state($q$select public.upsert_personal_word_v1('manual','kept')$q$),'00000','legacy manual RPC remains available');

select set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000003',true);
select is((select count(*)::integer from public.personal_word_ocr_imports),0,'other student sees no ledger');
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1('42000000-0000-0000-0000-000000000001','[{"term":"Read","meaning":"阅读","exampleSentence":"Read the book."},{"term":"Write"}]')$q$),'42501','UUID owner collision denied');
select is(test_support.state($q$insert into public.personal_word_ocr_imports values(gen_random_uuid(),auth.uid(),decode(repeat('00',32),'hex'),1,now(),now())$q$),'42501','direct ledger insert denied');
select is(test_support.state($q$update public.personal_words set example_sentence='changed'$q$),'42501','direct word update denied');
select is(test_support.state($q$delete from public.personal_word_sources$q$),'42501','direct source delete denied');
select set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000001',true);
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1(gen_random_uuid(),'[{"term":"word"}]')$q$),'28000','teacher denied');
select set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000004',true);
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1(gen_random_uuid(),'[{"term":"word"}]')$q$),'28000','inactive student denied');
select set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000005',true);
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1(gen_random_uuid(),'[{"term":"word"}]')$q$),'28000','must-change-password student denied');
reset role;
select is(test_support.state($q$insert into public.personal_word_sources(personal_word_id,source_type,ocr_import_id) select id,'ocr_import','42000000-0000-0000-0000-000000000001' from public.personal_words limit 1$q$),'23514','NULL ordinal cannot bypass CHECK');
select is(test_support.state($q$update public.personal_word_sources set ocr_item_index=100 where ocr_import_id is not null$q$),'23514','ordinal upper bound');
select is(test_support.state($q$update public.personal_word_sources set source_type='self_added' where ocr_import_id is not null$q$),'23514','nonOCR cannot retain OCR refs');
select is(test_support.state($q$update public.personal_word_ocr_imports set payload_hash=decode('00','hex')$q$),'23514','digest length enforced');
select is(test_support.state($q$select private.set_personal_word_example('32000000-0000-0000-0000-000000000003',(select id from public.personal_words limit 1),'test','own_context')$q$),'42501','helper ownership');
select is(test_support.state($q$select private.set_personal_word_example('32000000-0000-0000-0000-000000000002',(select id from public.personal_words limit 1),'test','illegal')$q$),'22023','helper legal source');

-- Seed quota boundaries without invoking the public RPC so each check is exact.
insert into public.personal_word_ocr_imports(id,student_id,payload_hash,confirmed_count,confirmed_at)
select gen_random_uuid(),'32000000-0000-0000-0000-000000000002',decode(repeat('00',32),'hex'),1,now() from generate_series(1,18);
set local role authenticated;
select set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000002',true);
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1(gen_random_uuid(),'[{"term":"quota"}]')$q$),'22023','21st hourly import blocked');
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1('42000000-0000-0000-0000-000000000001','[{"term":"Read","meaning":"阅读","exampleSentence":"Read the book."},{"term":"Write"}]')$q$),'00000','retry bypasses exhausted quota without new writes');
reset role;
update public.personal_word_ocr_imports set created_at=now()-interval '2 hours';
insert into public.personal_word_ocr_imports(id,student_id,payload_hash,confirmed_count,confirmed_at,created_at)
select gen_random_uuid(),'32000000-0000-0000-0000-000000000002',decode(repeat('00',32),'hex'),1,now(),now()-interval '2 hours' from generate_series(1,1980);
set local role authenticated;
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1(gen_random_uuid(),'[{"term":"quota"}]')$q$),'22023','2001st lifetime import blocked');
reset role;
insert into public.personal_word_ocr_imports(id,student_id,payload_hash,confirmed_count,confirmed_at,created_at)
select ('44000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'32000000-0000-0000-0000-000000000003',decode(repeat('00',32),'hex'),100,now(),now()-interval '2 hours' from generate_series(1,200)n;
insert into public.personal_words(id,student_id,term,normalized_term)
select ('45000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'32000000-0000-0000-0000-000000000003','source-quota-'||n,'source-quota-'||n from generate_series(1,20000)n;
insert into public.personal_word_sources(personal_word_id,source_type,ocr_import_id,ocr_item_index)
select ('45000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'ocr_import',
  ('44000000-0000-0000-0000-'||lpad((((n-1)/100)+1)::text,12,'0'))::uuid,((n-1)%100)::smallint from generate_series(1,20000)n;
set local role authenticated;
select set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000003',true);
select is(test_support.state($q$select * from public.upsert_personal_words_bulk_v1('43000000-0000-0000-0000-000000000099','[{"term":"over-source-quota"}]')$q$),'22023','20,001st lifetime source item blocked');
select is((select count(*)::integer from public.personal_word_ocr_imports where id='43000000-0000-0000-0000-000000000099'),0,'source quota failure leaves no ledger reservation');
reset role;
insert into public.personal_word_ocr_imports(id,student_id,payload_hash,confirmed_count,confirmed_at)
values ('42000000-0000-0000-0000-000000000006','32000000-0000-0000-0000-000000000006',decode(repeat('00',32),'hex'),1,now());
delete from public.students where id='32000000-0000-0000-0000-000000000006';
select is((select count(*)::integer from public.personal_word_ocr_imports where id='42000000-0000-0000-0000-000000000006'),0,
  'deleting the owning student cascades the permanent import ledger');
delete from public.personal_word_ocr_imports where id='42000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.personal_word_sources where ocr_import_id='42000000-0000-0000-0000-000000000001'),0,'ledger cascade removes its sources');
select ok(exists(select 1 from public.personal_words where normalized_term='read'),'ledger cascade preserves word');
select ok(not exists(select 1 from storage.buckets where id ilike '%ocr%' or id ilike '%personal%'),'no OCR Storage bucket');
select * from finish();
rollback;
