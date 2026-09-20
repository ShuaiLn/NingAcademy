begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select ok(exists(select 1 from supabase_migrations.schema_migrations where version='20260911213841'),'Phase 1 predecessor is in replay history');
select ok(exists(select 1 from supabase_migrations.schema_migrations where version='20260919025607'),'Phase 2 OCR migration is in replay history');
select ok('20260911213841' < '20260919025607','Phase 2 follows the Phase 1 personal-word contract');
select ok(to_regclass('public.personal_word_ocr_imports') is not null,'ledger exists after replay');
select ok(exists(select 1 from pg_constraint where conname='personal_word_sources_ocr_import_id_fkey'
  and confrelid='public.personal_word_ocr_imports'::regclass),'source FK resolves to the pre-created ledger');
select ok((select position('personal_word_ocr_imports' in pg_get_functiondef('public.upsert_personal_words_bulk_v1(uuid,jsonb)'::regprocedure))>0),'bulk RPC compiled after its relations');
select * from finish();
rollback;
