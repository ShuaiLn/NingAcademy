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
;
