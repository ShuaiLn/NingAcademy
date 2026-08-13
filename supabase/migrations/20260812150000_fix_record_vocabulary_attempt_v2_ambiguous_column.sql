-- record_vocabulary_attempt_v2 (20260812130000_vocabulary_retry_engine_cutover.sql)
-- has two bugs, both fixed here via a same-signature CREATE OR REPLACE:
--
-- 1. Its RETURNS TABLE declares output columns named correct_answers and
--    attempt_no, which plpgsql auto-declares as variables in the function
--    body. The unqualified `correct_answers`/`attempt_no` references
--    elsewhere in the function therefore collided with those auto-declared
--    variables ("column reference is ambiguous"), so every call failed
--    outright.
-- 2. Past that, the "already answered correctly" pre-check reused
--    v_is_correct/v_correct_answers -- the same variables holding the real
--    answers array fetched moments earlier. plpgsql's `SELECT ... INTO`
--    nulls out its targets when zero rows match (the normal case for a
--    first attempt), silently wiping the answers array before grading, so
--    every submission graded as incorrect and then failed the NOT NULL
--    constraint on vocabulary_attempts.correct_answer. This is the same bug
--    class already fixed once for v1 in
--    20260811001112_vocabulary_fix_grading_variable_clobber.sql --
--    reintroduced here by reusing the same variable names for two purposes
--    instead of the dedicated v_existing_* pair v1 uses. Confirmed zero
--    rows in vocabulary_attempts for any practice_engine_version = 2
--    session, ever, before this fix.

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
             when 'type_english' then private.normalize_spelling(p_submitted_spelling) = private.normalize_spelling(ca)
             else private.normalize_meaning_text(p_submitted_spelling) = private.normalize_meaning_text(ca)
           end));

  insert into public.vocabulary_attempts (session_id, word_id, prompt_text, correct_answer, submitted_spelling, is_correct, prompt_term, correct_answers, attempt_no, input_mode)
  values (p_session_id, p_word_id, coalesce(v_prompt_meaning, v_prompt_term, ''), v_correct_answers[1], coalesce(p_submitted_spelling, ''), v_is_correct, v_prompt_term, v_correct_answers, v_next_attempt_no, v_input_mode);

  return query select v_is_correct, v_correct_answers, false, v_next_attempt_no;
end;
$$;
