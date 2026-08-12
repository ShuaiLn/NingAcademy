-- Phase 2 bugfix: a fresh attempt for the last word could be permanently
-- lost if complete_practice_session won the race to lock the session row
--
-- record_vocabulary_attempt raised and rejected any brand-new (never-
-- before-recorded) attempt once practice_sessions.completed_at was set,
-- even though the `for update` row lock only guarantees the two functions
-- don't corrupt each other's writes -- it says nothing about which of two
-- concurrent calls (finishing the round vs. submitting the last word)
-- acquires the lock first. If complete_practice_session won, the
-- student's already-typed last answer was rejected outright and never
-- persisted anywhere: a silent loss of real input, exactly the "漏记最后
-- 一词" failure mode the Phase 2 plan calls out as unacceptable. Fixed by
-- dropping the completed-session rejection for fresh attempts entirely --
-- uniqueness is still fully enforced by vocabulary_attempts'
-- unique(session_id, word_id), and the word must still belong to the
-- session's snapshot, so this cannot be abused to record extra or
-- out-of-scope attempts; it only stops a legitimate in-flight answer from
-- being thrown away because completion happened to land first. Caught by
-- concurrently racing record_vocabulary_attempt (last word) against
-- complete_practice_session and finding only 1 of 2 expected attempt rows
-- afterward.
create or replace function public.record_vocabulary_attempt(
  p_session_id uuid,
  p_word_id uuid,
  p_submitted_spelling text
)
returns table (is_correct boolean, correct_term text, was_already_recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.practice_sessions;
  v_correct_term text;
  v_is_correct boolean;
  v_existing_is_correct boolean;
  v_existing_correct_term text;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  select * into v_session
  from public.practice_sessions
  where id = p_session_id and student_id = private.current_student_id()
  for update;

  if not found then
    raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501';
  end if;

  select psw.correct_term into v_correct_term
  from public.practice_session_words psw
  where psw.session_id = p_session_id and psw.word_id = p_word_id;

  if v_correct_term is null then
    raise exception 'word % is not part of practice_session %', p_word_id, p_session_id using errcode = 'P0001';
  end if;

  select a.is_correct, a.correct_term into v_existing_is_correct, v_existing_correct_term
  from public.vocabulary_attempts a
  where a.session_id = p_session_id and a.word_id = p_word_id;

  if found then
    return query select v_existing_is_correct, v_existing_correct_term, true;
    return;
  end if;

  v_is_correct := private.normalize_spelling(p_submitted_spelling) = private.normalize_spelling(v_correct_term);

  insert into public.vocabulary_attempts (session_id, word_id, prompt_meaning, correct_term, submitted_spelling, is_correct)
  select p_session_id, p_word_id, psw.prompt_meaning, psw.correct_term, coalesce(p_submitted_spelling, ''), v_is_correct
  from public.practice_session_words psw
  where psw.session_id = p_session_id and psw.word_id = p_word_id
  on conflict (session_id, word_id) do update set session_id = excluded.session_id
  returning vocabulary_attempts.is_correct, vocabulary_attempts.correct_term
  into v_is_correct, v_correct_term;

  return query select v_is_correct, v_correct_term, false;
end;
$$;
