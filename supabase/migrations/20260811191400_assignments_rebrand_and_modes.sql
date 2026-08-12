-- Phase 3 UI + "作业" rebrand: schema support.
--
-- User-facing rebrand: "词库" (vocabulary set) disappears as its own concept
-- and becomes one of three "作业" (assignment) types: 词汇作业 (vocabulary),
-- 朗读作业 (pronunciation), 普通作业 (plain). This migration only touches the
-- database side of that: new vocabulary practice-mode columns, due dates,
-- atomic create+publish+assign RPCs, relaxed publish content-gates, the
-- storage.objects SELECT policy that was missing entirely (see below), and
-- renaming practice_session_words/vocabulary_attempts' prompt/answer columns
-- so they no longer hardcode "prompt=meaning, answer=term".
--
-- ============================================================================
-- Vocabulary practice modes
-- ============================================================================
--
-- prompt_field/show_image/audio_only default to exactly today's behavior
-- (show meaning, allow image, never speak) for every existing set.
-- audio_only needs no new column beyond itself and no new leak: the client
-- already receives whichever field is the *prompt* (never the graded
-- answer -- that invariant doesn't change), so speaking that same
-- already-transmitted string via the browser's speechSynthesis changes
-- nothing about what's exposed.
--
-- practice_session_words/vocabulary_attempts rename prompt_meaning/
-- correct_term to prompt_text/correct_answer because they can now freeze
-- either direction (prompt_field='meaning' shows meaning/grades term, or
-- the reverse) -- the old names hardcoded the one direction Phase 2 shipped.
alter table public.vocabulary_sets
  add column prompt_field text not null default 'meaning',
  add column show_image boolean not null default true,
  add column audio_only boolean not null default false,
  add column due_at timestamptz;

alter table public.vocabulary_sets
  add constraint vocabulary_sets_prompt_field_valid check (prompt_field in ('meaning', 'term'));

comment on column public.vocabulary_sets.prompt_field is
  'Which word field is shown to the student as the prompt; the other field becomes the graded answer. ''meaning'' (default) reproduces Phase 2''s only behavior: show meaning, grade term.';
comment on column public.vocabulary_sets.show_image is
  'Whether image_url is included in the per-session snapshot at all -- enforced server-side in start_practice_session(), not just hidden client-side.';
comment on column public.vocabulary_sets.audio_only is
  'When true, the client speaks the prompt via speechSynthesis instead of showing it as visible text. No server-side effect beyond this flag being readable by the (already-authorized) student.';

alter table public.assignments add column due_at timestamptz;
alter table public.pronunciation_tasks add column due_at timestamptz;

alter table public.practice_session_words rename column prompt_meaning to prompt_text;
alter table public.practice_session_words rename column correct_term to correct_answer;

alter table public.vocabulary_attempts rename column prompt_meaning to prompt_text;
alter table public.vocabulary_attempts rename column correct_term to correct_answer;

-- ============================================================================
-- Grants: extend narrow column-scoped UPDATE grants (additive -- a second
-- GRANT UPDATE (col_list) on the same table/role unions with, rather than
-- replaces, the columns already granted). Also grant DELETE for the new
-- hard-delete-unused-word/prompt feature (see policies below for why a
-- policy is required too, not just the grant).
-- ============================================================================

grant update (prompt_field, show_image, audio_only, due_at) on public.vocabulary_sets to authenticated;
grant update (due_at) on public.assignments to authenticated;
grant update (due_at) on public.pronunciation_tasks to authenticated;

grant delete on public.vocabulary_words to authenticated;
grant delete on public.pronunciation_task_words to authenticated;

-- vocabulary_words/pronunciation_task_words each currently carry three
-- separate command-scoped policies (select/insert/update), not a single FOR
-- ALL policy -- confirmed directly from 20260810232700_vocabulary.sql and
-- 20260811120000_classes_assignments_reading.sql, not assumed. Postgres RLS
-- requires a policy matching the specific command; the DELETE grant above is
-- inert without a matching DELETE policy, so one is added for each table
-- here, scoped identically to the existing teacher-ownership UPDATE policy.
create policy "vocabulary_words_teacher_delete"
on public.vocabulary_words
for delete
to authenticated
using (private.is_ready_profile() and private.teacher_owns_vocabulary_set(set_id));

create policy "pronunciation_task_words_teacher_delete"
on public.pronunciation_task_words
for delete
to authenticated
using (private.is_ready_profile() and private.teacher_owns_pronunciation_task(task_id));

-- ============================================================================
-- Storage: attachments bucket was missing a SELECT policy entirely --
-- createSignedUrl()/download would fail for every file, for every role.
-- Mirrors the exact ownership rules already encoded in the *_files SELECT
-- RLS policies: a file is readable exactly when its metadata row would
-- already be. A still-pending (unfinalized) object has no matching *_files
-- row yet, so it is correctly not readable here either.
-- ============================================================================

create function private.storage_object_readable(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.assignment_files af
      join public.assignments a on a.id = af.assignment_id
      where af.storage_object_key = p_object_name and private.can_view_assignment(a.id)
    )
    or exists (
      select 1
      from public.submission_files sf
      join public.submissions s on s.id = sf.submission_id
      where sf.storage_object_key = p_object_name
        and (s.student_id = private.current_student_id() or private.teacher_owns_student(s.student_id))
    )
    or exists (
      select 1
      from public.audio_submission_files asf
      join public.audio_submissions aus on aus.id = asf.audio_submission_id
      where asf.storage_object_key = p_object_name
        and (aus.student_id = private.current_student_id() or private.teacher_owns_student(aus.student_id))
    )
$$;

revoke execute on function private.storage_object_readable(text) from public;
grant execute on function private.storage_object_readable(text) to authenticated;

create policy "attachments_select_authorized_files"
on storage.objects
for select
to authenticated
using (bucket_id = 'attachments' and private.storage_object_readable(name));

-- ============================================================================
-- Relax publish content-gates: per explicit product decision, publishing an
-- empty vocabulary_set/pronunciation_task is now legal (content is added
-- after, via the atomic create+publish+assign flow below).
-- start_practice_session()'s own "no active words" guard is intentionally
-- left in place -- see its CREATE OR REPLACE further down -- as the actual
-- safety net for a student opening a still-empty assignment.
-- finish_audio_submission()'s ">=1 file" gate is untouched for the same
-- reason; plain assignments never had a content gate.
-- ============================================================================

create or replace function public.publish_vocabulary_set(p_set_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.vocabulary_sets;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if not private.teacher_owns_vocabulary_set(p_set_id) then
    raise exception 'vocabulary_set % not found or not owned by caller', p_set_id using errcode = '42501';
  end if;

  select * into v_set from public.vocabulary_sets where id = p_set_id for update;

  if v_set.archived_at is not null then
    raise exception 'cannot publish an archived vocabulary_set' using errcode = 'P0001';
  end if;

  if v_set.published_at is not null then
    return; -- idempotent no-op: already published
  end if;

  update public.vocabulary_sets set published_at = now() where id = p_set_id;
end;
$$;

create or replace function public.publish_pronunciation_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.pronunciation_tasks;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if not private.teacher_owns_pronunciation_task(p_task_id) then
    raise exception 'pronunciation_task % not found or not owned by caller', p_task_id using errcode = '42501';
  end if;

  select * into v_task from public.pronunciation_tasks where id = p_task_id for update;

  if v_task.archived_at is not null then
    raise exception 'cannot publish an archived pronunciation_task' using errcode = 'P0001';
  end if;

  if v_task.published_at is not null then
    return; -- idempotent no-op: already published
  end if;

  update public.pronunciation_tasks set published_at = now() where id = p_task_id;
end;
$$;

-- ============================================================================
-- start_practice_session(): now picks prompt/answer per prompt_field and
-- nulls prompt_image_url server-side when show_image=false. Ownership-check
-- and zero-word-guard order is otherwise unchanged from Phase 2.
-- ============================================================================

create or replace function public.start_practice_session(p_set_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_session_id uuid;
  v_is_new boolean;
  v_total_words integer;
  v_prompt_field text;
  v_show_image boolean;
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

  select s.prompt_field, s.show_image into v_prompt_field, v_show_image
  from public.vocabulary_sets s
  where s.id = p_set_id;

  select count(*) into v_total_words
  from public.vocabulary_words
  where set_id = p_set_id and archived_at is null;

  if v_total_words = 0 then
    raise exception 'vocabulary_set % has no active words to practice', p_set_id using errcode = 'P0001';
  end if;

  insert into public.practice_sessions (student_id, set_id, total_words)
  values (v_student_id, p_set_id, v_total_words)
  on conflict (student_id, set_id) where completed_at is null
  do update set student_id = excluded.student_id
  returning id, (xmax = 0) into v_session_id, v_is_new;

  if v_is_new then
    insert into public.practice_session_words (session_id, word_id, sort_order, prompt_text, prompt_image_url, correct_answer)
    select
      v_session_id,
      w.id,
      w.sort_order,
      case when v_prompt_field = 'term' then w.term else w.meaning end,
      case when v_show_image then w.image_url else null end,
      case when v_prompt_field = 'term' then w.meaning else w.term end
    from public.vocabulary_words w
    where w.set_id = p_set_id and w.archived_at is null
    order by w.sort_order, w.id;
  end if;

  return v_session_id;
end;
$$;

-- ============================================================================
-- get_practice_words() / record_vocabulary_attempt(): output column names
-- change (meaning/image_url -> prompt_text/prompt_image_url; correct_term ->
-- correct_answer), which CREATE OR REPLACE FUNCTION rejects for a RETURNS
-- TABLE signature (42P13) -- DROP + CREATE instead, re-issuing the
-- REVOKE/GRANT pair since DROP does not preserve grants.
--
-- record_vocabulary_attempt's locking/idempotency control flow (the `for
-- update` session lock, the idempotency check via separate v_existing_*
-- variables so it never clobbers the snapshot lookup, and dropping the
-- completed-session rejection for fresh attempts) is carried over verbatim
-- from its three accumulated Phase 2 bugfixes -- only column references are
-- renamed.
-- ============================================================================

drop function public.get_practice_words(uuid);

create function public.get_practice_words(p_session_id uuid)
returns table (word_id uuid, prompt_text text, prompt_image_url text, sort_order integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.practice_sessions ps
    where ps.id = p_session_id and ps.student_id = private.current_student_id()
  ) then
    raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501';
  end if;

  return query
    select psw.word_id, psw.prompt_text, psw.prompt_image_url, psw.sort_order
    from public.practice_session_words psw
    where psw.session_id = p_session_id
    order by psw.sort_order, psw.word_id;
end;
$$;

revoke execute on function public.get_practice_words(uuid) from public, anon;
grant execute on function public.get_practice_words(uuid) to authenticated;

drop function public.record_vocabulary_attempt(uuid, uuid, text);

create function public.record_vocabulary_attempt(
  p_session_id uuid,
  p_word_id uuid,
  p_submitted_spelling text
)
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

  select * into v_session
  from public.practice_sessions
  where id = p_session_id and student_id = private.current_student_id()
  for update;

  if not found then
    raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501';
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

  insert into public.vocabulary_attempts (session_id, word_id, prompt_text, correct_answer, submitted_spelling, is_correct)
  select p_session_id, p_word_id, psw.prompt_text, psw.correct_answer, coalesce(p_submitted_spelling, ''), v_is_correct
  from public.practice_session_words psw
  where psw.session_id = p_session_id and psw.word_id = p_word_id
  on conflict (session_id, word_id) do update set session_id = excluded.session_id
  returning vocabulary_attempts.is_correct, vocabulary_attempts.correct_answer
  into v_is_correct, v_correct_answer;

  return query select v_is_correct, v_correct_answer, false;
end;
$$;

revoke execute on function public.record_vocabulary_attempt(uuid, uuid, text) from public, anon;
grant execute on function public.record_vocabulary_attempt(uuid, uuid, text) to authenticated;

-- ============================================================================
-- Atomic create+publish+assign RPCs -- the new creation flow is one submit:
-- metadata + targets -> published immediately, content added afterward.
-- Each inserts its parent row with published_at = now() directly (bypassing
-- the old two-step draft/publish gate) and then delegates to the existing
-- standalone assign RPC, reusing its ownership/upsert/non-empty-array
-- validation rather than re-implementing it. A failure partway through
-- (e.g. an invalid target) rolls back the whole insert -- there is no
-- partially-created, unassigned row left behind.
-- ============================================================================

create function public.create_and_publish_vocabulary_set(
  p_title text,
  p_description text,
  p_prompt_field text,
  p_show_image boolean,
  p_audio_only boolean,
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

  if p_prompt_field not in ('meaning', 'term') then
    raise exception 'p_prompt_field must be meaning or term' using errcode = '22023';
  end if;

  insert into public.vocabulary_sets
    (teacher_id, title, description, prompt_field, show_image, audio_only, due_at, published_at)
  values
    (v_teacher_id, p_title, nullif(p_description, ''), p_prompt_field, p_show_image, p_audio_only, p_due_at, now())
  returning id into v_set_id;

  perform public.assign_vocabulary_set_to_students(v_set_id, p_student_ids);

  return v_set_id;
end;
$$;

create function public.create_and_publish_assignment(
  p_title text,
  p_description text,
  p_due_at timestamptz,
  p_class_ids uuid[],
  p_student_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_assignment_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'caller is not an active teacher' using errcode = '28000';
  end if;

  insert into public.assignments (teacher_id, title, description, due_at, published_at)
  values (v_teacher_id, p_title, nullif(p_description, ''), p_due_at, now())
  returning id into v_assignment_id;

  perform public.assign_assignment_to_targets(v_assignment_id, p_class_ids, p_student_ids);

  return v_assignment_id;
end;
$$;

create function public.create_and_publish_pronunciation_task(
  p_title text,
  p_description text,
  p_due_at timestamptz,
  p_class_ids uuid[],
  p_student_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_task_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'caller is not an active teacher' using errcode = '28000';
  end if;

  insert into public.pronunciation_tasks (teacher_id, title, description, due_at, published_at)
  values (v_teacher_id, p_title, nullif(p_description, ''), p_due_at, now())
  returning id into v_task_id;

  perform public.assign_pronunciation_task_to_targets(v_task_id, p_class_ids, p_student_ids);

  return v_task_id;
end;
$$;

revoke execute on function public.create_and_publish_vocabulary_set(text, text, text, boolean, boolean, timestamptz, uuid[]) from public, anon;
revoke execute on function public.create_and_publish_assignment(text, text, timestamptz, uuid[], uuid[]) from public, anon;
revoke execute on function public.create_and_publish_pronunciation_task(text, text, timestamptz, uuid[], uuid[]) from public, anon;

grant execute on function public.create_and_publish_vocabulary_set(text, text, text, boolean, boolean, timestamptz, uuid[]) to authenticated;
grant execute on function public.create_and_publish_assignment(text, text, timestamptz, uuid[], uuid[]) to authenticated;
grant execute on function public.create_and_publish_pronunciation_task(text, text, timestamptz, uuid[], uuid[]) to authenticated;
;
