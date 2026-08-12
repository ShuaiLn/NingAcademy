-- Phase 2 bugfix: record_vocabulary_attempt graded every fresh (never-
-- before-answered) word as incorrect, regardless of what was submitted
--
-- `v_correct_term` was reused for two different purposes: (1) holding the
-- frozen snapshot's correct answer, read from practice_session_words, and
-- (2) receiving the previously-recorded correct_term during the
-- idempotency check against vocabulary_attempts. In PL/pgSQL, a
-- `SELECT ... INTO` that matches zero rows assigns NULL to every target
-- variable -- so for the normal case (a genuinely new word, no prior
-- attempt), the idempotency check's "no rows found" silently clobbered
-- v_correct_term back to NULL before the grading comparison ran, making
-- every fresh submission compare the student's spelling against NULL
-- (normalized to '') instead of the real answer, which is always false.
-- Fixed by giving the idempotency check its own variables
-- (v_existing_is_correct / v_existing_correct_term) so the snapshot's
-- v_correct_term is never touched by that lookup. Caught by directly
-- calling the RPC end-to-end (a fresh, never-attempted word still came
-- back is_correct=false for a correct answer) -- not visible from reading
-- the function body in isolation without tracing PL/pgSQL's INTO
-- semantics on a zero-row result.
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

  if v_session.completed_at is not null then
    raise exception 'practice_session % is already completed', p_session_id using errcode = 'P0001';
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
