-- Vocabulary/reading merge, retry practice engine (v2), backward-compatible
-- expansion migration ("B-ADD" in the planning doc). Nothing existing is
-- rewritten destructively and no existing call contract changes; the two
-- exceptions (widening two CHECK constraints, and a same-signature
-- CREATE OR REPLACE on the four v1 practice RPCs to add an engine-version
-- guard) are both proven backward-compatible inline below.
--
-- IMPORTANT schema-drift note versus the original planning doc: that doc
-- was drafted against Phase 2's column names (prompt_meaning/correct_term).
-- 20260811140000_assignments_rebrand_and_modes.sql already renamed those to
-- prompt_text/correct_answer on both practice_session_words and
-- vocabulary_attempts (to stop hardcoding "prompt=meaning, answer=term").
-- This migration is written against the real, current schema -- every
-- reference below is prompt_text/correct_answer, not the stale names.
--
-- Deliberately NOT in this migration: create_and_publish_vocabulary_set_v2
-- and upgrade_vocabulary_set_to_v2 -- the two functions that can produce the
-- first practice_engine_version = 2 row. Every v2 RPC added here guards
-- practice_engine_version = 2 itself, so all of them are inert no-ops until
-- a v2 set exists; those two creation/upgrade paths are deferred to
-- 20260812130000_vocabulary_retry_engine_cutover.sql, the same release that
-- ships the frontend routing that knows what to do with a v2 set. See that
-- migration's header for the full reasoning.

-- ============================================================================
-- B-ADD.0 -- engine-version columns: the structural fix for cross-engine
-- contamination. Every practice RPC (old and new) checks this column and
-- refuses to run against a session/set belonging to the other engine.
-- ============================================================================

alter table public.vocabulary_sets
  add column practice_engine_version integer not null default 1
    check (practice_engine_version in (1, 2));

alter table public.practice_sessions
  add column practice_engine_version integer not null default 1
    check (practice_engine_version in (1, 2));

comment on column public.vocabulary_sets.practice_engine_version is
  'Which practice engine this set runs on. 1 = legacy one-shot engine (Phase 2/3). 2 = retry-until-correct engine. Only create_and_publish_vocabulary_set_v2()/upgrade_vocabulary_set_to_v2() ever write 2.';
comment on column public.practice_sessions.practice_engine_version is
  'Copied from the owning set at session-creation time (start_practice_session()/start_practice_session_v2()). Every practice RPC checks this and refuses to operate on a session belonging to the other engine.';

-- ============================================================================
-- B-ADD.1 -- vocabulary_sets: new v2 configuration columns. Old
-- prompt_field/audio_only/show_image stay forever (v1 keeps reading them
-- unchanged).
-- ============================================================================

alter table public.vocabulary_sets
  add column display_show_english boolean not null default false,
  add column display_show_chinese boolean not null default true,
  add column display_play_audio boolean not null default false,
  add column display_autoplay_audio boolean not null default false,
  add column input_mode text not null default 'type_english'
    check (input_mode in ('type_english', 'type_chinese', 'audio')),
  add column word_order text not null default 'sequential'
    check (word_order in ('sequential', 'random')),
  add column allow_student_order_choice boolean not null default false;

alter table public.vocabulary_sets
  add constraint vocabulary_sets_input_mode_display_valid check (
    not (input_mode = 'type_english' and display_show_english)
    and not (input_mode = 'type_chinese' and display_show_chinese)
  ),
  add constraint vocabulary_sets_autoplay_requires_audio
    check (not display_autoplay_audio or display_play_audio);

comment on column public.vocabulary_sets.input_mode is
  'v2 only. type_english = spell the English term; type_chinese = type a Chinese translation; audio = record pronunciation. v1 sets never read this column.';
comment on column public.vocabulary_sets.word_order is
  'v2 only, teacher default. Frozen into practice_sessions.default_word_order at session-creation time -- a later edit here never changes an in-progress session.';

-- Reproduces existing prompt_field/audio_only behavior exactly, so every
-- already-created set behaves identically once the v1 RPCs (unaffected --
-- they never read these new columns) keep running, and so
-- upgrade_vocabulary_set_to_v2() has a proven-correct formula to reuse.
update public.vocabulary_sets set
  display_show_english   = (prompt_field = 'term'    and not audio_only),
  display_show_chinese   = (prompt_field = 'meaning' and not audio_only),
  display_play_audio     = audio_only,
  display_autoplay_audio = false,
  input_mode = case when prompt_field = 'term' then 'type_chinese' else 'type_english' end;

grant update (
  display_show_english, display_show_chinese, display_play_audio, display_autoplay_audio,
  input_mode, word_order, allow_student_order_choice, show_image
) on public.vocabulary_sets to authenticated;

-- ============================================================================
-- B-ADD.2 -- vocabulary_words: nullable per-word overrides + alt-meanings.
-- ============================================================================

alter table public.vocabulary_words
  add column override_show_english boolean,
  add column override_show_chinese boolean,
  add column override_play_audio boolean,
  add column override_show_image boolean,
  add column override_autoplay_audio boolean,
  add column override_input_mode text
    check (override_input_mode is null or override_input_mode in ('type_english', 'type_chinese', 'audio'));

comment on column public.vocabulary_words.override_show_image is
  'Per-word override for whether image_url is shown, independent of vocabulary_sets.show_image -- a teacher can hide/show the image for one specific word while leaving the set default in place for the rest.';

create table public.vocabulary_word_alt_meanings (
  id uuid primary key default gen_random_uuid(),
  word_id uuid not null references public.vocabulary_words (id) on delete cascade,
  alt_meaning text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint vocabulary_word_alt_meanings_format check (btrim(alt_meaning) <> '' and char_length(alt_meaning) <= 500)
);

comment on table public.vocabulary_word_alt_meanings is
  'Additional accepted Chinese translations for a word, used only by input_mode=type_chinese grading (record_vocabulary_attempt_v2). on delete cascade is deliberate: an alt meaning has no independent existence once its word is gone, and frozen session snapshots (practice_session_words.correct_answers) already copied the accepted-answers array, so a later delete never rewrites history. Writes only ever go through replace_vocabulary_word_alt_meanings().';

create index vocabulary_word_alt_meanings_word_id_idx on public.vocabulary_word_alt_meanings (word_id);

alter table public.vocabulary_word_alt_meanings enable row level security;

create policy "vocabulary_word_alt_meanings_teacher_select"
on public.vocabulary_word_alt_meanings
for select
to authenticated
using (
  private.is_ready_profile()
  and exists (
    select 1 from public.vocabulary_words w
    where w.id = vocabulary_word_alt_meanings.word_id and private.teacher_owns_vocabulary_set(w.set_id)
  )
);

grant select on public.vocabulary_word_alt_meanings to authenticated;
grant select, insert, update, delete on public.vocabulary_word_alt_meanings to service_role;
grant update (
  override_show_english, override_show_chinese, override_play_audio,
  override_show_image, override_autoplay_audio, override_input_mode
) on public.vocabulary_words to authenticated;

-- ============================================================================
-- B-ADD.3 -- practice_session_words / vocabulary_attempts: additive columns,
-- full backfill (including in-progress sessions). Old prompt_text/
-- correct_answer/sort_order stay forever -- v1's get_practice_words()/
-- record_vocabulary_attempt() only ever read those, never the new columns.
-- ============================================================================

alter table public.practice_session_words
  add column prompt_term text,
  add column prompt_meaning text,
  add column source_sort_order integer,
  add column show_english boolean not null default false,
  add column show_chinese boolean not null default false,
  add column play_audio boolean not null default false,
  add column autoplay_audio boolean not null default false,
  add column input_mode text not null default 'type_english'
    check (input_mode in ('type_english', 'type_chinese', 'audio')),
  add column correct_answers text[] not null default '{}';

comment on column public.practice_session_words.prompt_term is
  'v2 only: the English term shown as a cue, when shown. NULL for v1 rows and for v2 rows where the term is not displayed. Distinct from prompt_text (v1''s single-direction prompt column, kept forever, never read by v2).';
comment on column public.practice_session_words.correct_answers is
  'v2 only: full accepted-answers array (multi-translation for type_chinese). Empty for input_mode=audio (never graded by comparison). v1 rows keep using the single correct_answer column.';

-- Reconstructs the split term/meaning view of an existing (v1) row from its
-- single prompt_text column, using the owning set's prompt_field to know
-- which direction that value represents. Covers every existing row --
-- attempted, unattempted, and belonging to a still-open session alike.
update public.practice_session_words psw
set
  source_sort_order = psw.sort_order,
  prompt_term    = case when vs.prompt_field = 'term'    then psw.prompt_text else null end,
  prompt_meaning = case when vs.prompt_field = 'meaning' then psw.prompt_text else null end,
  show_english = (vs.prompt_field = 'term'    and not vs.audio_only),
  show_chinese = (vs.prompt_field = 'meaning' and not vs.audio_only),
  play_audio   = vs.audio_only,
  input_mode = case when vs.prompt_field = 'term' then 'type_chinese' else 'type_english' end,
  correct_answers = array[psw.correct_answer]
from public.practice_sessions ps
join public.vocabulary_sets vs on vs.id = ps.set_id
where ps.id = psw.session_id;

alter table public.vocabulary_attempts
  add column prompt_term text,
  add column correct_answers text[] not null default '{}',
  add column attempt_no integer not null default 1 check (attempt_no > 0),
  add column input_mode text not null default 'type_english'
    check (input_mode in ('type_english', 'type_chinese'));

comment on column public.vocabulary_attempts.attempt_no is
  'v1 rows are always 1 (the old engine has no retry concept). v2 rows increment per re-attempt of the same word; the uniqueness constraint enforcing this is added in 20260812130000_vocabulary_retry_engine_cutover.sql (the one non-additive change in this whole feature).';

update public.vocabulary_attempts va
set
  prompt_term = case when vs.prompt_field = 'term' then va.prompt_text else null end,
  correct_answers = array[va.correct_answer],
  attempt_no = 1,
  input_mode = case when vs.prompt_field = 'term' then 'type_chinese' else 'type_english' end
from public.practice_sessions ps
join public.vocabulary_sets vs on vs.id = ps.set_id
where ps.id = va.session_id;

-- ============================================================================
-- B-ADD.4 -- vocabulary_audio_submissions / vocabulary_audio_submission_files.
-- Reuses the pronunciation system's recording/upload/grading *pattern*, not
-- its literal rows. Exactly one submission per practice session (full unique
-- constraint, not partial); exactly one *final* recording per word
-- (re-recording replaces via upsert, not accumulates).
-- ============================================================================

create table public.vocabulary_audio_submissions (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.vocabulary_sets (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  session_id uuid not null references public.practice_sessions (id) on delete restrict,
  attempt_no integer not null,
  note text,
  submitted_at timestamptz,
  score numeric,
  feedback_text text,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint vocabulary_audio_submissions_attempt_no_positive check (attempt_no > 0),
  constraint vocabulary_audio_submissions_note_length check (note is null or char_length(note) <= 2000),
  constraint vocabulary_audio_submissions_feedback_length check (feedback_text is null or char_length(feedback_text) <= 2000),
  constraint vocabulary_audio_submissions_score_non_negative check (score is null or score >= 0),
  constraint vocabulary_audio_submissions_session_id_key unique (session_id)
);

comment on table public.vocabulary_audio_submissions is
  'One audio submission per v2 practice session, ever (full unique(session_id), not partial) -- the only path to submitted_at being set is complete_practice_session_v2()''s auto-finish, so there is no standalone "submit the audio part" action and no way to create a second submission after the first is finished.';

create index vocabulary_audio_submissions_set_id_idx on public.vocabulary_audio_submissions (set_id);
create index vocabulary_audio_submissions_student_id_idx on public.vocabulary_audio_submissions (student_id);

create table public.vocabulary_audio_submission_files (
  id uuid primary key default gen_random_uuid(),
  vocabulary_audio_submission_id uuid not null references public.vocabulary_audio_submissions (id) on delete restrict,
  word_id uuid not null references public.vocabulary_words (id) on delete restrict,
  storage_object_key text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('audio/mpeg', 'audio/mp4', 'audio/webm')),
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  constraint vocabulary_audio_submission_files_one_per_word unique (vocabulary_audio_submission_id, word_id)
);

comment on table public.vocabulary_audio_submission_files is
  'Exactly one final recording per word: finalize_upload_v2() upserts on (vocabulary_audio_submission_id, word_id), so re-recording replaces the previous file rather than accumulating rows. The superseded storage object stops being referenced the moment that upsert runs, which the existing private.list_expired_upload_cleanup_candidates() orphan scan already sweeps generically.';

create index vocabulary_audio_submission_files_submission_id_idx on public.vocabulary_audio_submission_files (vocabulary_audio_submission_id);

create function public.protect_vocabulary_audio_submission_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.set_id is distinct from old.set_id then
    raise exception 'set_id cannot be changed' using errcode = 'P0001';
  end if;
  if new.student_id is distinct from old.student_id then
    raise exception 'student_id cannot be changed' using errcode = 'P0001';
  end if;
  if new.session_id is distinct from old.session_id then
    raise exception 'session_id cannot be changed' using errcode = 'P0001';
  end if;
  if new.attempt_no is distinct from old.attempt_no then
    raise exception 'attempt_no cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger vocabulary_audio_submissions_protect_immutable_fields
before update on public.vocabulary_audio_submissions
for each row
execute function public.protect_vocabulary_audio_submission_immutable_fields();

create function public.validate_vocabulary_audio_submission_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set_teacher_id uuid;
  v_student_teacher_id uuid;
begin
  select teacher_id into v_set_teacher_id from public.vocabulary_sets where id = new.set_id;
  select teacher_id into v_student_teacher_id from public.students where id = new.student_id;

  if v_set_teacher_id is null or v_student_teacher_id is null or v_set_teacher_id <> v_student_teacher_id then
    raise exception 'vocabulary_audio_submissions.set_id and student_id must belong to the same teacher' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger vocabulary_audio_submissions_validate_ownership
before insert on public.vocabulary_audio_submissions
for each row
execute function public.validate_vocabulary_audio_submission_ownership();

create trigger vocabulary_audio_submissions_stamp_graded_at
before update on public.vocabulary_audio_submissions
for each row
execute function public.stamp_graded_at();

revoke execute on function public.protect_vocabulary_audio_submission_immutable_fields() from public;
revoke execute on function public.validate_vocabulary_audio_submission_ownership() from public;

alter table public.vocabulary_audio_submissions enable row level security;
alter table public.vocabulary_audio_submission_files enable row level security;

create policy "vocabulary_audio_submissions_select_own_or_own_students"
on public.vocabulary_audio_submissions
for select
to authenticated
using (
  private.is_ready_profile()
  and (student_id = private.current_student_id() or private.teacher_owns_student(student_id))
);

create policy "vocabulary_audio_submissions_teacher_update_graded_fields"
on public.vocabulary_audio_submissions
for update
to authenticated
using (private.is_ready_profile() and private.teacher_owns_student(student_id) and submitted_at is not null)
with check (private.is_ready_profile() and private.teacher_owns_student(student_id) and submitted_at is not null);

create policy "vocabulary_audio_submission_files_select_via_submission"
on public.vocabulary_audio_submission_files
for select
to authenticated
using (
  private.is_ready_profile()
  and exists (
    select 1 from public.vocabulary_audio_submissions a
    where a.id = vocabulary_audio_submission_files.vocabulary_audio_submission_id
      and (a.student_id = private.current_student_id() or private.teacher_owns_student(a.student_id))
  )
);

grant select on public.vocabulary_audio_submissions to authenticated;
grant update (score, feedback_text) on public.vocabulary_audio_submissions to authenticated;
grant select, insert, update, delete on public.vocabulary_audio_submissions to service_role;

grant select on public.vocabulary_audio_submission_files to authenticated;
grant select, insert, update, delete on public.vocabulary_audio_submission_files to service_role;

-- ============================================================================
-- B-ADD.5 -- private.attempt_counters.subject_type: widen the CHECK.
-- Purely additive in effect (widening a CHECK never affects existing rows).
-- ============================================================================

alter table private.attempt_counters drop constraint attempt_counters_subject_type_check;
alter table private.attempt_counters add constraint attempt_counters_subject_type_check
  check (subject_type in ('assignment', 'pronunciation_task', 'vocabulary_set'));

-- ============================================================================
-- B-ADD.6 -- practice_sessions: audio word count + frozen order settings.
-- v1's start_practice_session() (updated below) explicitly writes
-- audio_word_count = 0 and leaves the order columns at their defaults -- v1
-- has no order-choice concept and its client never reads them.
-- ============================================================================

alter table public.practice_sessions
  add column audio_word_count integer not null default 0,
  add column default_word_order text not null default 'sequential'
    check (default_word_order in ('sequential', 'random')),
  add column allow_student_order_choice boolean not null default false,
  add column selected_word_order text
    check (selected_word_order is null or selected_word_order in ('sequential', 'random'));

comment on column public.practice_sessions.default_word_order is
  'Frozen copy of vocabulary_sets.word_order at session-creation time (start_practice_session_v2()) -- the session never re-reads the set''s live value, so a teacher edit mid-session cannot flip an in-progress session''s order.';
comment on column public.practice_sessions.selected_word_order is
  'NULL until the student picks (set_practice_session_word_order(), only when allow_student_order_choice is true), then sticky -- the RPC itself refuses to be called a second time or after the first answer.';

-- ============================================================================
-- B-ADD.7 -- the practice engine.
--
-- v1 (start_practice_session / get_practice_words / complete_practice_session
-- / record_vocabulary_attempt): each gets a same-signature, same-return-shape
-- CREATE OR REPLACE here. Every externally-observable behavior (parameters,
-- return shape, error conditions, which rows get read/graded) is preserved
-- exactly. Two additions to the internal bodies: an engine-version guard on
-- all four, and -- in start_practice_session()/record_vocabulary_attempt()
-- only -- population of the new review-support columns on
-- practice_session_words/vocabulary_attempts (source_sort_order, prompt_term,
-- prompt_meaning, show_english/show_chinese/play_audio, input_mode,
-- correct_answers), which v1's own RPCs never read back but the shared
-- per-question review page does. The guard makes "cross-engine contamination
-- is structurally impossible" true from the moment this migration ships, not
-- only after the cutover release.
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
  v_audio_only boolean;
  v_engine_version integer;
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

  select s.prompt_field, s.show_image, s.audio_only, s.practice_engine_version
  into v_prompt_field, v_show_image, v_audio_only, v_engine_version
  from public.vocabulary_sets s
  where s.id = p_set_id;

  if v_engine_version <> 1 then
    raise exception 'set % uses the v2 practice engine; call start_practice_session_v2 instead', p_set_id using errcode = 'P0001';
  end if;

  select count(*) into v_total_words
  from public.vocabulary_words
  where set_id = p_set_id and archived_at is null;

  if v_total_words = 0 then
    raise exception 'vocabulary_set % has no active words to practice', p_set_id using errcode = 'P0001';
  end if;

  insert into public.practice_sessions (student_id, set_id, total_words, practice_engine_version, audio_word_count)
  values (v_student_id, p_set_id, v_total_words, 1, 0)
  on conflict (student_id, set_id) where completed_at is null
  do update set student_id = excluded.student_id
  returning id, (xmax = 0) into v_session_id, v_is_new;

  if v_is_new then
    -- prompt_text/prompt_image_url/correct_answer are the columns v1's own
    -- get_practice_words()/record_vocabulary_attempt() actually read --
    -- unchanged. source_sort_order/prompt_term/prompt_meaning/show_english/
    -- show_chinese/play_audio/input_mode/correct_answers are populated too
    -- (same formula as this migration's one-time backfill of existing rows)
    -- purely so the shared per-question review page
    -- (get_vocabulary_session_words_review + vocabulary_attempts) reads
    -- correct values for v1 sessions created after this migration, not just
    -- historical ones -- v1's own practice RPCs never read these columns.
    insert into public.practice_session_words (
      session_id, word_id, sort_order, prompt_text, prompt_image_url, correct_answer,
      source_sort_order, prompt_term, prompt_meaning, show_english, show_chinese, play_audio,
      input_mode, correct_answers
    )
    select
      v_session_id,
      w.id,
      w.sort_order,
      case when v_prompt_field = 'term' then w.term else w.meaning end,
      case when v_show_image then w.image_url else null end,
      case when v_prompt_field = 'term' then w.meaning else w.term end,
      w.sort_order,
      case when v_prompt_field = 'term' then w.term else null end,
      case when v_prompt_field = 'meaning' then w.meaning else null end,
      (v_prompt_field = 'term' and not v_audio_only),
      (v_prompt_field = 'meaning' and not v_audio_only),
      v_audio_only,
      case when v_prompt_field = 'term' then 'type_chinese' else 'type_english' end,
      array[case when v_prompt_field = 'term' then w.meaning else w.term end]
    from public.vocabulary_words w
    where w.set_id = p_set_id and w.archived_at is null
    order by w.sort_order, w.id;
  end if;

  return v_session_id;
end;
$$;

create or replace function public.get_practice_words(p_session_id uuid)
returns table (word_id uuid, prompt_text text, prompt_image_url text, sort_order integer)
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

  if not exists (
    select 1 from public.practice_sessions ps
    where ps.id = p_session_id and ps.student_id = private.current_student_id()
  ) then
    raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501';
  end if;

  select ps.practice_engine_version into v_engine_version from public.practice_sessions ps where ps.id = p_session_id;
  if v_engine_version <> 1 then
    raise exception 'practice_session % uses the v2 practice engine; call get_practice_words_v2 instead', p_session_id using errcode = 'P0001';
  end if;

  return query
    select psw.word_id, psw.prompt_text, psw.prompt_image_url, psw.sort_order
    from public.practice_session_words psw
    where psw.session_id = p_session_id
    order by psw.sort_order, psw.word_id;
end;
$$;

create or replace function public.complete_practice_session(p_session_id uuid)
returns void
language plpgsql
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
  where id = p_session_id and student_id = private.current_student_id()
  for update;

  if not found then
    raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501';
  end if;

  if v_engine_version <> 1 then
    raise exception 'practice_session % uses the v2 practice engine; call complete_practice_session_v2 instead', p_session_id using errcode = 'P0001';
  end if;

  update public.practice_sessions
  set completed_at = now()
  where id = p_session_id and completed_at is null;
end;
$$;

create or replace function public.record_vocabulary_attempt(
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

  -- correct_answers (plural, the new v2-era column) is also populated here,
  -- not just the legacy correct_answer -- the per-question review page
  -- (get_vocabulary_session_words_review + a plain vocabulary_attempts
  -- select) reads correct_answers uniformly for v1 and v2 sessions alike,
  -- so a v1 attempt inserted after this migration still needs a real value
  -- there instead of the column's bare '{}' default.
  insert into public.vocabulary_attempts (session_id, word_id, prompt_text, correct_answer, submitted_spelling, is_correct, correct_answers)
  select p_session_id, p_word_id, psw.prompt_text, psw.correct_answer, coalesce(p_submitted_spelling, ''), v_is_correct, array[psw.correct_answer]
  from public.practice_session_words psw
  where psw.session_id = p_session_id and psw.word_id = p_word_id
  on conflict (session_id, word_id) do update set session_id = excluded.session_id
  returning vocabulary_attempts.is_correct, vocabulary_attempts.correct_answer
  into v_is_correct, v_correct_answer;

  return query select v_is_correct, v_correct_answer, false;
end;
$$;

-- ============================================================================
-- v2 -- entirely new functions, coexisting permanently alongside v1.
-- ============================================================================

-- Ownership/resume logic mirrors v1's shape. Per active word, resolves
-- effective display/input config (per-word override wins, else set
-- default), with a hard guard against a blank question (a word must always
-- present at least one cue) -- checked here as the authoritative moment, in
-- addition to a friendlier client-side check in the teacher form.
-- source_sort_order freezes the teacher's true word order unconditionally,
-- regardless of word_order/allow_student_order_choice -- presentation order
-- is resolved entirely client-side from this immutable column.
create function public.start_practice_session_v2(p_set_id uuid)
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
        when 'type_english' then array[cfg.term]
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

-- Session-level metadata in its own call, split out of get_practice_words_v2
-- so it stays available even when the remaining-words list is empty (every
-- word done but complete_practice_session_v2() hasn't run yet).
create function public.get_practice_session_state_v2(p_session_id uuid)
returns table (
  total_words integer,
  typed_word_count integer,
  audio_word_count integer,
  completed_typed_count integer,
  completed_audio_count integer,
  completed_at timestamptz,
  default_word_order text,
  allow_student_order_choice boolean,
  selected_word_order text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.practice_sessions;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  select * into v_session from public.practice_sessions
  where id = p_session_id and student_id = private.current_student_id();

  if not found then
    raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501';
  end if;

  if v_session.practice_engine_version <> 2 then
    raise exception 'practice_session % uses the v1 practice engine; call get_practice_words instead', p_session_id using errcode = 'P0001';
  end if;

  return query
  select
    v_session.total_words,
    v_session.total_words - v_session.audio_word_count,
    v_session.audio_word_count,
    (select count(distinct a.word_id)::integer from public.vocabulary_attempts a
      join public.practice_session_words psw on psw.session_id = a.session_id and psw.word_id = a.word_id
      where a.session_id = p_session_id and a.is_correct and psw.input_mode <> 'audio'),
    (select count(distinct f.word_id)::integer from public.vocabulary_audio_submission_files f
      join public.vocabulary_audio_submissions sub on sub.id = f.vocabulary_audio_submission_id
      where sub.session_id = p_session_id),
    v_session.completed_at,
    v_session.default_word_order,
    v_session.allow_student_order_choice,
    v_session.selected_word_order;
end;
$$;

-- Reads only practice_session_words, never returns correct_answers. Row
-- filter excludes typed words already correctly answered, and audio words
-- that already have a recorded file for this session.
create function public.get_practice_words_v2(p_session_id uuid)
returns table (
  word_id uuid, source_sort_order integer, prompt_term text, prompt_meaning text, prompt_image_url text,
  show_english boolean, show_chinese boolean, play_audio boolean, autoplay_audio boolean, input_mode text
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
         psw.show_english, psw.show_chinese, psw.play_audio, psw.autoplay_audio, psw.input_mode
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

-- Submits any non-empty audio draft, partial or complete -- not a
-- completeness gate. Full per-word audio coverage is checked only by the
-- client-side completedFull computation (app/_lib/vocabulary-completion.ts),
-- never here.
create function public.complete_practice_session_v2(p_session_id uuid)
returns void
language plpgsql
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
  where id = p_session_id and student_id = private.current_student_id()
  for update;

  if not found then
    raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501';
  end if;
  if v_engine_version <> 2 then
    raise exception 'practice_session % uses the v1 practice engine; call complete_practice_session instead', p_session_id using errcode = 'P0001';
  end if;

  update public.vocabulary_audio_submissions a
  set submitted_at = now()
  where a.session_id = p_session_id
    and a.submitted_at is null
    and exists (select 1 from public.vocabulary_audio_submission_files f where f.vocabulary_audio_submission_id = a.id);

  update public.practice_sessions
  set completed_at = now()
  where id = p_session_id and completed_at is null;
end;
$$;

-- ============================================================================
-- B-ADD.8 -- other new RPCs.
-- ============================================================================

-- Idempotent: a repeat call (network retry, component remount) returns the
-- existing row's id without burning a new attempt_no -- checked under the
-- session row lock, which serializes concurrent calls for the same session.
create function public.create_vocabulary_audio_submission(p_session_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.practice_sessions;
  v_id uuid;
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
  if v_session.practice_engine_version <> 2 then
    raise exception 'practice_session % does not support audio submissions', p_session_id using errcode = 'P0001';
  end if;
  if v_session.completed_at is not null then
    raise exception 'practice_session % is already completed', p_session_id using errcode = 'P0001';
  end if;

  select id into v_id from public.vocabulary_audio_submissions where session_id = p_session_id;
  if found then
    return v_id;
  end if;

  insert into public.vocabulary_audio_submissions (set_id, student_id, session_id, attempt_no, note)
  values (
    v_session.set_id, v_session.student_id, p_session_id,
    private.next_attempt_no('vocabulary_set', v_session.set_id, v_session.student_id),
    nullif(p_note, '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- One-time student order choice. Only callable before the student's first
-- answer of any kind, so a choice can never retroactively change what's
-- already been shown/graded, and never reconsidered afterward, so a page
-- refresh can't silently flip modes.
create function public.set_practice_session_word_order(p_session_id uuid, p_word_order text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_session public.practice_sessions;
begin
  if not private.is_ready_profile() then raise exception 'account is not active or must change password first' using errcode = '28000'; end if;
  if p_word_order not in ('sequential', 'random') then
    raise exception 'invalid word_order %', p_word_order using errcode = '22023';
  end if;
  select * into v_session from public.practice_sessions
  where id = p_session_id and student_id = private.current_student_id() for update;
  if not found then raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501'; end if;
  if v_session.practice_engine_version <> 2 then
    raise exception 'practice_session % does not support student order choice', p_session_id using errcode = 'P0001';
  end if;
  if not v_session.allow_student_order_choice then
    raise exception 'practice_session % does not allow the student to choose order', p_session_id using errcode = 'P0001';
  end if;
  if v_session.selected_word_order is not null then
    raise exception 'practice_session % already has an order choice recorded', p_session_id using errcode = 'P0001';
  end if;
  if exists (select 1 from public.vocabulary_attempts where session_id = p_session_id)
    or exists (select 1 from public.vocabulary_audio_submission_files f
               join public.vocabulary_audio_submissions a on a.id = f.vocabulary_audio_submission_id
               where a.session_id = p_session_id) then
    raise exception 'practice_session % already has an answer recorded; order can only be chosen before the first answer', p_session_id using errcode = 'P0001';
  end if;
  update public.practice_sessions set selected_word_order = p_word_order where id = p_session_id;
end;
$$;

-- The sanctioned read path for the per-question review UI.
-- practice_session_words has zero grants to `authenticated` and holds
-- correct_answers, which must never reach a student directly -- this
-- function deliberately returns only the prompt fields, never
-- correct_answers (callers needing correctness get that from
-- vocabulary_attempts, which is table-wide select-granted and RLS-scoped).
create function public.get_vocabulary_session_words_review(p_session_id uuid)
returns table (word_id uuid, source_sort_order integer, prompt_term text, prompt_meaning text, input_mode text)
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
  select psw.word_id, psw.source_sort_order, psw.prompt_term, psw.prompt_meaning, psw.input_mode
  from public.practice_session_words psw
  where psw.session_id = p_session_id
  order by psw.source_sort_order, psw.word_id;
end;
$$;

create function public.replace_vocabulary_word_alt_meanings(p_word_id uuid, p_alt_meanings text[])
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
  if p_alt_meanings is not null and array_length(p_alt_meanings, 1) > 10 then
    raise exception 'at most 10 alternative meanings per word' using errcode = '22023';
  end if;
  delete from public.vocabulary_word_alt_meanings where word_id = p_word_id;
  -- Deduped: entering the same alt meaning three times stores it once,
  -- keeping its first-seen position (min(ord)) so sort_order stays stable.
  insert into public.vocabulary_word_alt_meanings (word_id, alt_meaning, sort_order)
  select p_word_id, alt_meaning, sort_order from (
    select trim(v) as alt_meaning, min(ord) - 1 as sort_order
    from unnest(coalesce(p_alt_meanings, '{}')) with ordinality as t(v, ord)
    where btrim(v) <> ''
    group by trim(v)
  ) deduped
  order by sort_order;
end;
$$;

revoke execute on function public.start_practice_session_v2(uuid) from public, anon;
revoke execute on function public.get_practice_session_state_v2(uuid) from public, anon;
revoke execute on function public.get_practice_words_v2(uuid) from public, anon;
revoke execute on function public.complete_practice_session_v2(uuid) from public, anon;
revoke execute on function public.create_vocabulary_audio_submission(uuid, text) from public, anon;
revoke execute on function public.set_practice_session_word_order(uuid, text) from public, anon;
revoke execute on function public.get_vocabulary_session_words_review(uuid) from public, anon;
revoke execute on function public.replace_vocabulary_word_alt_meanings(uuid, text[]) from public, anon;

grant execute on function public.start_practice_session_v2(uuid) to authenticated;
grant execute on function public.get_practice_session_state_v2(uuid) to authenticated;
grant execute on function public.get_practice_words_v2(uuid) to authenticated;
grant execute on function public.complete_practice_session_v2(uuid) to authenticated;
grant execute on function public.create_vocabulary_audio_submission(uuid, text) to authenticated;
grant execute on function public.set_practice_session_word_order(uuid, text) to authenticated;
grant execute on function public.get_vocabulary_session_words_review(uuid) to authenticated;
grant execute on function public.replace_vocabulary_word_alt_meanings(uuid, text[]) to authenticated;

-- ============================================================================
-- B-ADD.9 -- upload pipeline extension.
--
-- begin_upload()/finalize_upload() are left completely untouched -- no
-- signature change, no DROP+CREATE. They are shared, high-traffic
-- infrastructure behind every existing upload purpose; instead this uses the
-- same pattern already used everywhere else in this codebase for a
-- signature change: new sibling functions, begin_upload_v2()/
-- finalize_upload_v2(), which are the *only* functions the new
-- vocabulary-audio upload path ever calls. Every other existing purpose
-- keeps calling the original, completely unmodified begin_upload()/
-- finalize_upload() exactly as today.
-- ============================================================================

alter table public.upload_intents add column vocabulary_word_id uuid references public.vocabulary_words (id) on delete restrict;
alter table public.upload_intents add constraint upload_intents_vocabulary_word_only_for_vocabulary_audio
  check (vocabulary_word_id is null or purpose = 'vocabulary_audio_submission_file');
alter table public.upload_intents drop constraint upload_intents_purpose_check;
alter table public.upload_intents add constraint upload_intents_purpose_check
  check (purpose in ('assignment_file', 'submission_file', 'audio_submission_file', 'exam_score_file', 'lesson_summary_file', 'vocabulary_audio_submission_file'));
create index upload_intents_vocabulary_word_id_idx on public.upload_intents (vocabulary_word_id);

create function public.begin_upload_v2(
  p_purpose text,
  p_subject_id uuid,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_task_word_id uuid default null,
  p_vocabulary_word_id uuid default null
)
returns table (intent_id uuid, storage_object_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_pending_count bigint;
  v_finalized_count bigint;
  v_pending_subject_count bigint;
  v_finalized_size bigint;
  v_pending_size bigint;
  v_sanitized_name text;
  v_key text;
  v_intent_id uuid;
  v_shared_mime_types text[] := array['image/jpeg', 'image/png', 'application/pdf', 'audio/mpeg', 'audio/mp4', 'audio/webm'];
  v_audio_mime_types text[] := array['audio/mpeg', 'audio/mp4', 'audio/webm'];
  v_photo_mime_types text[] := array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'];
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if p_purpose not in ('assignment_file', 'submission_file', 'audio_submission_file', 'exam_score_file', 'lesson_summary_file', 'vocabulary_audio_submission_file') then
    raise exception 'invalid purpose %', p_purpose using errcode = '22023';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'p_size_bytes must be positive' using errcode = '22023';
  end if;

  if p_purpose = 'assignment_file' then
    if not private.teacher_owns_assignment(p_subject_id) then
      raise exception 'assignment % not found or not owned by caller', p_subject_id using errcode = '42501';
    end if;
    if not (p_mime_type = any (v_shared_mime_types)) then
      raise exception 'mime_type % is not allowed for assignment_file', p_mime_type using errcode = 'P0001';
    end if;

  elsif p_purpose = 'submission_file' then
    if not exists (
      select 1 from public.submissions s
      where s.id = p_subject_id and s.student_id = private.current_student_id() and s.submitted_at is null
    ) then
      raise exception 'submission % not found, not owned by caller, or already submitted', p_subject_id using errcode = '42501';
    end if;
    if not (p_mime_type = any (v_shared_mime_types)) then
      raise exception 'mime_type % is not allowed for submission_file', p_mime_type using errcode = 'P0001';
    end if;

  elsif p_purpose = 'audio_submission_file' then
    if not exists (
      select 1 from public.audio_submissions a
      where a.id = p_subject_id and a.student_id = private.current_student_id() and a.submitted_at is null
    ) then
      raise exception 'audio_submission % not found, not owned by caller, or already submitted', p_subject_id using errcode = '42501';
    end if;
    if not (p_mime_type = any (v_audio_mime_types)) then
      raise exception 'mime_type % is not allowed for audio_submission_file', p_mime_type using errcode = 'P0001';
    end if;
    if p_task_word_id is not null and not exists (
      select 1
      from public.pronunciation_task_words w
      join public.audio_submissions a2 on a2.task_id = w.task_id
      where w.id = p_task_word_id and a2.id = p_subject_id
    ) then
      raise exception 'task_word % does not belong to the same task as audio_submission %', p_task_word_id, p_subject_id using errcode = 'P0001';
    end if;

  elsif p_purpose = 'exam_score_file' then
    if not exists (
      select 1
      from public.exam_scores es
      join public.exams e on e.id = es.exam_id
      where es.id = p_subject_id and e.teacher_id = private.current_teacher_id()
    ) then
      raise exception 'exam_score % not found or not owned by caller', p_subject_id using errcode = '42501';
    end if;
    if not (p_mime_type = any (v_photo_mime_types)) then
      raise exception 'mime_type % is not allowed for exam_score_file', p_mime_type using errcode = 'P0001';
    end if;

  elsif p_purpose = 'lesson_summary_file' then
    if not private.teacher_owns_lesson_summary(p_subject_id) then
      raise exception 'lesson_summary % not found or not owned by caller', p_subject_id using errcode = '42501';
    end if;
    if not (p_mime_type = any (v_photo_mime_types)) then
      raise exception 'mime_type % is not allowed for lesson_summary_file', p_mime_type using errcode = 'P0001';
    end if;

  else -- vocabulary_audio_submission_file
    if not exists (select 1 from public.vocabulary_audio_submissions a
      where a.id = p_subject_id and a.student_id = private.current_student_id() and a.submitted_at is null) then
      raise exception 'vocabulary_audio_submission % not found, not owned by caller, or already submitted', p_subject_id using errcode = '42501';
    end if;
    if p_vocabulary_word_id is null then
      raise exception 'vocabulary_word_id is required for vocabulary_audio_submission_file' using errcode = 'P0001';
    end if;
    if not (p_mime_type = any (v_audio_mime_types)) then
      raise exception 'mime_type % is not allowed for vocabulary_audio_submission_file', p_mime_type using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.vocabulary_audio_submissions a
      join public.practice_session_words psw on psw.session_id = a.session_id
      where a.id = p_subject_id and psw.word_id = p_vocabulary_word_id and psw.input_mode = 'audio'
    ) then
      raise exception 'word % is not an audio-input word in the session backing vocabulary_audio_submission %', p_vocabulary_word_id, p_subject_id using errcode = 'P0001';
    end if;
  end if;

  select count(*) into v_pending_count
  from public.upload_intents
  where uploader_id = v_caller and status = 'pending' and expires_at > now();

  if v_pending_count >= 20 then
    raise exception 'too many pending uploads (max 20)' using errcode = 'P0001';
  end if;

  if p_purpose = 'assignment_file' then
    select count(*), coalesce(sum(size_bytes), 0) into v_finalized_count, v_finalized_size
    from public.assignment_files where assignment_id = p_subject_id;
  elsif p_purpose = 'submission_file' then
    select count(*), coalesce(sum(size_bytes), 0) into v_finalized_count, v_finalized_size
    from public.submission_files where submission_id = p_subject_id;
  elsif p_purpose = 'audio_submission_file' then
    select count(*), coalesce(sum(size_bytes), 0) into v_finalized_count, v_finalized_size
    from public.audio_submission_files where audio_submission_id = p_subject_id;
  elsif p_purpose = 'exam_score_file' then
    select count(*), coalesce(sum(size_bytes), 0) into v_finalized_count, v_finalized_size
    from public.exam_score_files where exam_score_id = p_subject_id;
  elsif p_purpose = 'lesson_summary_file' then
    select count(*), coalesce(sum(size_bytes), 0) into v_finalized_count, v_finalized_size
    from public.lesson_summary_files where summary_id = p_subject_id;
  else
    select count(*), coalesce(sum(size_bytes), 0) into v_finalized_count, v_finalized_size
    from public.vocabulary_audio_submission_files where vocabulary_audio_submission_id = p_subject_id;
  end if;

  select count(*), coalesce(sum(declared_size_bytes), 0) into v_pending_subject_count, v_pending_size
  from public.upload_intents
  where subject_id = p_subject_id and purpose = p_purpose and status = 'pending' and expires_at > now();

  if v_finalized_count + v_pending_subject_count >= 10 then
    raise exception 'subject % already has too many files (max 10)', p_subject_id using errcode = 'P0001';
  end if;

  if v_finalized_size + v_pending_size + p_size_bytes > 200 * 1024 * 1024 then
    raise exception 'subject % would exceed the 200MB cumulative upload cap', p_subject_id using errcode = 'P0001';
  end if;

  v_sanitized_name := left(regexp_replace(coalesce(p_file_name, ''), '[^A-Za-z0-9.\-_]', '', 'g'), 100);
  if v_sanitized_name = '' then
    v_sanitized_name := 'file';
  end if;

  v_key := p_purpose || '/' || p_subject_id || '/' || gen_random_uuid() || '-' || v_sanitized_name;

  insert into public.upload_intents
    (uploader_id, purpose, subject_id, task_word_id, vocabulary_word_id, file_name, mime_type, declared_size_bytes, storage_object_key, expires_at)
  values
    (v_caller, p_purpose, p_subject_id, p_task_word_id, p_vocabulary_word_id, p_file_name, p_mime_type, p_size_bytes, v_key, now() + interval '30 minutes')
  returning id into v_intent_id;

  return query select v_intent_id, v_key;
end;
$$;

create function public.finalize_upload_v2(p_intent_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.upload_intents;
  v_object storage.objects;
  v_file_id uuid;
  v_caller uuid := (select auth.uid());
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  select * into v_intent
  from public.upload_intents
  where id = p_intent_id and uploader_id = v_caller
  for update;

  if not found then
    raise exception 'upload_intent % not found or not owned by caller', p_intent_id using errcode = '42501';
  end if;

  if v_intent.status = 'finalized' then
    if v_intent.purpose = 'assignment_file' then
      select id into v_file_id from public.assignment_files where storage_object_key = v_intent.storage_object_key;
    elsif v_intent.purpose = 'submission_file' then
      select id into v_file_id from public.submission_files where storage_object_key = v_intent.storage_object_key;
    elsif v_intent.purpose = 'audio_submission_file' then
      select id into v_file_id from public.audio_submission_files where storage_object_key = v_intent.storage_object_key;
    elsif v_intent.purpose = 'exam_score_file' then
      select id into v_file_id from public.exam_score_files where storage_object_key = v_intent.storage_object_key;
    elsif v_intent.purpose = 'lesson_summary_file' then
      select id into v_file_id from public.lesson_summary_files where storage_object_key = v_intent.storage_object_key;
    else
      select id into v_file_id from public.vocabulary_audio_submission_files where storage_object_key = v_intent.storage_object_key;
    end if;
    return v_file_id;
  end if;

  if v_intent.status <> 'pending' then
    raise exception 'upload_intent % is %, not pending', p_intent_id, v_intent.status using errcode = 'P0001';
  end if;

  select * into v_object from storage.objects
  where bucket_id = 'attachments' and name = v_intent.storage_object_key;

  if not found then
    raise exception 'no uploaded object found for upload_intent %', p_intent_id using errcode = 'P0001';
  end if;

  if coalesce((v_object.metadata ->> 'size')::bigint, 0) <> v_intent.declared_size_bytes then
    raise exception 'uploaded object size does not match declared size for upload_intent %', p_intent_id using errcode = 'P0001';
  end if;

  if v_intent.purpose = 'assignment_file' then
    if not exists (select 1 from public.assignments a where a.id = v_intent.subject_id and a.archived_at is null) then
      raise exception 'assignment % is archived or no longer exists', v_intent.subject_id using errcode = 'P0001';
    end if;

    insert into public.assignment_files (assignment_id, storage_object_key, file_name, mime_type, size_bytes)
    values (v_intent.subject_id, v_intent.storage_object_key, v_intent.file_name, v_intent.mime_type, v_intent.declared_size_bytes)
    returning id into v_file_id;

  elsif v_intent.purpose = 'submission_file' then
    if not exists (select 1 from public.submissions s where s.id = v_intent.subject_id and s.submitted_at is null) then
      raise exception 'submission % is already submitted or no longer exists', v_intent.subject_id using errcode = 'P0001';
    end if;

    insert into public.submission_files (submission_id, storage_object_key, file_name, mime_type, size_bytes)
    values (v_intent.subject_id, v_intent.storage_object_key, v_intent.file_name, v_intent.mime_type, v_intent.declared_size_bytes)
    returning id into v_file_id;

  elsif v_intent.purpose = 'audio_submission_file' then
    if not exists (select 1 from public.audio_submissions a where a.id = v_intent.subject_id and a.submitted_at is null) then
      raise exception 'audio_submission % is already submitted or no longer exists', v_intent.subject_id using errcode = 'P0001';
    end if;

    insert into public.audio_submission_files (audio_submission_id, task_word_id, storage_object_key, file_name, mime_type, size_bytes)
    values (v_intent.subject_id, v_intent.task_word_id, v_intent.storage_object_key, v_intent.file_name, v_intent.mime_type, v_intent.declared_size_bytes)
    returning id into v_file_id;

  elsif v_intent.purpose = 'exam_score_file' then
    if not exists (
      select 1 from public.exam_scores es
      join public.exams e on e.id = es.exam_id
      where es.id = v_intent.subject_id and e.archived_at is null
    ) then
      raise exception 'exam_score % is archived or no longer exists', v_intent.subject_id using errcode = 'P0001';
    end if;

    insert into public.exam_score_files (exam_score_id, storage_object_key, file_name, mime_type, size_bytes)
    values (v_intent.subject_id, v_intent.storage_object_key, v_intent.file_name, v_intent.mime_type, v_intent.declared_size_bytes)
    returning id into v_file_id;

  elsif v_intent.purpose = 'lesson_summary_file' then
    if not exists (select 1 from public.lesson_summaries s where s.id = v_intent.subject_id and s.archived_at is null) then
      raise exception 'lesson_summary % is archived or no longer exists', v_intent.subject_id using errcode = 'P0001';
    end if;

    insert into public.lesson_summary_files (summary_id, storage_object_key, file_name, mime_type, size_bytes)
    values (v_intent.subject_id, v_intent.storage_object_key, v_intent.file_name, v_intent.mime_type, v_intent.declared_size_bytes)
    returning id into v_file_id;

  else -- vocabulary_audio_submission_file
    if not exists (select 1 from public.vocabulary_audio_submissions a where a.id = v_intent.subject_id and a.submitted_at is null) then
      raise exception 'vocabulary_audio_submission % is already submitted or no longer exists', v_intent.subject_id using errcode = 'P0001';
    end if;

    insert into public.vocabulary_audio_submission_files (vocabulary_audio_submission_id, word_id, storage_object_key, file_name, mime_type, size_bytes)
    values (v_intent.subject_id, v_intent.vocabulary_word_id, v_intent.storage_object_key, v_intent.file_name, v_intent.mime_type, v_intent.declared_size_bytes)
    on conflict (vocabulary_audio_submission_id, word_id) do update set
      storage_object_key = excluded.storage_object_key,
      file_name = excluded.file_name,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      created_at = now()
    returning id into v_file_id;
  end if;

  update public.upload_intents
  set status = 'finalized', finalized_at = now()
  where id = p_intent_id;

  return v_file_id;
end;
$$;

create or replace function private.storage_object_readable(p_object_name text)
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
    or exists (
      select 1
      from public.exam_score_files esf
      join public.exam_scores es on es.id = esf.exam_score_id
      where esf.storage_object_key = p_object_name
        and (private.teacher_owns_exam(es.exam_id) or es.student_id = private.current_student_id())
    )
    or exists (
      select 1
      from public.lesson_summary_files lsf
      where lsf.storage_object_key = p_object_name
        and (
          private.teacher_owns_lesson_summary(lsf.summary_id)
          or exists (
            select 1 from public.lesson_summary_targets t
            where t.summary_id = lsf.summary_id and t.student_id = private.current_student_id()
          )
        )
    )
    or exists (
      select 1
      from public.vocabulary_audio_submission_files vasf
      join public.vocabulary_audio_submissions vas on vas.id = vasf.vocabulary_audio_submission_id
      where vasf.storage_object_key = p_object_name
        and (vas.student_id = private.current_student_id() or private.teacher_owns_student(vas.student_id))
    )
$$;

create or replace function private.list_expired_upload_cleanup_candidates()
returns table (intent_id uuid, storage_object_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select ui.id, ui.storage_object_key
  from public.upload_intents ui
  where ui.status = 'pending' and ui.expires_at < now()

  union all

  select null::uuid, o.name
  from storage.objects o
  where o.bucket_id = 'attachments'
    and o.created_at < now() - interval '2 hours'
    and not exists (select 1 from public.upload_intents ui2 where ui2.storage_object_key = o.name)
    and not exists (select 1 from public.assignment_files f where f.storage_object_key = o.name)
    and not exists (select 1 from public.submission_files f where f.storage_object_key = o.name)
    and not exists (select 1 from public.audio_submission_files f where f.storage_object_key = o.name)
    and not exists (select 1 from public.exam_score_files f where f.storage_object_key = o.name)
    and not exists (select 1 from public.lesson_summary_files f where f.storage_object_key = o.name)
    and not exists (select 1 from public.vocabulary_audio_submission_files f where f.storage_object_key = o.name)
$$;

revoke execute on function public.begin_upload_v2(text, uuid, text, text, bigint, uuid, uuid) from public, anon;
revoke execute on function public.finalize_upload_v2(uuid) from public, anon;

grant execute on function public.begin_upload_v2(text, uuid, text, text, bigint, uuid, uuid) to authenticated;
grant execute on function public.finalize_upload_v2(uuid) to authenticated;
