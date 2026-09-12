-- Phase 1 (Personal Word Library): per-student personal vocabulary,
-- multi-source provenance, and mastery-tracking columns reserved for the
-- Phase 3 deterministic spaced-repetition/practice engine (not built here).
--
-- This is an independent table family. Nothing here changes assignments,
-- vocabulary homework, pronunciation homework, or their completion models.
-- One mastery row exists per (student_id, normalized_term), while
-- personal_word_sources retains the append-only history of how the word
-- entered the library.

-- ============================================================================
-- Tables
-- ============================================================================

create table public.personal_words (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  term text not null,
  normalized_term text not null,
  meaning text,
  example_sentence text,
  example_sentence_source text,
  mastery_status text not null default 'new',
  success_count integer not null default 0,
  mistake_count integer not null default 0,
  practice_count integer not null default 0,
  correct_streak integer not null default 0,
  ease_factor numeric not null default 2.5,
  interval_days numeric not null default 0,
  review_due_at timestamptz not null default now(),
  last_seen_at timestamptz,
  pronunciation_score numeric,
  difficulty text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_words_student_normalized_term_unique
    unique (student_id, normalized_term),
  constraint personal_words_term_format
    check (btrim(term) <> '' and char_length(term) <= 100),
  constraint personal_words_meaning_length
    check (meaning is null or char_length(meaning) <= 1000),
  constraint personal_words_example_sentence_length
    check (example_sentence is null or char_length(example_sentence) <= 2000),
  constraint personal_words_example_sentence_source_valid check (
    example_sentence_source is null
    or example_sentence_source in (
      'own_context',
      'curated_corpus',
      'ningtutor_core'
    )
  ),
  constraint personal_words_mastery_status_valid
    check (mastery_status in ('new', 'learning', 'familiar', 'mastered')),
  constraint personal_words_success_count_non_negative check (success_count >= 0),
  constraint personal_words_mistake_count_non_negative check (mistake_count >= 0),
  constraint personal_words_practice_count_non_negative check (practice_count >= 0),
  constraint personal_words_correct_streak_non_negative check (correct_streak >= 0),
  constraint personal_words_ease_factor_positive check (ease_factor > 0),
  constraint personal_words_interval_days_non_negative check (interval_days >= 0),
  constraint personal_words_pronunciation_score_non_negative
    check (pronunciation_score is null or pronunciation_score >= 0)
);

comment on table public.personal_words is
  'Per-student personal vocabulary library, one row per (student_id, normalized_term). Provenance is stored only in personal_word_sources. Authenticated users have owner-scoped SELECT only; mutations use the versioned SECURITY DEFINER RPCs. Mastery, counters, scheduling, pronunciation score, and difficulty are reserved for later phases.';

-- The unique constraint already supports student_id-only lookups. This
-- partial index is reserved for the Phase 3 due-word query.
create index personal_words_student_review_due_idx
  on public.personal_words (student_id, review_due_at)
  where archived_at is null;

create trigger personal_words_set_updated_at
before update on public.personal_words
for each row
execute function public.set_updated_at();

create table public.personal_word_sources (
  id uuid primary key default gen_random_uuid(),
  personal_word_id uuid not null
    references public.personal_words (id) on delete cascade,
  source_type text not null check (
    source_type in (
      'teacher_vocabulary_word',
      'teacher_pronunciation_word',
      'self_added'
    )
  ),
  vocabulary_word_id uuid
    references public.vocabulary_words (id) on delete set null,
  pronunciation_task_word_id uuid
    references public.pronunciation_task_words (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint personal_word_sources_reference_shape_check check (
    num_nonnulls(vocabulary_word_id, pronunciation_task_word_id) <= 1
  )
);

comment on table public.personal_word_sources is
  'Append-only history of how a personal word entered the library. Exact source_type/reference matching is validated by attach_personal_word_source_v1 at insert time. Teacher source FKs use ON DELETE SET NULL so provenance survives removal of the cited row. Authenticated users have owner-scoped SELECT only.';

create index personal_word_sources_personal_word_id_idx
  on public.personal_word_sources (personal_word_id);
create unique index personal_word_sources_vocab_uidx
  on public.personal_word_sources (personal_word_id, vocabulary_word_id)
  where vocabulary_word_id is not null;
create unique index personal_word_sources_pron_uidx
  on public.personal_word_sources (personal_word_id, pronunciation_task_word_id)
  where pronunciation_task_word_id is not null;
create unique index personal_word_sources_self_uidx
  on public.personal_word_sources (personal_word_id, source_type)
  where source_type = 'self_added';

-- ============================================================================
-- RLS and grants
-- ============================================================================

alter table public.personal_words enable row level security;

create policy personal_words_select_own
on public.personal_words
for select
to authenticated
using (
  private.is_ready_profile()
  and student_id = private.current_student_id()
);

alter table public.personal_word_sources enable row level security;

create policy personal_word_sources_select_own
on public.personal_word_sources
for select
to authenticated
using (
  private.is_ready_profile()
  and exists (
    select 1
    from public.personal_words as word
    where word.id = personal_word_sources.personal_word_id
      and word.student_id = private.current_student_id()
  )
);

-- Fail closed even if a future project default ACL changes. Authenticated
-- receives SELECT only; every write goes through the RPCs below.
revoke all on table public.personal_words from public, anon, authenticated;
revoke all on table public.personal_word_sources from public, anon, authenticated;

grant select on public.personal_words to authenticated;
grant select, insert, update, delete on public.personal_words to service_role;

grant select on public.personal_word_sources to authenticated;
grant select, insert, update, delete on public.personal_word_sources to service_role;

-- ============================================================================
-- RPCs
-- ============================================================================

-- Concurrency-safe normalized upsert. A nonblank meaning patches the stored
-- meaning; null/blank preserves it on conflict. Re-adding unarchives the row.
create function public.upsert_personal_word_v1(
  p_term text,
  p_meaning text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_normalized text;
  v_word_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first'
      using errcode = '28000';
  end if;

  v_student_id := private.current_student_id();
  if v_student_id is null then
    raise exception 'caller is not an active student' using errcode = '28000';
  end if;

  if p_term is null or btrim(p_term) = '' then
    raise exception 'p_term must not be blank' using errcode = '22023';
  end if;

  v_normalized := private.normalize_spelling(p_term);

  insert into public.personal_words as personal_word (
    student_id,
    term,
    normalized_term,
    meaning
  )
  values (
    v_student_id,
    btrim(p_term),
    v_normalized,
    nullif(btrim(coalesce(p_meaning, '')), '')
  )
  on conflict (student_id, normalized_term)
  do update set
    term = excluded.term,
    meaning = coalesce(excluded.meaning, personal_word.meaning),
    archived_at = null
  returning personal_word.id into v_word_id;

  return v_word_id;
end;
$$;

-- Attach one provenance record. Teacher sources must be visible to the
-- student at attach time. Each branch is idempotent against its matching
-- partial unique index; deletion of a cited teacher word later preserves the
-- source row and nulls only its FK.
create function public.attach_personal_word_source_v1(
  p_personal_word_id uuid,
  p_source_type text,
  p_source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_source_id uuid;
  v_vocab_set_id uuid;
  v_vocab_archived_at timestamptz;
  v_task_id uuid;
  v_word_archived_at timestamptz;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first'
      using errcode = '28000';
  end if;

  v_student_id := private.current_student_id();
  if v_student_id is null then
    raise exception 'caller is not an active student' using errcode = '28000';
  end if;

  if p_source_type is null or p_source_type not in (
    'teacher_vocabulary_word',
    'teacher_pronunciation_word',
    'self_added'
  ) then
    raise exception 'unknown source_type %', p_source_type using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.personal_words as word
    where word.id = p_personal_word_id
      and word.student_id = v_student_id
  ) then
    raise exception 'personal_word % not found or not owned by caller',
      p_personal_word_id using errcode = '42501';
  end if;

  if p_source_type = 'self_added' then
    if p_source_id is not null then
      raise exception 'p_source_id must be null for source_type self_added'
        using errcode = '22023';
    end if;

    insert into public.personal_word_sources (personal_word_id, source_type)
    values (p_personal_word_id, 'self_added')
    on conflict (personal_word_id, source_type)
      where source_type = 'self_added'
    do nothing
    returning id into v_source_id;

    if v_source_id is null then
      select source.id into v_source_id
      from public.personal_word_sources as source
      where source.personal_word_id = p_personal_word_id
        and source.source_type = 'self_added';
    end if;

    return v_source_id;
  end if;

  if p_source_type = 'teacher_vocabulary_word' then
    if p_source_id is null then
      raise exception 'p_source_id is required for source_type teacher_vocabulary_word'
        using errcode = '22023';
    end if;

    select word.set_id, word.archived_at
    into v_vocab_set_id, v_vocab_archived_at
    from public.vocabulary_words as word
    where word.id = p_source_id;

    if v_vocab_set_id is null then
      raise exception 'vocabulary_word % not found', p_source_id
        using errcode = '42501';
    end if;

    if v_vocab_archived_at is not null or not exists (
      select 1
      from public.vocabulary_sets as vocabulary_set
      join public.vocabulary_targets as target
        on target.set_id = vocabulary_set.id
      where vocabulary_set.id = v_vocab_set_id
        and vocabulary_set.published_at is not null
        and vocabulary_set.archived_at is null
        and target.student_id = v_student_id
        and target.revoked_at is null
    ) then
      raise exception 'vocabulary_word % is not currently visible to caller',
        p_source_id using errcode = '42501';
    end if;

    insert into public.personal_word_sources (
      personal_word_id,
      source_type,
      vocabulary_word_id
    )
    values (p_personal_word_id, 'teacher_vocabulary_word', p_source_id)
    on conflict (personal_word_id, vocabulary_word_id)
      where vocabulary_word_id is not null
    do nothing
    returning id into v_source_id;

    if v_source_id is null then
      select source.id into v_source_id
      from public.personal_word_sources as source
      where source.personal_word_id = p_personal_word_id
        and source.vocabulary_word_id = p_source_id;
    end if;

    return v_source_id;
  end if;

  -- p_source_type = 'teacher_pronunciation_word'
  if p_source_id is null then
    raise exception 'p_source_id is required for source_type teacher_pronunciation_word'
      using errcode = '22023';
  end if;

  select task_word.task_id, task_word.archived_at
  into v_task_id, v_word_archived_at
  from public.pronunciation_task_words as task_word
  where task_word.id = p_source_id;

  if v_task_id is null then
    raise exception 'pronunciation_task_word % not found', p_source_id
      using errcode = '42501';
  end if;

  if v_word_archived_at is not null
     or not private.can_view_pronunciation_task(v_task_id) then
    raise exception 'pronunciation_task_word % is not currently visible to caller',
      p_source_id using errcode = '42501';
  end if;

  insert into public.personal_word_sources (
    personal_word_id,
    source_type,
    pronunciation_task_word_id
  )
  values (p_personal_word_id, 'teacher_pronunciation_word', p_source_id)
  on conflict (personal_word_id, pronunciation_task_word_id)
    where pronunciation_task_word_id is not null
  do nothing
  returning id into v_source_id;

  if v_source_id is null then
    select source.id into v_source_id
    from public.personal_word_sources as source
    where source.personal_word_id = p_personal_word_id
      and source.pronunciation_task_word_id = p_source_id;
  end if;

  return v_source_id;
end;
$$;

-- Idempotent archive. The row lock serializes archive/re-add operations on
-- the same word; public.set_updated_at() owns the updated_at write.
create function public.archive_personal_word_v1(p_personal_word_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_archived_at timestamptz;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first'
      using errcode = '28000';
  end if;

  v_student_id := private.current_student_id();
  if v_student_id is null then
    raise exception 'caller is not an active student' using errcode = '28000';
  end if;

  select word.archived_at into v_archived_at
  from public.personal_words as word
  where word.id = p_personal_word_id
    and word.student_id = v_student_id
  for update;

  if not found then
    raise exception 'personal_word % not found or not owned by caller',
      p_personal_word_id using errcode = '42501';
  end if;

  if v_archived_at is null then
    update public.personal_words
    set archived_at = now()
    where id = p_personal_word_id;
  end if;
end;
$$;

revoke execute on function public.upsert_personal_word_v1(text, text)
  from public, anon;
revoke execute on function public.attach_personal_word_source_v1(uuid, text, uuid)
  from public, anon;
revoke execute on function public.archive_personal_word_v1(uuid)
  from public, anon;

grant execute on function public.upsert_personal_word_v1(text, text)
  to authenticated;
grant execute on function public.attach_personal_word_source_v1(uuid, text, uuid)
  to authenticated;
grant execute on function public.archive_personal_word_v1(uuid)
  to authenticated;
