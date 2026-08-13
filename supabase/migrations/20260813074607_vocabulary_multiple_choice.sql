-- General-purpose multiple-choice question type, v2 engine only, per-word
-- override only (no set-level default -- see plan doc for why: the bulk
-- add-words form has no entry point to author MC content, so a set
-- defaulting to MC with no way to create valid questions would be a dead
-- end). A teacher writes a free-form prompt (question_prompt) and free-form
-- choices (vocabulary_word_choices), not tied to a word's term/meaning.

-- ============================================================================
-- 1. vocabulary_words.question_prompt -- dedicated column, NOT a reuse of
-- term/meaning. Those columns are read throughout the codebase (TTS
-- language selection, alt-answer tables keyed to "English term" vs "Chinese
-- meaning", search/display) as meaning specifically "English word"/"Chinese
-- meaning" -- overloading them for arbitrary MC prompt text would be
-- semantic pollution. term/meaning are left completely untouched by the MC
-- feature (no server action or RPC ever rewrites them for an MC row), so
-- typed -> multiple_choice -> typed is fully reversible with zero data loss.
-- ============================================================================

alter table public.vocabulary_words add column question_prompt text;

alter table public.vocabulary_words add constraint vocabulary_words_question_prompt_format
  check (question_prompt is null or (btrim(question_prompt) <> '' and char_length(question_prompt) <= 500));

-- Expressible directly on vocabulary_words (no need to look at the parent
-- set) precisely because MC is per-word-override-only: override_input_mode
-- is the one column that can unambiguously mean "this row is MC."
alter table public.vocabulary_words add constraint vocabulary_words_question_prompt_required_for_mc
  check (override_input_mode <> 'multiple_choice' or question_prompt is not null);

comment on column public.vocabulary_words.question_prompt is
  'MC-only free-form question text, populated only when override_input_mode = multiple_choice (enforced by vocabulary_words_question_prompt_required_for_mc). Never displayed or read for any other input mode -- term/meaning keep whatever value they already held before the word was switched to multiple_choice.';

-- Nothing auto-grants in this Supabase project -- updateVocabularyWord()
-- writes this column via a direct table update, not an RPC, so it needs its
-- own explicit column grant same as the override_* columns already have.
grant update (question_prompt) on public.vocabulary_words to authenticated;

-- ============================================================================
-- 2. vocabulary_word_choices -- sibling table to vocabulary_word_alt_terms/
-- vocabulary_word_alt_meanings, but choices are free-form (not accepted
-- alternate answers for term/meaning) and exactly one is_correct = true.
-- unique(word_id, choice_text) is defense in depth alongside
-- replace_vocabulary_word_choices' own rejection: two choices with
-- identical text (one correct, one not) would let a student click the wrong
-- one and still be graded correct, since grading matches by text.
-- ============================================================================

create table public.vocabulary_word_choices (
  id uuid primary key default gen_random_uuid(),
  word_id uuid not null references public.vocabulary_words (id) on delete cascade,
  choice_text text not null,
  is_correct boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint vocabulary_word_choices_format check (btrim(choice_text) <> '' and char_length(choice_text) <= 300),
  constraint vocabulary_word_choices_word_text_unique unique (word_id, choice_text)
);

comment on table public.vocabulary_word_choices is
  'Free-form answer choices for an override_input_mode=multiple_choice word. Single-correct-answer only (no multi-select), matching the reused submitted_spelling-as-answer-text submission shape and the existing binary is_correct-per-attempt grading model. on delete cascade mirrors vocabulary_word_alt_terms/vocabulary_word_alt_meanings -- frozen session snapshots (practice_session_words.choices/correct_answers) already copied what a student needs, so a later delete never rewrites history. Writes only ever go through replace_vocabulary_word_choices().';

create index vocabulary_word_choices_word_id_idx on public.vocabulary_word_choices (word_id);

alter table public.vocabulary_word_choices enable row level security;

create policy "vocabulary_word_choices_teacher_select"
on public.vocabulary_word_choices for select to authenticated
using (
  private.is_ready_profile()
  and exists (
    select 1 from public.vocabulary_words w
    where w.id = vocabulary_word_choices.word_id and private.teacher_owns_vocabulary_set(w.set_id)
  )
);

grant select on public.vocabulary_word_choices to authenticated;
grant select, insert, update, delete on public.vocabulary_word_choices to service_role;
-- No select policy for students: a session's frozen, shuffled choices are
-- read via get_practice_words_v2() only, exactly like
-- practice_session_words.correct_answers is never selected directly.

create function public.replace_vocabulary_word_choices(p_word_id uuid, p_choices jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_set_id uuid;
  v_count integer;
  v_distinct_count integer;
  v_correct_count integer;
begin
  if not private.is_ready_profile() then raise exception 'account is not active or must change password first' using errcode = '28000'; end if;
  select set_id into v_set_id from public.vocabulary_words where id = p_word_id;
  if v_set_id is null or not private.teacher_owns_vocabulary_set(v_set_id) then
    raise exception 'word % not found or not owned by caller', p_word_id using errcode = '42501';
  end if;

  select count(*), count(distinct btrim(c->>'choiceText')), count(*) filter (where (c->>'isCorrect')::boolean)
  into v_count, v_distinct_count, v_correct_count
  from jsonb_array_elements(coalesce(p_choices, '[]'::jsonb)) c
  where btrim(c->>'choiceText') <> '';

  if v_count < 2 or v_count > 8 then
    raise exception 'a multiple-choice question needs between 2 and 8 non-empty choices' using errcode = '22023';
  end if;
  if v_distinct_count <> v_count then
    raise exception 'choice text must be unique within a question' using errcode = '22023';
  end if;
  if v_correct_count <> 1 then
    raise exception 'exactly one choice must be marked correct' using errcode = '22023';
  end if;

  delete from public.vocabulary_word_choices where word_id = p_word_id;
  insert into public.vocabulary_word_choices (word_id, choice_text, is_correct, sort_order)
  select p_word_id, btrim(c->>'choiceText'), (c->>'isCorrect')::boolean, ord - 1
  from jsonb_array_elements(p_choices) with ordinality as t(c, ord)
  where btrim(c->>'choiceText') <> '';
end;
$$;

revoke execute on function public.replace_vocabulary_word_choices(uuid, jsonb) from public, anon;
grant execute on function public.replace_vocabulary_word_choices(uuid, jsonb) to authenticated;

-- ============================================================================
-- 3. Widen the three CHECK constraints that gate legal input_mode values.
-- vocabulary_sets.input_mode is deliberately NOT touched -- MC can never be
-- a set default (scope cut, see header). vocabulary_attempts does not gain
-- 'audio' (unchanged -- audio never writes attempt rows), but does gain
-- 'multiple_choice' (it DOES write attempt rows, same retry/grading loop as
-- typed input).
-- ============================================================================

alter table public.vocabulary_words
  drop constraint vocabulary_words_override_input_mode_check,
  add constraint vocabulary_words_override_input_mode_check
    check (override_input_mode is null or override_input_mode in ('type_english', 'type_chinese', 'audio', 'multiple_choice'));

alter table public.practice_session_words
  drop constraint practice_session_words_input_mode_check,
  add constraint practice_session_words_input_mode_check
    check (input_mode in ('type_english', 'type_chinese', 'audio', 'multiple_choice'));

alter table public.vocabulary_attempts
  drop constraint vocabulary_attempts_input_mode_check,
  add constraint vocabulary_attempts_input_mode_check
    check (input_mode in ('type_english', 'type_chinese', 'multiple_choice'));

-- ============================================================================
-- 4. practice_session_words: parallel frozen columns, populated at
-- session-freeze time by start_practice_session_v2 (below). prompt_question
-- is read by the client instead of overloading prompt_meaning; choices is
-- the shuffled-once (at freeze time) list of choice texts.
-- ============================================================================

alter table public.practice_session_words add column prompt_question text;
alter table public.practice_session_words add column choices jsonb not null default '[]'::jsonb;

comment on column public.practice_session_words.prompt_question is
  'v2 multiple_choice only: frozen copy of vocabulary_words.question_prompt at session-creation time. NULL for every other input_mode.';
comment on column public.practice_session_words.choices is
  'v2 multiple_choice only: the word''s choice_text values, shuffled once at session-creation time (order by random()), frozen for the life of the session -- buttons never visibly rearrange on retry. Empty array for every other input_mode. Grading matches by choice_text, not position, so freezing the order is a simplicity choice, not a safety requirement.';

-- ============================================================================
-- 5. get_practice_words_v2: RETURNS TABLE column list changes (adds
-- prompt_question, choices), so this needs DROP FUNCTION first -- Postgres
-- refuses CREATE OR REPLACE when the output column list changes.
-- ============================================================================

drop function if exists public.get_practice_words_v2(uuid);

create function public.get_practice_words_v2(p_session_id uuid)
returns table (
  word_id uuid, source_sort_order integer, prompt_term text, prompt_meaning text, prompt_image_url text,
  show_english boolean, show_chinese boolean, play_audio boolean, autoplay_audio boolean, input_mode text,
  prompt_question text, choices jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_engine_version integer;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  select practice_engine_version into v_engine_version
  from public.practice_sessions
  where id = p_session_id and student_id = private.current_student_id();

  if v_engine_version is null then
    raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501';
  end if;
  if v_engine_version <> 2 then
    raise exception 'practice_session % uses the v1 practice engine; call get_practice_words instead', p_session_id using errcode = 'P0001';
  end if;

  return query
  select psw.word_id, psw.source_sort_order, psw.prompt_term, psw.prompt_meaning, psw.prompt_image_url,
         psw.show_english, psw.show_chinese, psw.play_audio, psw.autoplay_audio, psw.input_mode,
         psw.prompt_question, psw.choices
  from public.practice_session_words psw
  where psw.session_id = p_session_id
    and not (psw.input_mode <> 'audio' and exists (
      select 1 from public.vocabulary_attempts a where a.session_id = p_session_id and a.word_id = psw.word_id and a.is_correct))
    and not (psw.input_mode = 'audio' and exists (
      select 1 from public.vocabulary_audio_submission_files f
      join public.vocabulary_audio_submissions a on a.id = f.vocabulary_audio_submission_id
      where a.session_id = p_session_id and f.word_id = psw.word_id))
  order by psw.source_sort_order, psw.word_id;
end;
$$;

revoke execute on function public.get_practice_words_v2(uuid) from public, anon;
grant execute on function public.get_practice_words_v2(uuid) to authenticated;

-- ============================================================================
-- 6a. start_practice_session_v2: same-signature CREATE OR REPLACE.
-- Adds (a) an MC branch to the existing "no visible cue" guard -- MC's cue
-- is question_prompt itself, always shown, so an MC word is exempt from
-- needing show_english/show_chinese/play_audio/show_image; (b) a new guard
-- requiring every MC word to already have 2-8 choices with exactly one
-- correct, closing the window where a teacher has flipped a word to MC but
-- not yet saved valid choices (two independent forms, two independent
-- saves -- an unavoidable consequence of this codebase's "each editable
-- unit saves independently" pattern); (c) question_prompt/choices
-- population in the practice_session_words insert, with jsonb_agg wrapped
-- in coalesce (an aggregate over zero rows returns NULL, which would
-- violate the NOT NULL choices column).
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
        or w.override_input_mode = 'multiple_choice'
      )
  ) then
    raise exception 'vocabulary_set % has a word with no visible prompt cue under its effective display configuration', p_set_id using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.vocabulary_words w
    where w.set_id = p_set_id and w.archived_at is null and w.override_input_mode = 'multiple_choice'
      and (
        select count(*) filter (where true) < 2 or count(*) > 8 or count(*) filter (where c.is_correct) <> 1
        from public.vocabulary_word_choices c where c.word_id = w.id
      )
  ) then
    raise exception 'vocabulary_set % has a multiple-choice word with no valid answer choices configured', p_set_id using errcode = 'P0001';
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
        w.question_prompt as question_prompt,
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
      input_mode, correct_answers, prompt_question, choices
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
        when 'multiple_choice' then coalesce(
          (select array[c.choice_text] from public.vocabulary_word_choices c where c.word_id = cfg.word_id and c.is_correct limit 1),
          '{}'::text[]
        )
        else '{}'::text[]
      end,
      cfg.question_prompt,
      case when cfg.input_mode = 'multiple_choice' then (
        select coalesce(jsonb_agg(to_jsonb(c.choice_text) order by random()), '[]'::jsonb)
        from public.vocabulary_word_choices c where c.word_id = cfg.word_id
      ) else '[]'::jsonb end
    from cfg;
  end if;

  return v_session_id;
end;
$$;

comment on function public.start_practice_session_v2(uuid) is
  'practice_session_words.prompt_text/correct_answer are populated with best-effort mirror values for v2 rows (never read via the v1 path, which is guarded off) purely because those columns are NOT NULL -- the real v2 prompt/answer data lives in prompt_term/prompt_meaning/correct_answers/prompt_question/choices.';

-- ============================================================================
-- 6b. record_vocabulary_attempt_v2: same-signature CREATE OR REPLACE. Only
-- the grading CASE changes -- was a binary type_english/else, which is
-- unsafe now that a 3rd legal value (multiple_choice) exists (the same bug
-- class already hit once, see 20260812150000's header). Now an explicit
-- whitelist check plus one WHEN per legal value, no catch-all. Everything
-- else, including the dedicated v_existing_is_correct/v_existing_correct_
-- answers pair for the "already recorded" pre-check (never reuse
-- v_is_correct/v_correct_answers for that -- the other half of the same
-- prior bug class), is byte-for-byte identical to the current live version.
-- ============================================================================

create or replace function public.record_vocabulary_attempt_v2(p_session_id uuid, p_word_id uuid, p_submitted_spelling text)
returns table (is_correct boolean, correct_answers text[], was_already_recorded boolean, attempt_no integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.practice_sessions;
  v_input_mode text;
  v_prompt_term text;
  v_prompt_meaning text;
  v_correct_answers text[];
  v_is_correct boolean;
  v_next_attempt_no integer;
  v_existing_is_correct boolean;
  v_existing_correct_answers text[];
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  select * into v_session from public.practice_sessions
  where id = p_session_id and student_id = private.current_student_id()
  for update;
  if not found then raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501'; end if;
  if v_session.practice_engine_version <> 2 then
    raise exception 'practice_session % uses the v1 practice engine; call record_vocabulary_attempt instead', p_session_id using errcode = 'P0001';
  end if;

  select psw.input_mode, psw.prompt_term, psw.prompt_meaning, psw.correct_answers
  into v_input_mode, v_prompt_term, v_prompt_meaning, v_correct_answers
  from public.practice_session_words psw where psw.session_id = p_session_id and psw.word_id = p_word_id;
  if v_input_mode is null then raise exception 'word % is not part of practice_session %', p_word_id, p_session_id using errcode = 'P0001'; end if;
  if v_input_mode = 'audio' then raise exception 'word % uses audio input, not gradeable via record_vocabulary_attempt_v2', p_word_id using errcode = 'P0001'; end if;
  if v_input_mode not in ('type_english', 'type_chinese', 'multiple_choice') then
    raise exception 'word % has unsupported input_mode % for grading', p_word_id, v_input_mode using errcode = 'P0001';
  end if;

  select a.is_correct, a.correct_answers into v_existing_is_correct, v_existing_correct_answers
  from public.vocabulary_attempts a where a.session_id = p_session_id and a.word_id = p_word_id and a.is_correct = true limit 1;
  if found then return query select v_existing_is_correct, v_existing_correct_answers, true, null::integer; return; end if;

  if v_session.completed_at is not null then
    raise exception 'practice_session % is already completed', p_session_id using errcode = 'P0001';
  end if;

  select coalesce(max(va.attempt_no), 0) + 1 into v_next_attempt_no
  from public.vocabulary_attempts va where va.session_id = p_session_id and va.word_id = p_word_id;

  v_is_correct := exists (
    select 1 from unnest(v_correct_answers) ca
    where (case v_input_mode
             when 'type_english'    then private.normalize_spelling(p_submitted_spelling) = private.normalize_spelling(ca)
             when 'type_chinese'    then private.normalize_meaning_text(p_submitted_spelling) = private.normalize_meaning_text(ca)
             when 'multiple_choice' then p_submitted_spelling = ca
           end));

  insert into public.vocabulary_attempts (session_id, word_id, prompt_text, correct_answer, submitted_spelling, is_correct, prompt_term, correct_answers, attempt_no, input_mode)
  values (p_session_id, p_word_id, coalesce(v_prompt_meaning, v_prompt_term, ''), v_correct_answers[1], coalesce(p_submitted_spelling, ''), v_is_correct, v_prompt_term, v_correct_answers, v_next_attempt_no, v_input_mode);

  return query select v_is_correct, v_correct_answers, false, v_next_attempt_no;
end;
$$;

-- ============================================================================
-- 7. get_vocabulary_session_words_review: RETURNS TABLE column list changes
-- (adds prompt_question), so DROP FUNCTION first.
-- ============================================================================

drop function if exists public.get_vocabulary_session_words_review(uuid);

create function public.get_vocabulary_session_words_review(p_session_id uuid)
returns table (word_id uuid, source_sort_order integer, prompt_term text, prompt_meaning text, input_mode text, prompt_question text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_student_id uuid;
begin
  if not private.is_ready_profile() then raise exception 'account is not active or must change password first' using errcode = '28000'; end if;
  select student_id into v_student_id from public.practice_sessions where id = p_session_id;
  if v_student_id is null then raise exception 'practice_session % not found', p_session_id using errcode = '42501'; end if;
  if not (v_student_id = private.current_student_id() or private.teacher_owns_student(v_student_id)) then
    raise exception 'practice_session % not accessible to caller', p_session_id using errcode = '42501';
  end if;
  return query
  select psw.word_id, psw.source_sort_order, psw.prompt_term, psw.prompt_meaning, psw.input_mode, psw.prompt_question
  from public.practice_session_words psw
  where psw.session_id = p_session_id
  order by psw.source_sort_order, psw.word_id;
end;
$$;

revoke execute on function public.get_vocabulary_session_words_review(uuid) from public, anon;
grant execute on function public.get_vocabulary_session_words_review(uuid) to authenticated;
