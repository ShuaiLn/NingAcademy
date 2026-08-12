-- The one non-additive change in the vocabulary/reading merge feature
-- ("B-CUTOVER" in the planning doc), plus the two functions that first make
-- the v2 engine real (create_and_publish_vocabulary_set_v2 /
-- upgrade_vocabulary_set_to_v2). Both are deliberately held back to this
-- migration specifically: neither can produce the first
-- practice_engine_version = 2 row before the frontend that knows how to run
-- one (the engine router in app/student/vocabulary/practice/[sessionId]/
-- page.tsx, StartPracticeButton's branching) is also live. Apply this
-- migration and deploy the matching frontend together, back-to-back, at a
-- low-traffic time.
--
-- record_vocabulary_attempt's *external* contract (signature, return shape,
-- error conditions, idempotency guarantee) does not change here -- only
-- which physical uniqueness constraint its INSERT targets internally. That
-- is what keeps every already-open v1 session fully resumable through and
-- after this migration.

-- ============================================================================
-- The constraint change: loosen vocabulary_attempts' uniqueness so a word
-- can have more than one attempt (required for retry-until-correct).
-- ============================================================================

alter table public.vocabulary_attempts
  drop constraint vocabulary_attempts_session_id_word_id_key,
  add constraint vocabulary_attempts_session_word_attempt_key unique (session_id, word_id, attempt_no);

-- v1 sessions are permanently one-shot by construction (the old engine has
-- no retry concept), so attempt_no is hardcoded to the literal 1 here --
-- this is exactly v1's existing behavior, just expressed against the new
-- three-column constraint shape instead of the old two-column one. Same
-- signature, same return shape, same external behavior as before.
create or replace function public.record_vocabulary_attempt(p_session_id uuid, p_word_id uuid, p_submitted_spelling text)
returns table (is_correct boolean, correct_answer text, was_already_recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.practice_sessions;
  v_correct_answer text;
  v_is_correct boolean;
  v_existing_is_correct boolean;
  v_existing_correct_answer text;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  select * into v_session from public.practice_sessions
  where id = p_session_id and student_id = private.current_student_id()
  for update;

  if not found then
    raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501';
  end if;

  if v_session.practice_engine_version <> 1 then
    raise exception 'practice_session % uses the v2 practice engine; call record_vocabulary_attempt_v2 instead', p_session_id using errcode = 'P0001';
  end if;

  select psw.correct_answer into v_correct_answer
  from public.practice_session_words psw
  where psw.session_id = p_session_id and psw.word_id = p_word_id;

  if v_correct_answer is null then
    raise exception 'word % is not part of practice_session %', p_word_id, p_session_id using errcode = 'P0001';
  end if;

  select a.is_correct, a.correct_answer into v_existing_is_correct, v_existing_correct_answer
  from public.vocabulary_attempts a
  where a.session_id = p_session_id and a.word_id = p_word_id;

  if found then
    return query select v_existing_is_correct, v_existing_correct_answer, true;
    return;
  end if;

  v_is_correct := private.normalize_spelling(p_submitted_spelling) = private.normalize_spelling(v_correct_answer);

  -- correct_answers (plural) populated alongside the legacy correct_answer,
  -- same reasoning as the B-ADD version of this function -- the review page
  -- reads correct_answers uniformly for v1 and v2 sessions.
  insert into public.vocabulary_attempts (session_id, word_id, prompt_text, correct_answer, submitted_spelling, is_correct, attempt_no, correct_answers)
  select p_session_id, p_word_id, psw.prompt_text, psw.correct_answer, coalesce(p_submitted_spelling, ''), v_is_correct, 1, array[psw.correct_answer]
  from public.practice_session_words psw where psw.session_id = p_session_id and psw.word_id = p_word_id
  on conflict (session_id, word_id, attempt_no) do update set session_id = excluded.session_id
  returning vocabulary_attempts.is_correct, vocabulary_attempts.correct_answer into v_is_correct, v_correct_answer;

  return query select v_is_correct, v_correct_answer, false;
end;
$$;

-- ============================================================================
-- Chinese-answer normalization, separate from the unchanged, English-only
-- private.normalize_spelling(). Trims, collapses internal whitespace,
-- Unicode NFKC normalization (folds fullwidth ASCII/punctuation to
-- halfwidth/canonical forms), strips common leading/trailing punctuation
-- (ASCII and CJK), lowercases any Latin substrings.
-- ============================================================================

-- Uses btrim(string, characters) rather than a regexp_replace bracket
-- class -- deliberately, so the punctuation set is a plain character list
-- (order-independent, no regex bracket-escaping pitfalls around ']'/'-'/
-- embedded quotes inside a single-quoted SQL literal).
create function private.normalize_meaning_text(p_text text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select btrim(
    lower(regexp_replace(normalize(coalesce(p_text, ''), nfkc), '\s+', ' ', 'g')),
    $pn$ ，。！？、；：“”‘’（）【】《》…,.!?;:"'()[]<>-$pn$
  )
$$;

revoke execute on function private.normalize_meaning_text(text) from public;
grant execute on function private.normalize_meaning_text(text) to authenticated;

-- ============================================================================
-- record_vocabulary_attempt_v2 -- retry-until-correct grading for typed
-- words. Idempotent once a word is correct (returns the stored correct
-- result rather than erroring or re-grading); audio words are rejected
-- outright (never gradeable by comparison).
-- ============================================================================

create function public.record_vocabulary_attempt_v2(p_session_id uuid, p_word_id uuid, p_submitted_spelling text)
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

  select input_mode, prompt_term, prompt_meaning, correct_answers
  into v_input_mode, v_prompt_term, v_prompt_meaning, v_correct_answers
  from public.practice_session_words where session_id = p_session_id and word_id = p_word_id;
  if v_input_mode is null then raise exception 'word % is not part of practice_session %', p_word_id, p_session_id using errcode = 'P0001'; end if;
  if v_input_mode = 'audio' then raise exception 'word % uses audio input, not gradeable via record_vocabulary_attempt_v2', p_word_id using errcode = 'P0001'; end if;

  select a.is_correct, a.correct_answers into v_is_correct, v_correct_answers
  from public.vocabulary_attempts a where a.session_id = p_session_id and a.word_id = p_word_id and a.is_correct = true limit 1;
  if found then return query select v_is_correct, v_correct_answers, true, null::integer; return; end if;

  if v_session.completed_at is not null then
    raise exception 'practice_session % is already completed', p_session_id using errcode = 'P0001';
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_next_attempt_no
  from public.vocabulary_attempts where session_id = p_session_id and word_id = p_word_id;

  v_is_correct := exists (
    select 1 from unnest(v_correct_answers) ca
    where (case v_input_mode
             when 'type_english' then private.normalize_spelling(p_submitted_spelling) = private.normalize_spelling(ca)
             else private.normalize_meaning_text(p_submitted_spelling) = private.normalize_meaning_text(ca)
           end));

  insert into public.vocabulary_attempts (session_id, word_id, prompt_text, correct_answer, submitted_spelling, is_correct, prompt_term, correct_answers, attempt_no, input_mode)
  values (p_session_id, p_word_id, coalesce(v_prompt_meaning, v_prompt_term, ''), v_correct_answers[1], coalesce(p_submitted_spelling, ''), v_is_correct, v_prompt_term, v_correct_answers, v_next_attempt_no, v_input_mode);

  return query select v_is_correct, v_correct_answers, false, v_next_attempt_no;
end;
$$;

revoke execute on function public.record_vocabulary_attempt_v2(uuid, uuid, text) from public, anon;
grant execute on function public.record_vocabulary_attempt_v2(uuid, uuid, text) to authenticated;

-- ============================================================================
-- The only two functions that can create/upgrade a practice_engine_version =
-- 2 row. Held back to this migration -- see header.
-- ============================================================================

create function public.create_and_publish_vocabulary_set_v2(
  p_title text,
  p_description text,
  p_display_show_english boolean,
  p_display_show_chinese boolean,
  p_show_image boolean,
  p_display_play_audio boolean,
  p_display_autoplay_audio boolean,
  p_input_mode text,
  p_word_order text,
  p_allow_student_order_choice boolean,
  p_due_at timestamptz,
  p_student_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_set_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'caller is not an active teacher' using errcode = '28000';
  end if;

  if p_input_mode not in ('type_english', 'type_chinese', 'audio') then
    raise exception 'p_input_mode must be type_english, type_chinese, or audio' using errcode = '22023';
  end if;
  if p_word_order not in ('sequential', 'random') then
    raise exception 'p_word_order must be sequential or random' using errcode = '22023';
  end if;
  if p_input_mode = 'type_english' and p_display_show_english then
    raise exception 'display_show_english cannot be enabled while input_mode is type_english' using errcode = '22023';
  end if;
  if p_input_mode = 'type_chinese' and p_display_show_chinese then
    raise exception 'display_show_chinese cannot be enabled while input_mode is type_chinese' using errcode = '22023';
  end if;
  if p_display_autoplay_audio and not p_display_play_audio then
    raise exception 'display_autoplay_audio requires display_play_audio' using errcode = '22023';
  end if;

  insert into public.vocabulary_sets (
    teacher_id, title, description, due_at, published_at, practice_engine_version,
    display_show_english, display_show_chinese, show_image, display_play_audio, display_autoplay_audio,
    input_mode, word_order, allow_student_order_choice
  )
  values (
    v_teacher_id, p_title, nullif(p_description, ''), p_due_at, now(), 2,
    p_display_show_english, p_display_show_chinese, p_show_image, p_display_play_audio, p_display_autoplay_audio,
    p_input_mode, p_word_order, p_allow_student_order_choice
  )
  returning id into v_set_id;

  perform public.assign_vocabulary_set_to_students(v_set_id, p_student_ids);

  return v_set_id;
end;
$$;

-- Explicit, teacher-initiated opt-in for moving an existing v1 set onto the
-- v2 engine. Blocked while a student has an in-progress session on it --
-- can't switch a session's engine out from under it mid-practice. Reuses
-- the exact same prompt_field/audio_only -> display_*/input_mode formula as
-- B-ADD's own backfill (20260812120000_vocabulary_merge_expansion.sql), so
-- an upgraded set's v2 practice behaves identically to its old v1 behavior
-- until the teacher explicitly changes something on the new edit form.
create function public.upgrade_vocabulary_set_to_v2(p_set_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_set public.vocabulary_sets;
begin
  if not private.is_ready_profile() then raise exception 'account is not active or must change password first' using errcode = '28000'; end if;
  select * into v_set from public.vocabulary_sets where id = p_set_id for update;
  if not found or not private.teacher_owns_vocabulary_set(p_set_id) then
    raise exception 'vocabulary_set % not found or not owned by caller', p_set_id using errcode = '42501';
  end if;
  if v_set.practice_engine_version = 2 then
    raise exception 'vocabulary_set % is already on the v2 engine', p_set_id using errcode = 'P0001';
  end if;
  if exists (select 1 from public.practice_sessions where set_id = p_set_id and completed_at is null) then
    raise exception 'vocabulary_set % has a student practice session in progress; it cannot be upgraded until that session is finished' using errcode = 'P0001';
  end if;
  update public.vocabulary_sets set
    practice_engine_version = 2,
    display_show_english   = (prompt_field = 'term'    and not audio_only),
    display_show_chinese   = (prompt_field = 'meaning' and not audio_only),
    display_play_audio     = audio_only,
    display_autoplay_audio = false,
    input_mode = case when prompt_field = 'term' then 'type_chinese' else 'type_english' end
  where id = p_set_id;
end;
$$;

revoke execute on function public.create_and_publish_vocabulary_set_v2(text, text, boolean, boolean, boolean, boolean, boolean, text, text, boolean, timestamptz, uuid[]) from public, anon;
revoke execute on function public.upgrade_vocabulary_set_to_v2(uuid) from public, anon;

grant execute on function public.create_and_publish_vocabulary_set_v2(text, text, boolean, boolean, boolean, boolean, boolean, text, text, boolean, timestamptz, uuid[]) to authenticated;
grant execute on function public.upgrade_vocabulary_set_to_v2(uuid) to authenticated;
