-- Phase 2 local source. Release/Production authorization is recorded separately.
-- No captured image, OCR text, rejected line, NER evidence, or original filename
-- is stored. Only the learner's confirmed fields and an ordered payload digest.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table public.personal_word_ocr_imports (
  id uuid primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  payload_hash bytea not null,
  confirmed_count smallint not null,
  confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint personal_word_ocr_imports_payload_hash_length_check
    check (octet_length(payload_hash) = 32),
  constraint personal_word_ocr_imports_confirmed_count_check
    check (confirmed_count between 1 and 100)
);
create index personal_word_ocr_imports_student_created_idx
  on public.personal_word_ocr_imports(student_id, created_at desc);
alter table public.personal_word_ocr_imports enable row level security;
create policy personal_word_ocr_imports_select_own on public.personal_word_ocr_imports
  for select to authenticated using (private.is_ready_profile() and student_id = private.current_student_id());
revoke all on public.personal_word_ocr_imports from public, anon, authenticated;
revoke truncate, references, trigger, maintain on public.personal_word_ocr_imports from service_role;
grant select on public.personal_word_ocr_imports to authenticated;
grant select, insert, update, delete on public.personal_word_ocr_imports to service_role;
comment on table public.personal_word_ocr_imports is
  'Owner-scoped confirmation ledger; authenticated SELECT only, writes only through the bulk RPC. Browser UUID, ordered confirmed-payload SHA-256, count and times; never photo, captured plaintext, filenames, raw OCR/NER, or rejected content.';
comment on column public.personal_word_ocr_imports.payload_hash is
  'SHA-256 of canonical ordered confirmed fields, not captured plaintext; sensitive ownership metadata. No plaintext request logging.';

-- Ledger exists before the referencing columns. Validate replacements before
-- dropping the old checks, preserving compatibility with all legacy sources.
alter table public.personal_word_sources
  add column ocr_import_id uuid references public.personal_word_ocr_imports(id) on delete cascade;
alter table public.personal_word_sources
  add column ocr_item_index smallint;
alter table public.personal_word_sources
  add constraint personal_word_sources_type_v2 check (source_type in
    ('teacher_vocabulary_word', 'teacher_pronunciation_word', 'self_added', 'ocr_import')) not valid,
  add constraint personal_word_sources_reference_v2 check
    (num_nonnulls(vocabulary_word_id, pronunciation_task_word_id, ocr_import_id) <= 1) not valid,
  add constraint personal_word_sources_ocr_shape check (
    (source_type = 'ocr_import' and ocr_import_id is not null and ocr_item_index is not null and ocr_item_index between 0 and 99)
    or (source_type <> 'ocr_import' and ocr_import_id is null and ocr_item_index is null)
  ) not valid;
alter table public.personal_word_sources validate constraint personal_word_sources_type_v2;
alter table public.personal_word_sources validate constraint personal_word_sources_reference_v2;
alter table public.personal_word_sources validate constraint personal_word_sources_ocr_shape;
alter table public.personal_word_sources drop constraint personal_word_sources_source_type_check;
alter table public.personal_word_sources drop constraint personal_word_sources_reference_shape_check;
alter table public.personal_word_sources rename constraint personal_word_sources_type_v2 to personal_word_sources_source_type_check;
alter table public.personal_word_sources rename constraint personal_word_sources_reference_v2 to personal_word_sources_reference_shape_check;
create unique index personal_word_sources_ocr_word_uidx
  on public.personal_word_sources(personal_word_id, ocr_import_id)
  where source_type = 'ocr_import' and ocr_import_id is not null;
create unique index personal_word_sources_ocr_item_uidx
  on public.personal_word_sources(ocr_import_id, ocr_item_index)
  where source_type = 'ocr_import' and ocr_import_id is not null and ocr_item_index is not null;
comment on column public.personal_word_sources.ocr_import_id is
  'Confirmation provenance only; cascades with ledger deletion, never identifies a retained photo. Owned word and ledger enforced by private RPC helper.';
comment on column public.personal_word_sources.ocr_item_index is
  'Zero-based ordinal in the ordered confirmed batch (0..99), unique per import, required only for OCR provenance; never original OCR position.';

-- BEGIN GENERATED STAGE1 (scripts/phase2/policy-governance.mjs)
create function private.captured_text_has_high_confidence_pii_v1(p_text text)
returns boolean language sql immutable security definer set search_path = '' as $pii$
  select pg_catalog.regexp_replace(pg_catalog.normalize(coalesce(p_text, ''), 'NFKC'), '[[:space:]]+', ' ', 'g') ~* '[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+([.][a-z0-9-]+)+'
    or pg_catalog.regexp_replace(pg_catalog.normalize(coalesce(p_text, ''), 'NFKC'), '[[:space:]]+', ' ', 'g') ~* '(^|[^0-9])([+]?[0-9]{1,3}[ .-]?)?([(][0-9]{2,4}[)]|[0-9]{3})[ .-][0-9]{3,4}[ .-][0-9]{4}([^0-9]|$)'
    or pg_catalog.regexp_replace(pg_catalog.normalize(coalesce(p_text, ''), 'NFKC'), '[[:space:]]+', ' ', 'g') ~* '(^|[^a-z])(student|employee|account|member)[ _-]*(id|number|no[.]?|#)[ ]*[:#=-]?[ ]*[a-z0-9][a-z0-9-]*'
    or pg_catalog.regexp_replace(pg_catalog.normalize(coalesce(p_text, ''), 'NFKC'), '[[:space:]]+', ' ', 'g') ~* '(^|[^a-z])(dob|date[ ]+of[ ]+birth|born)[ ]*[:=-]?[ ]*[0-9a-z]'
    or pg_catalog.regexp_replace(pg_catalog.normalize(coalesce(p_text, ''), 'NFKC'), '[[:space:]]+', ' ', 'g') ~* '(https?://|www[.])[^ ]*([?&](id|user|email|token|account|member|student|name)=|/(users?|profiles?|accounts?|members?)/)[^ ]+'
    or pg_catalog.regexp_replace(pg_catalog.normalize(coalesce(p_text, ''), 'NFKC'), '[[:space:]]+', ' ', 'g') ~* '(^|[^0-9])[0-9]{1,6}[ ]+([a-z0-9.''-]+[ ]+){1,5}(street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct|way)([., ]|$)'
    or pg_catalog.regexp_replace(pg_catalog.normalize(coalesce(p_text, ''), 'NFKC'), '[[:space:]]+', ' ', 'g') ~* '(^|[^a-z])(Name|Student ID|Employee|Teacher|Account #|DOB|Address|Phone|Email|Member ID|Employee ID|Date of Birth|Account Number|Student Name)([ ]*[:#=-][ ]*|[ ]+)[^ ]';
$pii$;
revoke all on function private.captured_text_has_high_confidence_pii_v1(text) from public, anon, authenticated;
comment on function private.captured_text_has_high_confidence_pii_v1(text) is 'Generated v1 deterministic Stage 1 defense in depth; never logs input. Private only, no authenticated execute grant.';
-- END GENERATED STAGE1

create function private.canonicalize_ocr_confirmation_text_v1(p_text text)
returns text language sql immutable security definer set search_path = '' as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
$$;
revoke all on function private.canonicalize_ocr_confirmation_text_v1(text) from public, anon, authenticated;
comment on function private.canonicalize_ocr_confirmation_text_v1(text) is
  'Private Phase 2 confirmation boundary canonicalization. Matches the existing normalize_spelling whitespace behavior without lowercasing or changing Phase 1 RPCs.';

create function private.set_personal_word_example(
  p_student_id uuid, p_personal_word_id uuid, p_sentence text, p_source text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_sentence text;
begin
  perform 1 from public.personal_words w
    where w.id = p_personal_word_id and w.student_id = p_student_id for update;
  if not found then raise exception 'OCR confirmation rejected' using errcode = '42501'; end if;
  if p_source is null or p_source not in ('own_context', 'curated_corpus', 'ningtutor_core') then
    raise exception 'OCR confirmation rejected' using errcode = '22023';
  end if;
  v_sentence := private.canonicalize_ocr_confirmation_text_v1(p_sentence);
  if nullif(v_sentence, '') is null then return; end if;
  if char_length(v_sentence) > 2000 then raise exception 'OCR confirmation rejected' using errcode = '22023'; end if;
  update public.personal_words set example_sentence = v_sentence, example_sentence_source = p_source
    where id = p_personal_word_id and student_id = p_student_id;
end;
$$;
revoke all on function private.set_personal_word_example(uuid, uuid, text, text) from public, anon, authenticated;
comment on function private.set_personal_word_example(uuid, uuid, text, text) is
  'Internal owner-checked atomic example/source update. Blank input preserves both existing fields. No public wrapper or later-phase extraction.';

create function private.attach_personal_word_ocr_source_v1(
  p_student_id uuid, p_personal_word_id uuid, p_import_id uuid, p_item_index smallint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_existing public.personal_word_sources%rowtype;
begin
  perform 1 from public.personal_word_ocr_imports i where i.id = p_import_id and i.student_id = p_student_id for update;
  if not found then raise exception 'OCR confirmation rejected' using errcode = '42501'; end if;
  perform 1 from public.personal_words w where w.id = p_personal_word_id and w.student_id = p_student_id for update;
  if not found then raise exception 'OCR confirmation rejected' using errcode = '42501'; end if;
  if p_item_index is null or p_item_index not between 0 and 99 then
    raise exception 'OCR confirmation rejected' using errcode = '22023';
  end if;
  insert into public.personal_word_sources(personal_word_id, source_type, ocr_import_id, ocr_item_index)
    values (p_personal_word_id, 'ocr_import', p_import_id, p_item_index)
    on conflict do nothing returning id into v_id;
  if v_id is not null then return v_id; end if;
  select * into v_existing from public.personal_word_sources s where s.ocr_import_id = p_import_id
    and (s.personal_word_id = p_personal_word_id or s.ocr_item_index = p_item_index) for update;
  if not found or v_existing.personal_word_id <> p_personal_word_id or v_existing.ocr_item_index <> p_item_index then
    raise exception 'OCR confirmation rejected' using errcode = '22023';
  end if;
  return v_existing.id;
end;
$$;
revoke all on function private.attach_personal_word_ocr_source_v1(uuid, uuid, uuid, smallint) from public, anon, authenticated;
comment on function private.attach_personal_word_ocr_source_v1(uuid, uuid, uuid, smallint) is
  'Internal owner-checked OCR provenance writer. Locks ledger and word; both unique constraints must replay the same word and ordinal. No captured content.';

create function public.upsert_personal_words_bulk_v1(p_ocr_import_id uuid, p_words jsonb)
returns table(personal_word_id uuid, source_id uuid, term text, ocr_item_index smallint)
language plpgsql security definer set search_path = '' as $$
declare
  v_student uuid; v_item jsonb; v_canonical jsonb := '[]'::jsonb; v_hash bytea;
  v_term text; v_meaning text; v_example text; v_normalized text;
  v_seen text[] := '{}'::text[]; v_import public.personal_word_ocr_imports%rowtype;
  v_count integer; v_inserted integer; v_index integer := 0; v_word uuid; v_source uuid;
begin
  if not private.is_ready_profile() then raise exception 'OCR confirmation rejected' using errcode = '28000'; end if;
  v_student := private.current_student_id();
  if v_student is null then raise exception 'OCR confirmation rejected' using errcode = '28000'; end if;
  if p_ocr_import_id is null or p_words is null or jsonb_typeof(p_words) <> 'array' then
    raise exception 'OCR confirmation rejected' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_words);
  if v_count not between 1 and 100 then raise exception 'OCR confirmation rejected' using errcode = '22023'; end if;
  for v_item in select value from jsonb_array_elements(p_words) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'OCR confirmation rejected' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_object_keys(v_item) k where k not in ('term', 'meaning', 'exampleSentence'))
      or jsonb_typeof(v_item->'term') is distinct from 'string'
      or (v_item ? 'meaning' and jsonb_typeof(v_item->'meaning') not in ('string', 'null'))
      or (v_item ? 'exampleSentence' and jsonb_typeof(v_item->'exampleSentence') not in ('string', 'null')) then
      raise exception 'OCR confirmation rejected' using errcode = '22023';
    end if;
    v_term := private.canonicalize_ocr_confirmation_text_v1(v_item->>'term');
    v_meaning := nullif(private.canonicalize_ocr_confirmation_text_v1(v_item->>'meaning'), '');
    v_example := nullif(private.canonicalize_ocr_confirmation_text_v1(v_item->>'exampleSentence'), '');
    v_normalized := private.normalize_spelling(v_term);
    if v_normalized = '' or char_length(v_term) > 100 or char_length(v_meaning) > 1000 or char_length(v_example) > 2000
      or v_normalized = any(v_seen) or private.captured_text_has_high_confidence_pii_v1(v_term)
      or private.captured_text_has_high_confidence_pii_v1(v_meaning) or private.captured_text_has_high_confidence_pii_v1(v_example) then
      raise exception 'OCR confirmation rejected' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_normalized);
    v_canonical := v_canonical || jsonb_build_array(jsonb_build_object('term', v_term, 'meaning', v_meaning, 'exampleSentence', v_example));
  end loop;
  v_hash := pg_catalog.sha256(pg_catalog.convert_to(v_canonical::text, 'UTF8'));
  -- Per-student serialization covers idempotence and all quota count/write races.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('personal-word-ocr:' || v_student::text, 0));
  insert into public.personal_word_ocr_imports(id, student_id, payload_hash, confirmed_count, confirmed_at)
    values (p_ocr_import_id, v_student, v_hash, v_count::smallint, now()) on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  select * into v_import from public.personal_word_ocr_imports i where i.id = p_ocr_import_id for update;
  if v_import.student_id <> v_student then raise exception 'OCR confirmation rejected' using errcode = '42501'; end if;
  if v_import.payload_hash <> v_hash or v_import.confirmed_count <> v_count then
    raise exception 'OCR confirmation rejected' using errcode = '22023';
  end if;
  if v_inserted = 0 then
    if (select count(*) from public.personal_word_sources s where s.ocr_import_id = p_ocr_import_id) <> v_count then
      raise exception 'OCR confirmation rejected' using errcode = '22023';
    end if;
    return query select s.personal_word_id, s.id, (v_canonical->s.ocr_item_index->>'term')::text, s.ocr_item_index
      from public.personal_word_sources s where s.ocr_import_id = p_ocr_import_id order by s.ocr_item_index;
    return;
  end if;
  -- The provisional ledger insert counts toward quota and rolls back on failure.
  if (select count(*) from public.personal_word_ocr_imports i where i.student_id = v_student and i.created_at > now() - interval '1 hour') > 20
    or (select count(*) from public.personal_word_ocr_imports i where i.student_id = v_student) > 2000
    or (select count(*) from public.personal_word_sources s join public.personal_word_ocr_imports i on i.id = s.ocr_import_id
      where i.student_id = v_student) + v_count > 20000 then
    raise exception 'OCR confirmation rejected' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(v_canonical) loop
    insert into public.personal_words as w(student_id, term, normalized_term, meaning)
      values (v_student, v_item->>'term', private.normalize_spelling(v_item->>'term'), v_item->>'meaning')
      on conflict (student_id, normalized_term) do update set term = excluded.term,
        meaning = coalesce(excluded.meaning, w.meaning), archived_at = null returning id into v_word;
    perform private.set_personal_word_example(v_student, v_word, v_item->>'exampleSentence', 'own_context');
    v_source := private.attach_personal_word_ocr_source_v1(v_student, v_word, p_ocr_import_id, v_index::smallint);
    personal_word_id := v_word; source_id := v_source; term := v_item->>'term'; ocr_item_index := v_index::smallint;
    return next; v_index := v_index + 1;
  end loop;
end;
$$;
revoke all on function public.upsert_personal_words_bulk_v1(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_personal_words_bulk_v1(uuid, jsonb) to authenticated;
comment on function public.upsert_personal_words_bulk_v1(uuid, jsonb) is
  'Ready-student-only atomic confirmed OCR word import. Ordered canonical digest + browser UUID ensures replay; student advisory lock serializes quotas. Generic errors only. No images, captured OCR/NER, plaintext logging, Storage, or later-phase extraction.';

reset lock_timeout;
reset statement_timeout;
