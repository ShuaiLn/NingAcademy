\set ON_ERROR_STOP on

-- Read-only, fail-closed precondition for applying the Phase 1 Personal Word
-- Library migration. This proves Production is exactly at the reviewed
-- predecessor (migration 32), that every dependency still has the expected
-- catalog shape, and that none of the new object names already collides.
-- It authorizes no migration and performs no DDL or DML.

begin transaction read only;

do $precondition$
declare
  v_actual_versions text[];
  v_expected_versions constant text[] := array[
    '20260810164324',
    '20260810233713',
    '20260810233828',
    '20260810234845',
    '20260811000400',
    '20260811001112',
    '20260811001824',
    '20260811051226',
    '20260811051254',
    '20260811051504',
    '20260811080227',
    '20260811191400',
    '20260812011047',
    '20260812120000',
    '20260812130000',
    '20260812140000',
    '20260812150000',
    '20260813073915',
    '20260813074607',
    '20260815120000',
    '20260815130000',
    '20260815140000',
    '20260815150000',
    '20260815160000',
    '20260815170000',
    '20260815180000',
    '20260815190000',
    '20260815200000',
    '20260816150000',
    '20260818021000',
    '20260901120000',
    '20260910073101'
  ];
  v_issue text;
begin
  if current_setting('transaction_read_only') <> 'on' then
    raise exception 'Phase 1 precondition requires a read-only transaction';
  end if;

  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'supabase_migrations.schema_migrations is missing';
  end if;

  select pg_catalog.array_agg(migration.version::text order by migration.version::text)
  into v_actual_versions
  from supabase_migrations.schema_migrations as migration;

  if v_actual_versions is distinct from v_expected_versions then
    raise exception using
      message = 'Phase 1 predecessor mismatch: Production must contain exactly migrations 1-32 through 20260910073101_retire_ningacademy_games with no gaps or extras',
      detail = pg_catalog.format(
        'expected=%s actual=%s',
        v_expected_versions::text,
        coalesce(v_actual_versions::text, '<none>')
      );
  end if;

  -- Required roles. Their grants on the new objects are established only by
  -- the migration; this precondition merely proves the principals exist.
  select pg_catalog.string_agg(role_name, ', ' order by role_name)
  into v_issue
  from pg_catalog.unnest(array['anon', 'authenticated', 'service_role'])
    as required_role(role_name)
  where pg_catalog.to_regrole(role_name) is null;

  if v_issue is not null then
    raise exception 'Phase 1 required roles are missing: %', v_issue;
  end if;

  -- Required parent columns and their exact PostgreSQL types.
  select pg_catalog.string_agg(
    pg_catalog.format('%s.%I (%s)', spec.table_name, spec.column_name, spec.type_name),
    ', ' order by spec.table_name, spec.column_name
  )
  into v_issue
  from (
    values
      ('public.students', 'id', 'uuid'),
      ('public.vocabulary_words', 'id', 'uuid'),
      ('public.vocabulary_words', 'set_id', 'uuid'),
      ('public.vocabulary_words', 'archived_at', 'timestamp with time zone'),
      ('public.vocabulary_sets', 'id', 'uuid'),
      ('public.vocabulary_sets', 'published_at', 'timestamp with time zone'),
      ('public.vocabulary_sets', 'archived_at', 'timestamp with time zone'),
      ('public.vocabulary_targets', 'set_id', 'uuid'),
      ('public.vocabulary_targets', 'student_id', 'uuid'),
      ('public.vocabulary_targets', 'revoked_at', 'timestamp with time zone'),
      ('public.pronunciation_task_words', 'id', 'uuid'),
      ('public.pronunciation_task_words', 'task_id', 'uuid'),
      ('public.pronunciation_task_words', 'archived_at', 'timestamp with time zone'),
      ('public.pronunciation_tasks', 'id', 'uuid'),
      ('public.pronunciation_tasks', 'published_at', 'timestamp with time zone'),
      ('public.pronunciation_tasks', 'archived_at', 'timestamp with time zone'),
      ('public.pronunciation_targets', 'task_id', 'uuid'),
      ('public.pronunciation_targets', 'student_id', 'uuid'),
      ('public.pronunciation_targets', 'class_id', 'uuid'),
      ('public.pronunciation_targets', 'revoked_at', 'timestamp with time zone')
  ) as spec(table_name, column_name, type_name)
  where pg_catalog.to_regclass(spec.table_name) is null
     or not exists (
       select 1
       from pg_catalog.pg_attribute as attribute
       where attribute.attrelid = pg_catalog.to_regclass(spec.table_name)
         and attribute.attname = spec.column_name
         and not attribute.attisdropped
         and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
           = spec.type_name
     );

  if v_issue is not null then
    raise exception 'Phase 1 required parent columns are missing or changed: %',
      v_issue;
  end if;

  -- Exact callable signatures, return types, and SECURITY DEFINER contract.
  select pg_catalog.string_agg(
    spec.signature,
    ', ' order by spec.signature
  )
  into v_issue
  from (
    values
      ('private.normalize_spelling(text)', 'text', true),
      ('private.is_ready_profile()', 'boolean', true),
      ('private.current_student_id()', 'uuid', true),
      ('private.can_view_pronunciation_task(uuid)', 'boolean', true),
      ('public.set_updated_at()', 'trigger', true)
  ) as spec(signature, return_type, security_definer)
  where pg_catalog.to_regprocedure(spec.signature) is null
     or not exists (
       select 1
       from pg_catalog.pg_proc as routine
       where routine.oid = pg_catalog.to_regprocedure(spec.signature)
         and routine.prorettype::pg_catalog.regtype::text = spec.return_type
         and routine.prosecdef = spec.security_definer
     );

  if v_issue is not null then
    raise exception 'Phase 1 helper signature/metadata mismatch: %', v_issue;
  end if;

  -- No new table/index/constraint/policy/trigger/function name may already
  -- exist, even on an unrelated object. That turns any out-of-band partial
  -- deployment or unrelated catalog collision into a review stop.
  select pg_catalog.string_agg(
    pg_catalog.format('%I.%I', namespace.nspname, relation.relname),
    ', ' order by namespace.nspname, relation.relname
  )
  into v_issue
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  where relation.relname = any (array[
    'personal_words',
    'personal_word_sources',
    'personal_words_pkey',
    'personal_words_student_normalized_term_unique',
    'personal_words_student_review_due_idx',
    'personal_word_sources_pkey',
    'personal_word_sources_personal_word_id_idx',
    'personal_word_sources_vocab_uidx',
    'personal_word_sources_pron_uidx',
    'personal_word_sources_self_uidx'
  ]);

  if v_issue is not null then
    raise exception 'Phase 1 relation/index name collision: %', v_issue;
  end if;

  select pg_catalog.string_agg(constraint_record.conname, ', ' order by constraint_record.conname)
  into v_issue
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conname = any (array[
    'personal_words_pkey',
    'personal_words_student_id_fkey',
    'personal_words_student_normalized_term_unique',
    'personal_words_term_format',
    'personal_words_meaning_length',
    'personal_words_example_sentence_length',
    'personal_words_example_sentence_source_valid',
    'personal_words_mastery_status_valid',
    'personal_words_success_count_non_negative',
    'personal_words_mistake_count_non_negative',
    'personal_words_practice_count_non_negative',
    'personal_words_correct_streak_non_negative',
    'personal_words_ease_factor_positive',
    'personal_words_interval_days_non_negative',
    'personal_words_pronunciation_score_non_negative',
    'personal_word_sources_pkey',
    'personal_word_sources_personal_word_id_fkey',
    'personal_word_sources_source_type_check',
    'personal_word_sources_vocabulary_word_id_fkey',
    'personal_word_sources_pronunciation_task_word_id_fkey',
    'personal_word_sources_reference_shape_check'
  ]);

  if v_issue is not null then
    raise exception 'Phase 1 constraint name collision: %', v_issue;
  end if;

  select pg_catalog.string_agg(policy.polname, ', ' order by policy.polname)
  into v_issue
  from pg_catalog.pg_policy as policy
  where policy.polname = any (array[
    'personal_words_select_own',
    'personal_word_sources_select_own'
  ]);

  if v_issue is not null then
    raise exception 'Phase 1 policy name collision: %', v_issue;
  end if;

  select pg_catalog.string_agg(trigger_record.tgname, ', ' order by trigger_record.tgname)
  into v_issue
  from pg_catalog.pg_trigger as trigger_record
  where not trigger_record.tgisinternal
    and trigger_record.tgname = 'personal_words_set_updated_at';

  if v_issue is not null then
    raise exception 'Phase 1 trigger name collision: %', v_issue;
  end if;

  select pg_catalog.string_agg(
    routine.oid::pg_catalog.regprocedure::text,
    ', ' order by routine.oid::pg_catalog.regprocedure::text
  )
  into v_issue
  from pg_catalog.pg_proc as routine
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = routine.pronamespace
  where namespace.nspname = 'public'
    and routine.proname = any (array[
      'upsert_personal_word_v1',
      'attach_personal_word_source_v1',
      'archive_personal_word_v1'
    ]);

  if v_issue is not null then
    raise exception 'Phase 1 RPC name/signature collision: %', v_issue;
  end if;
end
$precondition$;

select current_database() as audited_database,
       current_user as audit_role,
       current_setting('transaction_read_only') as transaction_read_only,
       'PASS: exact migration-32 predecessor and Phase 1 catalog preconditions confirmed'::text
         as result;

commit;
