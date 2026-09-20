begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_function_privilege('anon','public.upsert_personal_words_bulk_v1(uuid,jsonb)','EXECUTE'),'anon bulk denied');
select ok(has_function_privilege('authenticated','public.upsert_personal_words_bulk_v1(uuid,jsonb)','EXECUTE'),'authenticated bulk allowed');
select ok(not has_function_privilege(role_name,signature,'EXECUTE'),role_name||' cannot execute '||signature)
from (values ('anon'),('authenticated'),('service_role')) roles(role_name)
cross join (values ('private.captured_text_has_high_confidence_pii_v1(text)'),('private.canonicalize_ocr_confirmation_text_v1(text)'),
 ('private.set_personal_word_example(uuid,uuid,text,text)'),('private.attach_personal_word_ocr_source_v1(uuid,uuid,uuid,smallint)')) helpers(signature);
select ok(not has_table_privilege('authenticated','public.personal_word_ocr_imports',privilege),'ledger '||privilege||' denied')
from (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) t(privilege);
select ok(has_table_privilege('service_role','public.personal_word_ocr_imports',privilege),'service ledger '||privilege)
from (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) t(privilege);
select ok(not has_table_privilege('anon','public.personal_word_ocr_imports','SELECT'),'anonymous ledger hidden');
select ok(not has_function_privilege('service_role','public.upsert_personal_words_bulk_v1(uuid,jsonb)','EXECUTE'),'bulk RPC has minimum authenticated-only execution grant');
select is((select array_agg(coalesce(r.rolname,'PUBLIC') order by coalesce(r.rolname,'PUBLIC'))
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
  left join pg_roles r on r.oid=x.grantee
  where p.oid='public.upsert_personal_words_bulk_v1(uuid,jsonb)'::regprocedure and x.grantee<>p.proowner),
  array['authenticated']::name[],'bulk function ACL has exactly one non-owner grantee');
select is((select count(*)::integer
  from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
  where p.oid in ('private.captured_text_has_high_confidence_pii_v1(text)'::regprocedure,
    'private.canonicalize_ocr_confirmation_text_v1(text)'::regprocedure,
    'private.set_personal_word_example(uuid,uuid,text,text)'::regprocedure,
    'private.attach_personal_word_ocr_source_v1(uuid,uuid,uuid,smallint)'::regprocedure)
    and x.grantee<>p.proowner),0,'private OCR helpers have no non-owner execute ACL');
select is((select array_agg(format('%s:%s',coalesce(r.rolname,'PUBLIC'),x.privilege_type) order by coalesce(r.rolname,'PUBLIC'),x.privilege_type)
  from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
  left join pg_roles r on r.oid=x.grantee
  where c.oid='public.personal_word_ocr_imports'::regclass and x.grantee<>c.relowner),
  array['authenticated:SELECT','service_role:DELETE','service_role:INSERT','service_role:SELECT','service_role:UPDATE']::text[],
  'ledger ACL is exactly authenticated SELECT plus service-role CRUD');
select ok((select polcmd='r' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  from pg_policy where polrelid='public.personal_word_ocr_imports'::regclass),'ledger has the exact authenticated SELECT policy role/action');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='set_personal_word_example_v1'),'no future Phase 6 v1 example wrapper');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like '%ocr%' and p.proname <> 'upsert_personal_words_bulk_v1'),'one public OCR mutation surface');
select ok((select confdeltype='c' from pg_constraint where conname='personal_word_sources_ocr_import_id_fkey'),'source ledger FK cascades');
select ok((select confdeltype='c' from pg_constraint where conname='personal_word_ocr_imports_student_id_fkey'),'ledger student FK cascades');
select * from finish();
rollback;
