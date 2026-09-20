\set ON_ERROR_STOP on

-- Protected Production read-only precondition for Phase 2. This emits only
-- aggregate catalog/row counts; it never selects terms, identifiers, or other
-- learner content.
begin transaction read only;

do $precondition$
declare
  v_has_import_table boolean := to_regclass('public.personal_word_ocr_imports') is not null;
  v_ocr_column_count integer;
begin
  if to_regclass('public.personal_words') is null
     or to_regclass('public.personal_word_sources') is null then
    raise exception 'Phase 2 predecessor tables are absent';
  end if;

  select count(*) into v_ocr_column_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'personal_word_sources'
    and column_name in ('ocr_import_id', 'ocr_item_index');

  if v_has_import_table then
    if v_ocr_column_count <> 2
       or to_regprocedure('public.upsert_personal_words_bulk_v1(uuid,jsonb)') is null
       or to_regprocedure('private.attach_personal_word_ocr_source_v1(uuid,uuid,uuid,smallint)') is null
       or to_regprocedure('private.set_personal_word_example(uuid,uuid,text,text)') is null
       or to_regprocedure('private.captured_text_has_high_confidence_pii_v1(text)') is null then
      raise exception 'Phase 2 predecessor is partially applied';
    end if;
  else
    if v_ocr_column_count <> 0
       or to_regprocedure('public.upsert_personal_words_bulk_v1(uuid,jsonb)') is not null
       or to_regprocedure('private.attach_personal_word_ocr_source_v1(uuid,uuid,uuid,smallint)') is not null
       or to_regprocedure('private.set_personal_word_example(uuid,uuid,text,text)') is not null
       or to_regprocedure('private.captured_text_has_high_confidence_pii_v1(text)') is not null then
      raise exception 'Phase 2 object name collision exists before migration';
    end if;
  end if;
end
$precondition$;

select case
  when to_regclass('public.personal_word_ocr_imports') is null
    then 'pre_migration_precondition'
  else 'phase2_already_present'
end as phase2_state;

select count(*)::bigint as personal_word_count,
       pg_total_relation_size('public.personal_words')::bigint as personal_words_total_bytes
from public.personal_words;

select count(*)::bigint as source_count,
       pg_total_relation_size('public.personal_word_sources')::bigint as sources_total_bytes
from public.personal_word_sources;

select source_type, count(*)::bigint as source_count
from public.personal_word_sources
group by source_type
order by source_type;

-- These predicates are exactly the legacy rows accepted by the additive
-- replacement constraints. Any count above zero blocks deployment.
select count(*)::bigint as incompatible_legacy_source_count
from public.personal_word_sources
where source_type not in (
  'teacher_vocabulary_word',
  'teacher_pronunciation_word',
  'self_added',
  'ocr_import'
)
or num_nonnulls(vocabulary_word_id, pronunciation_task_word_id) > 1;

do $assert_legacy$
begin
  if exists (
    select 1
    from public.personal_word_sources
    where source_type not in (
      'teacher_vocabulary_word',
      'teacher_pronunciation_word',
      'self_added',
      'ocr_import'
    )
    or num_nonnulls(vocabulary_word_id, pronunciation_task_word_id) > 1
  ) then
    raise exception 'Populated personal_word_sources is incompatible with Phase 2';
  end if;
end
$assert_legacy$;

rollback;
