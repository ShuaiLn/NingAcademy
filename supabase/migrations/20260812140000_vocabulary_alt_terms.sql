-- Multi-answer support for the English (type_english) direction, mirroring
-- the existing Chinese-side vocabulary_word_alt_meanings machinery, plus one
-- atomic RPC for "insert words + their alt-answers" so a multi-word add-word
-- form submission is all-or-nothing.

-- ============================================================================
-- vocabulary_word_alt_terms -- straight structural mirror of
-- vocabulary_word_alt_meanings (20260812120000_vocabulary_merge_expansion.sql),
-- used only by input_mode=type_english grading (start_practice_session_v2,
-- replaced below).
-- ============================================================================

create table public.vocabulary_word_alt_terms (
  id uuid primary key default gen_random_uuid(),
  word_id uuid not null references public.vocabulary_words (id) on delete cascade,
  alt_term text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint vocabulary_word_alt_terms_format check (btrim(alt_term) <> '' and char_length(alt_term) <= 100)
);

comment on table public.vocabulary_word_alt_terms is
  'Additional accepted English spellings for a word, used only by input_mode=type_english grading (record_vocabulary_attempt_v2, via the correct_answers snapshot frozen at session-creation time). on delete cascade is deliberate: an alt term has no independent existence once its word is gone, and frozen session snapshots (practice_session_words.correct_answers) already copied the accepted-answers array, so a later delete never rewrites history. Writes only ever go through replace_vocabulary_word_alt_terms().';

create index vocabulary_word_alt_terms_word_id_idx on public.vocabulary_word_alt_terms (word_id);

alter table public.vocabulary_word_alt_terms enable row level security;

create policy "vocabulary_word_alt_terms_teacher_select"
on public.vocabulary_word_alt_terms
for select
to authenticated
using (
  private.is_ready_profile()
  and exists (
    select 1 from public.vocabulary_words w
    where w.id = vocabulary_word_alt_terms.word_id and private.teacher_owns_vocabulary_set(w.set_id)
  )
);

grant select on public.vocabulary_word_alt_terms to authenticated;
grant select, insert, update, delete on public.vocabulary_word_alt_terms to service_role;

-- ============================================================================
-- replace_vocabulary_word_alt_terms -- straight copy of
-- replace_vocabulary_word_alt_meanings, alt_meaning/vocabulary_word_alt_meanings
-- swapped for alt_term/vocabulary_word_alt_terms.
-- ============================================================================

create function public.replace_vocabulary_word_alt_terms(p_word_id uuid, p_alt_terms text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_set_id uuid;
begin
  if not private.is_ready_profile() then raise exception 'account is not active or must change password first' using errcode = '28000'; end if;
  select set_id into v_set_id from public.vocabulary_words where id = p_word_id;
  if v_set_id is null or not private.teacher_owns_vocabulary_set(v_set_id) then
    raise exception 'word % not found or not owned by caller', p_word_id using errcode = '42501';
  end if;
  if p_alt_terms is not null and array_length(p_alt_terms, 1) > 10 then
    raise exception 'at most 10 alternative terms per word' using errcode = '22023';
  end if;
  delete from public.vocabulary_word_alt_terms where word_id = p_word_id;
  -- Deduped: entering the same alt term three times stores it once, keeping
  -- its first-seen position (min(ord)) so sort_order stays stable.
  insert into public.vocabulary_word_alt_terms (word_id, alt_term, sort_order)
  select p_word_id, alt_term, sort_order from (
    select trim(v) as alt_term, min(ord) - 1 as sort_order
    from unnest(coalesce(p_alt_terms, '{}')) with ordinality as t(v, ord)
    where btrim(v) <> ''
    group by trim(v)
  ) deduped
  order by sort_order;
end;
$$;

revoke execute on function public.replace_vocabulary_word_alt_terms(uuid, text[]) from public, anon;
grant execute on function public.replace_vocabulary_word_alt_terms(uuid, text[]) to authenticated;

-- ============================================================================
-- add_vocabulary_words_with_answers -- replaces the plain multi-row insert()
-- in the addVocabularyWords server action. Runs as one function body, so a
-- constraint violation or a failed alt-answer write rolls back the entire
-- batch, not just per-statement.
-- ============================================================================

create function public.add_vocabulary_words_with_answers(p_set_id uuid, p_words jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.vocabulary_sets;
  v_next_sort_order integer;
  v_word jsonb;
  v_word_id uuid;
  v_alt_answers text[];
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;
  select * into v_set from public.vocabulary_sets where id = p_set_id;
  if not found or not private.teacher_owns_vocabulary_set(p_set_id) then
    raise exception 'vocabulary_set % not found or not owned by caller', p_set_id using errcode = '42501';
  end if;

  -- max(sort_order)+1, not count(*) -- a set with a mid-sequence hard
  -- delete (e.g. sort_order 0,2 after 1 was removed) would otherwise
  -- collide count-based numbering with an existing row.
  select coalesce(max(sort_order), -1) + 1 into v_next_sort_order
  from public.vocabulary_words where set_id = p_set_id;

  for v_word in select * from jsonb_array_elements(p_words)
  loop
    insert into public.vocabulary_words (set_id, term, meaning, image_url, sort_order)
    values (p_set_id, v_word->>'term', v_word->>'meaning', nullif(v_word->>'imageUrl', ''), v_next_sort_order)
    returning id into v_word_id;

    v_next_sort_order := v_next_sort_order + 1;

    select array_agg(value order by ord) into v_alt_answers
    from jsonb_array_elements_text(coalesce(v_word->'altAnswers', '[]'::jsonb)) with ordinality as t(value, ord);

    if v_alt_answers is not null and array_length(v_alt_answers, 1) > 0 and v_set.practice_engine_version = 2 then
      if v_set.input_mode = 'type_chinese' then
        perform public.replace_vocabulary_word_alt_meanings(v_word_id, v_alt_answers);
      elsif v_set.input_mode = 'type_english' then
        perform public.replace_vocabulary_word_alt_terms(v_word_id, v_alt_answers);
      end if;
      -- v1 sets, or a v2 set in 'audio' mode, have nothing typed to accept
      -- alternates for -- silently ignored, same as the add-word form itself
      -- only ever showing the control when applicable.
    end if;
  end loop;
end;
$$;

revoke execute on function public.add_vocabulary_words_with_answers(uuid, jsonb) from public, anon;
grant execute on function public.add_vocabulary_words_with_answers(uuid, jsonb) to authenticated;

-- ============================================================================
-- start_practice_session_v2 -- same-signature CREATE OR REPLACE, changing
-- only the type_english branch of the correct_answers case to also pull from
-- vocabulary_word_alt_terms, matching the existing type_chinese branch.
-- Everything else is byte-for-byte identical to
-- 20260812120000_vocabulary_merge_expansion.sql's version.
-- ============================================================================

create or replace function public.start_practice_session_v2(p_set_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_set public.vocabulary_sets;
  v_session_id uuid;
  v_is_new boolean;
  v_total_words integer;
  v_audio_word_count integer;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_student_id := private.current_student_id();
  if v_student_id is null then
    raise exception 'caller is not an active student' using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.vocabulary_sets s
    join public.vocabulary_targets t on t.set_id = s.id
    where s.id = p_set_id
      and s.published_at is not null
      and s.archived_at is null
      and t.student_id = v_student_id
      and t.revoked_at is null
  ) then
    raise exception 'vocabulary_set % is not assigned to caller (or not published)', p_set_id using errcode = '42501';
  end if;

  select * into v_set from public.vocabulary_sets where id = p_set_id;

  if v_set.practice_engine_version <> 2 then
    raise exception 'set % uses the v1 practice engine; call start_practice_session instead', p_set_id using errcode = 'P0001';
  end if;

  select count(*) into v_total_words
  from public.vocabulary_words
  where set_id = p_set_id and archived_at is null;

  if v_total_words = 0 then
    raise exception 'vocabulary_set % has no active words to practice', p_set_id using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.vocabulary_words w
    where w.set_id = p_set_id and w.archived_at is null
      and not (
        (coalesce(w.override_show_english, v_set.display_show_english)
          and coalesce(w.override_input_mode, v_set.input_mode) <> 'type_english')
        or (coalesce(w.override_show_chinese, v_set.display_show_chinese)
          and coalesce(w.override_input_mode, v_set.input_mode) <> 'type_chinese')
        or coalesce(w.override_play_audio, v_set.display_play_audio)
        or (coalesce(w.override_show_image, v_set.show_image) and w.image_url is not null)
      )
  ) then
    raise exception 'vocabulary_set % has a word with no visible prompt cue under its effective display configuration', p_set_id using errcode = 'P0001';
  end if;

  select count(*) filter (where coalesce(w.override_input_mode, v_set.input_mode) = 'audio')
  into v_audio_word_count
  from public.vocabulary_words w
  where w.set_id = p_set_id and w.archived_at is null;

  insert into public.practice_sessions (
    student_id, set_id, total_words, practice_engine_version, audio_word_count,
    default_word_order, allow_student_order_choice
  )
  values (
    v_student_id, p_set_id, v_total_words, 2, v_audio_word_count,
    v_set.word_order, v_set.allow_student_order_choice
  )
  on conflict (student_id, set_id) where completed_at is null
  do update set student_id = excluded.student_id
  returning id, (xmax = 0) into v_session_id, v_is_new;

  if v_is_new then
    with cfg as (
      select
        w.id as word_id,
        w.sort_order as word_sort_order,
        w.term,
        w.meaning,
        w.image_url,
        coalesce(w.override_input_mode, v_set.input_mode) as input_mode,
        (coalesce(w.override_show_english, v_set.display_show_english)
          and coalesce(w.override_input_mode, v_set.input_mode) <> 'type_english') as show_english,
        (coalesce(w.override_show_chinese, v_set.display_show_chinese)
          and coalesce(w.override_input_mode, v_set.input_mode) <> 'type_chinese') as show_chinese,
        coalesce(w.override_play_audio, v_set.display_play_audio) as play_audio,
        (coalesce(w.override_show_image, v_set.show_image) and w.image_url is not null) as show_image,
        (coalesce(w.override_autoplay_audio, v_set.display_autoplay_audio)
          and coalesce(w.override_play_audio, v_set.display_play_audio)) as autoplay_audio
      from public.vocabulary_words w
      where w.set_id = p_set_id and w.archived_at is null
    )
    insert into public.practice_session_words (
      session_id, word_id, sort_order, source_sort_order,
      prompt_text, prompt_image_url, correct_answer,
      prompt_term, prompt_meaning, show_english, show_chinese, play_audio, autoplay_audio,
      input_mode, correct_answers
    )
    select
      v_session_id,
      cfg.word_id,
      cfg.word_sort_order,
      cfg.word_sort_order,
      coalesce(
        case when cfg.show_english or cfg.play_audio then cfg.term end,
        case when cfg.show_chinese then cfg.meaning end,
        ''
      ),
      case when cfg.show_image then cfg.image_url else null end,
      coalesce(
        case cfg.input_mode when 'type_english' then cfg.term when 'type_chinese' then cfg.meaning else null end,
        ''
      ),
      case when cfg.show_english or cfg.play_audio then cfg.term else null end,
      case when cfg.show_chinese then cfg.meaning else null end,
      cfg.show_english,
      cfg.show_chinese,
      cfg.play_audio,
      cfg.autoplay_audio,
      cfg.input_mode,
      case cfg.input_mode
        when 'type_english' then array[cfg.term] || coalesce(
          (select array_agg(at.alt_term order by at.sort_order) from public.vocabulary_word_alt_terms at where at.word_id = cfg.word_id),
          '{}'::text[]
        )
        when 'type_chinese' then array[cfg.meaning] || coalesce(
          (select array_agg(am.alt_meaning order by am.sort_order) from public.vocabulary_word_alt_meanings am where am.word_id = cfg.word_id),
          '{}'::text[]
        )
        else '{}'::text[]
      end
    from cfg;
  end if;

  return v_session_id;
end;
$$;

comment on function public.start_practice_session_v2(uuid) is
  'practice_session_words.prompt_text/correct_answer are populated with best-effort mirror values for v2 rows (never read via the v1 path, which is guarded off) purely because those columns are NOT NULL -- the real v2 prompt/answer data lives in prompt_term/prompt_meaning/correct_answers.';
