-- Phase 4: 考试成绩 (exam scores) + 课后总结 (lesson summaries).
--
-- Both are independent of the "作业" (assignment) system -- no publish/
-- submit/attempt lifecycle. An exam happens offline; the teacher records who
-- took it and grades each student's paper afterward (score starts NULL). A
-- lesson summary is one free-text teacher note targeted at students, with
-- identical content for everyone it's shared with (not a per-student row).
--
-- ============================================================================
-- The one design decision that isn't obvious: targeting is never resolved
-- from a class at read time, unlike assignment_targets/pronunciation_targets.
-- Those are ongoing/forward-looking (a student who joins a class later
-- should see past assignments targeted at it); exam scores and lesson
-- summaries are retrospective records of who was actually present for one
-- specific offline event, so dynamic resolution would let a student who
-- joins next month retroactively see an old exam/note that predates their
-- membership.
--
-- The teacher's browser resolves a selected class's *current* roster into
-- individual, individually-uncheckable student checkboxes before the form is
-- submitted (see app/teacher/exams/new/target-picker.tsx) -- the server only
-- ever receives and inserts the exact, final, teacher-confirmed student id
-- list. create_exam_with_students()/add_students_to_exam() (and the
-- lesson_summary equivalents) never expand a class themselves.
--
-- exam_source_classes/lesson_summary_source_classes are a *separate*,
-- explicitly informational concern: "which classes did the teacher use as a
-- shortcut when building this list", tracked only for a "filter by class"
-- convenience on the teacher's list pages -- never used for targeting,
-- visibility, or RLS. A student can belong to multiple selected classes at
-- once, so this is a genuine many-to-many relationship at the exam/summary
-- level, not an attribute of any individual student row.
--
-- Consequences: no revoked_at on either junction table (removing a
-- wrongly-added student is a one-time mistake, not a recurring un-assign
-- workflow) -- plain hard DELETE, FK-guarded on exam_scores via its attached
-- files (exam_score_files -> exam_scores on delete restrict) but not on
-- lesson_summary_targets (lesson_summary_files points at lesson_summaries
-- directly, never at the target row). Archiving exams/lesson_summaries does
-- NOT revoke a student's ability to see a score/summary they could already
-- see -- it only declutters the teacher's active list and blocks adding more
-- students. The only thing that revokes visibility is the teacher explicitly
-- deleting that student's row (deleteExamScore/deleteSummaryTarget).
--
-- graded_at on exam_scores stamps whenever *either* score or feedback_text
-- changes (including a reset to NULL) -- it's a "last touched" timestamp,
-- not a "has this been graded" flag. The UI's "尚未评分" state is always
-- score IS NULL, never graded_at IS NULL: a teacher can save feedback text
-- before entering a final numeric score, which stamps graded_at while score
-- is still null -- an intentional, valid intermediate state (there is no
-- publish/draft gate on this table), not a bug.
-- ============================================================================

-- ============================================================================
-- Tables
-- ============================================================================

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete restrict,
  title text not null,
  description text,
  exam_date date not null,
  full_marks numeric,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exams_title_format check (btrim(title) <> '' and char_length(title) <= 200),
  constraint exams_description_length check (description is null or char_length(description) <= 2000),
  constraint exams_full_marks_positive check (full_marks is null or full_marks > 0)
);

comment on table public.exams is
  'Teacher-recorded offline exam ("考试"). No published_at -- visibility is definitional (an exam_scores row exists for the viewer). exam_date is a plain date (not timestamptz): a day has no timezone ambiguity, unlike due_at. Never has a plain-INSERT creation path -- always created via create_exam_with_students(), which requires a non-empty student list at creation (unlike assignments, there is no later "content added after an empty publish" step here).';

create index exams_teacher_id_archived_at_exam_date_idx on public.exams (teacher_id, archived_at, exam_date);

create table public.exam_scores (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  score numeric,
  feedback_text text,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_scores_score_non_negative check (score is null or score >= 0),
  constraint exam_scores_feedback_text_length check (feedback_text is null or char_length(feedback_text) <= 2000),
  unique (exam_id, student_id)
);

comment on table public.exam_scores is
  'Combined target+score row: existence of a row is what targets a student at an exam, score NULL means ungraded. INSERT only ever happens inside create_exam_with_students()/add_students_to_exam() (no INSERT grant to authenticated). DELETE is the only "un-target" mechanism -- see migration header. graded_at is stamped by a trigger whenever score or feedback_text actually changes, including back to NULL -- see migration header for why that is not the same as "is graded".';

-- unique (exam_id, student_id) above already serves exam_id-led lookups; this
-- covers the separate "my scores" query pattern (student_id-led), which it
-- does not since student_id is not that index's leading column.
create index exam_scores_student_id_idx on public.exam_scores (student_id);

create table public.exam_score_files (
  id uuid primary key default gen_random_uuid(),
  exam_score_id uuid not null references public.exam_scores (id) on delete restrict,
  storage_object_key text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

comment on table public.exam_score_files is
  'Photo(s) of one student''s graded paper -- per-student (exam_score), since a paper is a physically separate document, possibly multi-page. INSERT only ever happens inside finalize_upload(). on delete restrict on exam_score_id is what makes deleteExamScore fail with a friendly message until every attached file is removed via delete_exam_score_file() first -- see that RPC''s comment for why deletion revokes access immediately but only reclaims Storage bytes on the next cleanup cycle.';

create index exam_score_files_exam_score_id_idx on public.exam_score_files (exam_score_id);

create table public.exam_source_classes (
  exam_id uuid not null references public.exams (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (exam_id, class_id)
);

comment on table public.exam_source_classes is
  'Informational-only record of which classes the teacher used as a targeting shortcut when building an exam''s student list -- never used for visibility or RLS on any other table. A student can belong to multiple selected classes at once, which is why this is a many-to-many join table rather than a single source_class_id column on exams.';

create index exam_source_classes_class_id_idx on public.exam_source_classes (class_id);

create table public.lesson_summaries (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete restrict,
  title text,
  content text not null,
  session_date date not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_summaries_title_format check (title is null or (btrim(title) <> '' and char_length(title) <= 200)),
  constraint lesson_summaries_content_format check (btrim(content) <> '' and char_length(content) <= 4000)
);

comment on table public.lesson_summaries is
  'One free-text teacher note about a session ("课后总结"), shared verbatim (identical content) across every student it is targeted at -- not a per-student row. title is nullable (content is the primary payload); the list view falls back to a truncated content preview when absent. Never hard-deleted; archived_at only declutters the teacher''s active list and blocks add_students_to_lesson_summary(), it does not revoke an already-visible summary.';

create index lesson_summaries_teacher_id_archived_at_session_date_idx on public.lesson_summaries (teacher_id, archived_at, session_date);

create table public.lesson_summary_targets (
  summary_id uuid not null references public.lesson_summaries (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (summary_id, student_id)
);

comment on table public.lesson_summary_targets is
  'Which students a lesson_summary is shared with. No surrogate id -- nothing references an individual target row by FK, since lesson_summary_files points at lesson_summaries directly, never at this table. deleteSummaryTarget() is a plain hard DELETE with no FK-guard branch (unlike exam_scores).';

create index lesson_summary_targets_student_id_idx on public.lesson_summary_targets (student_id);

create table public.lesson_summary_files (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid not null references public.lesson_summaries (id) on delete restrict,
  storage_object_key text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

comment on table public.lesson_summary_files is
  'Shared photo(s) attached to a lesson_summary. References lesson_summaries directly (not lesson_summary_targets), so deleteSummaryTarget() never trips an FK guard even with photos already attached.';

create index lesson_summary_files_summary_id_idx on public.lesson_summary_files (summary_id);

create table public.lesson_summary_source_classes (
  summary_id uuid not null references public.lesson_summaries (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (summary_id, class_id)
);

comment on table public.lesson_summary_source_classes is
  'Informational-only, same shape and purpose as exam_source_classes.';

create index lesson_summary_source_classes_class_id_idx on public.lesson_summary_source_classes (class_id);

-- ============================================================================
-- Trigger functions
-- ============================================================================

create function public.protect_exam_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.teacher_id is distinct from old.teacher_id then
    raise exception 'teacher_id cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger exams_set_updated_at
before update on public.exams
for each row
execute function public.set_updated_at();

create trigger exams_protect_immutable_fields
before update on public.exams
for each row
execute function public.protect_exam_immutable_fields();

-- Cross-row score validation, with the locking that makes it actually
-- correct under concurrency: each trigger takes a row lock on the table the
-- *other* one writes to, so a concurrent "raise this score" and "lower this
-- exam's full_marks" can't interleave into an invalid state. The first
-- trigger's `for update` on the exams row means it blocks behind (or is
-- blocked by) a concurrent UPDATE exams SET full_marks = ... on that same
-- row, since a plain UPDATE already holds a row lock for its transaction's
-- duration -- this is what actually closes the race, not just the existence
-- of the checks. Postgres may resolve genuine contention as a deadlock abort
-- on one side rather than a clean wait in rare interleavings; that's an
-- acceptable outcome for a low-concurrency, single-teacher system.
create function public.validate_exam_score_against_full_marks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_marks numeric;
begin
  if new.score is not null then
    select full_marks into v_full_marks from public.exams where id = new.exam_id for update;
    if v_full_marks is not null and new.score > v_full_marks then
      raise exception 'score % exceeds full_marks % for this exam', new.score, v_full_marks using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger exam_scores_validate_against_full_marks
before insert or update on public.exam_scores
for each row
execute function public.validate_exam_score_against_full_marks();

create function public.validate_exam_full_marks_not_below_scores()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.full_marks is not null and old.full_marks is distinct from new.full_marks then
    if exists (
      select 1 from public.exam_scores
      where exam_id = old.id and score is not null and score > new.full_marks
      for update
    ) then
      raise exception 'cannot lower full_marks below an already-recorded score' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger exams_validate_full_marks_not_below_scores
before update on public.exams
for each row
execute function public.validate_exam_full_marks_not_below_scores();

-- Defense-in-depth ownership validation on the cross-reference tables,
-- mirroring validate_assignment_target_ownership/validate_enrollment_ownership
-- from Phase 3: even though exam_scores/exam_source_classes are only ever
-- inserted through the RPCs below (which already validate ownership before
-- inserting), a DB-level guarantee that "these two ids belong to the same
-- teacher" is the actual invariant that prevents cross-teacher data leaks,
-- not just an RPC-layer nicety.
create function public.validate_exam_score_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam_teacher_id uuid;
  v_student_teacher_id uuid;
begin
  select teacher_id into v_exam_teacher_id from public.exams where id = new.exam_id;
  select teacher_id into v_student_teacher_id from public.students where id = new.student_id;

  if v_exam_teacher_id is null or v_student_teacher_id is null or v_exam_teacher_id <> v_student_teacher_id then
    raise exception 'exam_scores.exam_id and student_id must belong to the same teacher' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger exam_scores_validate_ownership
before insert on public.exam_scores
for each row
execute function public.validate_exam_score_ownership();

create function public.validate_exam_source_class_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam_teacher_id uuid;
  v_class_teacher_id uuid;
begin
  select teacher_id into v_exam_teacher_id from public.exams where id = new.exam_id;
  select teacher_id into v_class_teacher_id from public.classes where id = new.class_id;

  if v_exam_teacher_id is null or v_class_teacher_id is null or v_exam_teacher_id <> v_class_teacher_id then
    raise exception 'exam_source_classes.exam_id and class_id must belong to the same teacher' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger exam_source_classes_validate_ownership
before insert on public.exam_source_classes
for each row
execute function public.validate_exam_source_class_ownership();

create function public.protect_lesson_summary_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.teacher_id is distinct from old.teacher_id then
    raise exception 'teacher_id cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger lesson_summaries_set_updated_at
before update on public.lesson_summaries
for each row
execute function public.set_updated_at();

create trigger lesson_summaries_protect_immutable_fields
before update on public.lesson_summaries
for each row
execute function public.protect_lesson_summary_immutable_fields();

create function public.validate_lesson_summary_target_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary_teacher_id uuid;
  v_student_teacher_id uuid;
begin
  select teacher_id into v_summary_teacher_id from public.lesson_summaries where id = new.summary_id;
  select teacher_id into v_student_teacher_id from public.students where id = new.student_id;

  if v_summary_teacher_id is null or v_student_teacher_id is null or v_summary_teacher_id <> v_student_teacher_id then
    raise exception 'lesson_summary_targets.summary_id and student_id must belong to the same teacher' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger lesson_summary_targets_validate_ownership
before insert on public.lesson_summary_targets
for each row
execute function public.validate_lesson_summary_target_ownership();

create function public.validate_lesson_summary_source_class_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary_teacher_id uuid;
  v_class_teacher_id uuid;
begin
  select teacher_id into v_summary_teacher_id from public.lesson_summaries where id = new.summary_id;
  select teacher_id into v_class_teacher_id from public.classes where id = new.class_id;

  if v_summary_teacher_id is null or v_class_teacher_id is null or v_summary_teacher_id <> v_class_teacher_id then
    raise exception 'lesson_summary_source_classes.summary_id and class_id must belong to the same teacher' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger lesson_summary_source_classes_validate_ownership
before insert on public.lesson_summary_source_classes
for each row
execute function public.validate_lesson_summary_source_class_ownership();

-- exam_scores also gets set_updated_at (missing in an earlier draft -- see
-- migration header) and the shared stamp_graded_at() from Phase 3, which
-- hardcodes the column names score/feedback_text and applies unchanged.
create trigger exam_scores_set_updated_at
before update on public.exam_scores
for each row
execute function public.set_updated_at();

create trigger exam_scores_stamp_graded_at
before update on public.exam_scores
for each row
execute function public.stamp_graded_at();

revoke execute on function public.protect_exam_immutable_fields() from public;
revoke execute on function public.validate_exam_score_against_full_marks() from public;
revoke execute on function public.validate_exam_full_marks_not_below_scores() from public;
revoke execute on function public.validate_exam_score_ownership() from public;
revoke execute on function public.validate_exam_source_class_ownership() from public;
revoke execute on function public.protect_lesson_summary_immutable_fields() from public;
revoke execute on function public.validate_lesson_summary_target_ownership() from public;
revoke execute on function public.validate_lesson_summary_source_class_ownership() from public;

-- ============================================================================
-- private schema helpers (SECURITY DEFINER, used inside RLS policies and RPCs)
-- ============================================================================

create function private.teacher_owns_exam(p_exam_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.exams e
    where e.id = p_exam_id and e.teacher_id = private.current_teacher_id()
  )
$$;

create function private.teacher_owns_lesson_summary(p_summary_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.lesson_summaries s
    where s.id = p_summary_id and s.teacher_id = private.current_teacher_id()
  )
$$;

revoke execute on function private.teacher_owns_exam(uuid) from public;
revoke execute on function private.teacher_owns_lesson_summary(uuid) from public;

grant execute on function private.teacher_owns_exam(uuid) to authenticated;
grant execute on function private.teacher_owns_lesson_summary(uuid) to authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.exams enable row level security;
alter table public.exam_scores enable row level security;
alter table public.exam_score_files enable row level security;
alter table public.exam_source_classes enable row level security;
alter table public.lesson_summaries enable row level security;
alter table public.lesson_summary_targets enable row level security;
alter table public.lesson_summary_files enable row level security;
alter table public.lesson_summary_source_classes enable row level security;

-- exams: no INSERT policy at all -- creation always goes through
-- create_exam_with_students() (no INSERT grant to authenticated either).
create policy "exams_select_own_or_scored"
on public.exams
for select
to authenticated
using (
  private.is_ready_profile()
  and (
    teacher_id = private.current_teacher_id()
    or exists (
      select 1 from public.exam_scores es
      where es.exam_id = exams.id and es.student_id = private.current_student_id()
    )
  )
);

create policy "exams_teacher_update"
on public.exams
for update
to authenticated
using (private.is_ready_profile() and teacher_id = private.current_teacher_id())
with check (private.is_ready_profile() and teacher_id = private.current_teacher_id());

create policy "exam_scores_select_own_or_own_students"
on public.exam_scores
for select
to authenticated
using (
  private.is_ready_profile()
  and (private.teacher_owns_exam(exam_id) or student_id = private.current_student_id())
);

create policy "exam_scores_teacher_update"
on public.exam_scores
for update
to authenticated
using (private.is_ready_profile() and private.teacher_owns_exam(exam_id))
with check (private.is_ready_profile() and private.teacher_owns_exam(exam_id));

create policy "exam_scores_teacher_delete"
on public.exam_scores
for delete
to authenticated
using (private.is_ready_profile() and private.teacher_owns_exam(exam_id));

create policy "exam_score_files_select_via_exam_score"
on public.exam_score_files
for select
to authenticated
using (
  private.is_ready_profile()
  and exists (
    select 1 from public.exam_scores es
    where es.id = exam_score_files.exam_score_id
      and (private.teacher_owns_exam(es.exam_id) or es.student_id = private.current_student_id())
  )
);

-- exam_source_classes: teacher-only, no student-reachable policy at all --
-- see migration header.
create policy "exam_source_classes_teacher_select"
on public.exam_source_classes
for select
to authenticated
using (private.is_ready_profile() and private.teacher_owns_exam(exam_id));

create policy "lesson_summaries_select_own_or_targeted"
on public.lesson_summaries
for select
to authenticated
using (
  private.is_ready_profile()
  and (
    teacher_id = private.current_teacher_id()
    or exists (
      select 1 from public.lesson_summary_targets t
      where t.summary_id = lesson_summaries.id and t.student_id = private.current_student_id()
    )
  )
);

create policy "lesson_summaries_teacher_update"
on public.lesson_summaries
for update
to authenticated
using (private.is_ready_profile() and teacher_id = private.current_teacher_id())
with check (private.is_ready_profile() and teacher_id = private.current_teacher_id());

create policy "lesson_summary_targets_select_own_or_reachable"
on public.lesson_summary_targets
for select
to authenticated
using (
  private.is_ready_profile()
  and (private.teacher_owns_lesson_summary(summary_id) or student_id = private.current_student_id())
);

create policy "lesson_summary_targets_teacher_delete"
on public.lesson_summary_targets
for delete
to authenticated
using (private.is_ready_profile() and private.teacher_owns_lesson_summary(summary_id));

create policy "lesson_summary_files_select_via_summary"
on public.lesson_summary_files
for select
to authenticated
using (
  private.is_ready_profile()
  and (
    private.teacher_owns_lesson_summary(summary_id)
    or exists (
      select 1 from public.lesson_summary_targets t
      where t.summary_id = lesson_summary_files.summary_id and t.student_id = private.current_student_id()
    )
  )
);

create policy "lesson_summary_source_classes_teacher_select"
on public.lesson_summary_source_classes
for select
to authenticated
using (private.is_ready_profile() and private.teacher_owns_lesson_summary(summary_id));

-- ============================================================================
-- Grants (table privileges are not automatic on this project)
-- ============================================================================

grant select on public.exams to authenticated;
grant update (title, description, exam_date, full_marks, archived_at) on public.exams to authenticated;
grant select, insert, update, delete on public.exams to service_role;

grant select on public.exam_scores to authenticated;
grant update (score, feedback_text) on public.exam_scores to authenticated;
grant delete on public.exam_scores to authenticated;
grant select, insert, update, delete on public.exam_scores to service_role;

grant select on public.exam_score_files to authenticated;
grant select, insert, update, delete on public.exam_score_files to service_role;

grant select on public.exam_source_classes to authenticated;
grant select, insert, update, delete on public.exam_source_classes to service_role;

grant select on public.lesson_summaries to authenticated;
grant update (title, content, session_date, archived_at) on public.lesson_summaries to authenticated;
grant select, insert, update, delete on public.lesson_summaries to service_role;

grant select on public.lesson_summary_targets to authenticated;
grant delete on public.lesson_summary_targets to authenticated;
grant select, insert, update, delete on public.lesson_summary_targets to service_role;

grant select on public.lesson_summary_files to authenticated;
grant select, insert, update, delete on public.lesson_summary_files to service_role;

grant select on public.lesson_summary_source_classes to authenticated;
grant select, insert, update, delete on public.lesson_summary_source_classes to service_role;

-- ============================================================================
-- Upload-pipeline extension: widen the shared purpose CHECK and re-point the
-- four functions that branch on purpose. All four keep their exact existing
-- signatures, so CREATE OR REPLACE preserves their existing grants -- no
-- re-GRANT needed. HEIC/HEIF are included in the photo whitelist since
-- iPhones default to it for camera photos; PDF stays allowed for a scanned
-- paper. Reuses the existing 'attachments' bucket -- no new bucket.
-- ============================================================================

alter table public.upload_intents drop constraint upload_intents_purpose_check;
alter table public.upload_intents add constraint upload_intents_purpose_check
  check (purpose in ('assignment_file', 'submission_file', 'audio_submission_file', 'exam_score_file', 'lesson_summary_file'));

create or replace function public.begin_upload(
  p_purpose text,
  p_subject_id uuid,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_task_word_id uuid default null
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

  if p_purpose not in ('assignment_file', 'submission_file', 'audio_submission_file', 'exam_score_file', 'lesson_summary_file') then
    raise exception 'invalid purpose %', p_purpose using errcode = '22023';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'p_size_bytes must be positive' using errcode = '22023';
  end if;

  -- Ownership + MIME whitelist, per purpose.
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

  else -- lesson_summary_file
    if not private.teacher_owns_lesson_summary(p_subject_id) then
      raise exception 'lesson_summary % not found or not owned by caller', p_subject_id using errcode = '42501';
    end if;
    if not (p_mime_type = any (v_photo_mime_types)) then
      raise exception 'mime_type % is not allowed for lesson_summary_file', p_mime_type using errcode = 'P0001';
    end if;
  end if;

  -- Quota: global pending-intent count for this uploader.
  select count(*) into v_pending_count
  from public.upload_intents
  where uploader_id = v_caller and status = 'pending' and expires_at > now();

  if v_pending_count >= 20 then
    raise exception 'too many pending uploads (max 20)' using errcode = 'P0001';
  end if;

  -- Quota: per-subject file count + cumulative declared size.
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
  else
    select count(*), coalesce(sum(size_bytes), 0) into v_finalized_count, v_finalized_size
    from public.lesson_summary_files where summary_id = p_subject_id;
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
    (uploader_id, purpose, subject_id, task_word_id, file_name, mime_type, declared_size_bytes, storage_object_key, expires_at)
  values
    (v_caller, p_purpose, p_subject_id, p_task_word_id, p_file_name, p_mime_type, p_size_bytes, v_key, now() + interval '30 minutes')
  returning id into v_intent_id;

  return query select v_intent_id, v_key;
end;
$$;

create or replace function public.finalize_upload(p_intent_id uuid)
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
    else
      select id into v_file_id from public.lesson_summary_files where storage_object_key = v_intent.storage_object_key;
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

  else -- lesson_summary_file
    if not exists (select 1 from public.lesson_summaries s where s.id = v_intent.subject_id and s.archived_at is null) then
      raise exception 'lesson_summary % is archived or no longer exists', v_intent.subject_id using errcode = 'P0001';
    end if;

    insert into public.lesson_summary_files (summary_id, storage_object_key, file_name, mime_type, size_bytes)
    values (v_intent.subject_id, v_intent.storage_object_key, v_intent.file_name, v_intent.mime_type, v_intent.declared_size_bytes)
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
$$;

-- ============================================================================
-- RPCs -- all SECURITY DEFINER, set search_path = '', EXECUTE revoked from
-- PUBLIC and anon, granted only to authenticated. Every one starts with an
-- explicit private.is_ready_profile() check. Targeting RPCs take a
-- fully-resolved student id list -- they never expand a class themselves,
-- see migration header.
-- ============================================================================

-- An exam created with nobody targeted is rejected outright -- unlike
-- assignments/vocabulary_sets, there is no later "content added after an
-- empty publish" step distinct from targeting here.
create function public.create_exam_with_students(
  p_title text,
  p_description text,
  p_exam_date date,
  p_full_marks numeric,
  p_student_ids uuid[],
  p_source_class_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_exam_id uuid;
  v_student_id uuid;
  v_class_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'caller is not an active teacher' using errcode = '28000';
  end if;

  if p_student_ids is null or array_length(p_student_ids, 1) is null then
    raise exception 'p_student_ids must be a non-empty array' using errcode = '22023';
  end if;

  insert into public.exams (teacher_id, title, description, exam_date, full_marks)
  values (v_teacher_id, p_title, nullif(p_description, ''), p_exam_date, p_full_marks)
  returning id into v_exam_id;

  foreach v_student_id in array p_student_ids
  loop
    if not private.teacher_owns_student(v_student_id) then
      raise exception 'student % not found or not owned by caller', v_student_id using errcode = '42501';
    end if;

    insert into public.exam_scores (exam_id, student_id)
    values (v_exam_id, v_student_id);
  end loop;

  if p_source_class_ids is not null then
    foreach v_class_id in array p_source_class_ids
    loop
      if not private.teacher_owns_class(v_class_id) then
        raise exception 'class % not found or not owned by caller', v_class_id using errcode = '42501';
      end if;

      insert into public.exam_source_classes (exam_id, class_id)
      values (v_exam_id, v_class_id);
    end loop;
  end if;

  return v_exam_id;
end;
$$;

-- For adding more students after creation. Locks the exams row before
-- checking archived_at, closing the archive/add race -- see migration
-- header's concurrency note. A student added twice is a no-op (ON CONFLICT
-- DO NOTHING), never resets an in-progress score.
create function public.add_students_to_exam(
  p_exam_id uuid,
  p_student_ids uuid[],
  p_source_class_ids uuid[] default array[]::uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exams;
  v_student_id uuid;
  v_class_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if not private.teacher_owns_exam(p_exam_id) then
    raise exception 'exam % not found or not owned by caller', p_exam_id using errcode = '42501';
  end if;

  select * into v_exam from public.exams where id = p_exam_id for update;

  if v_exam.archived_at is not null then
    raise exception 'cannot add students to an archived exam' using errcode = 'P0001';
  end if;

  if p_student_ids is null or array_length(p_student_ids, 1) is null then
    raise exception 'p_student_ids must be a non-empty array' using errcode = '22023';
  end if;

  foreach v_student_id in array p_student_ids
  loop
    if not private.teacher_owns_student(v_student_id) then
      raise exception 'student % not found or not owned by caller', v_student_id using errcode = '42501';
    end if;

    insert into public.exam_scores (exam_id, student_id)
    values (p_exam_id, v_student_id)
    on conflict (exam_id, student_id) do nothing;
  end loop;

  if p_source_class_ids is not null then
    foreach v_class_id in array p_source_class_ids
    loop
      if not private.teacher_owns_class(v_class_id) then
        raise exception 'class % not found or not owned by caller', v_class_id using errcode = '42501';
      end if;

      insert into public.exam_source_classes (exam_id, class_id)
      values (p_exam_id, v_class_id)
      on conflict (exam_id, class_id) do nothing;
    end loop;
  end if;
end;
$$;

create function public.create_lesson_summary_with_students(
  p_title text,
  p_content text,
  p_session_date date,
  p_student_ids uuid[],
  p_source_class_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_summary_id uuid;
  v_student_id uuid;
  v_class_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'caller is not an active teacher' using errcode = '28000';
  end if;

  if p_student_ids is null or array_length(p_student_ids, 1) is null then
    raise exception 'p_student_ids must be a non-empty array' using errcode = '22023';
  end if;

  insert into public.lesson_summaries (teacher_id, title, content, session_date)
  values (v_teacher_id, nullif(p_title, ''), p_content, p_session_date)
  returning id into v_summary_id;

  foreach v_student_id in array p_student_ids
  loop
    if not private.teacher_owns_student(v_student_id) then
      raise exception 'student % not found or not owned by caller', v_student_id using errcode = '42501';
    end if;

    insert into public.lesson_summary_targets (summary_id, student_id)
    values (v_summary_id, v_student_id);
  end loop;

  if p_source_class_ids is not null then
    foreach v_class_id in array p_source_class_ids
    loop
      if not private.teacher_owns_class(v_class_id) then
        raise exception 'class % not found or not owned by caller', v_class_id using errcode = '42501';
      end if;

      insert into public.lesson_summary_source_classes (summary_id, class_id)
      values (v_summary_id, v_class_id);
    end loop;
  end if;

  return v_summary_id;
end;
$$;

create function public.add_students_to_lesson_summary(
  p_summary_id uuid,
  p_student_ids uuid[],
  p_source_class_ids uuid[] default array[]::uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary public.lesson_summaries;
  v_student_id uuid;
  v_class_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if not private.teacher_owns_lesson_summary(p_summary_id) then
    raise exception 'lesson_summary % not found or not owned by caller', p_summary_id using errcode = '42501';
  end if;

  select * into v_summary from public.lesson_summaries where id = p_summary_id for update;

  if v_summary.archived_at is not null then
    raise exception 'cannot add students to an archived lesson_summary' using errcode = 'P0001';
  end if;

  if p_student_ids is null or array_length(p_student_ids, 1) is null then
    raise exception 'p_student_ids must be a non-empty array' using errcode = '22023';
  end if;

  foreach v_student_id in array p_student_ids
  loop
    if not private.teacher_owns_student(v_student_id) then
      raise exception 'student % not found or not owned by caller', v_student_id using errcode = '42501';
    end if;

    insert into public.lesson_summary_targets (summary_id, student_id)
    values (p_summary_id, v_student_id)
    on conflict (summary_id, student_id) do nothing;
  end loop;

  if p_source_class_ids is not null then
    foreach v_class_id in array p_source_class_ids
    loop
      if not private.teacher_owns_class(v_class_id) then
        raise exception 'class % not found or not owned by caller', v_class_id using errcode = '42501';
      end if;

      insert into public.lesson_summary_source_classes (summary_id, class_id)
      values (p_summary_id, v_class_id)
      on conflict (summary_id, class_id) do nothing;
    end loop;
  end if;
end;
$$;

-- This is a revoke-access-now, reclaim-bytes-later operation, not an instant
-- physical delete: deleting upload_intents makes the Storage object
-- eligible for private.list_expired_upload_cleanup_candidates()'s orphan
-- scan (which excludes any object still matched by *any* upload_intents
-- row, regardless of status), but actual byte deletion only happens through
-- the cleanup Edge Function on its normal schedule. Say so plainly in the UI
-- copy -- "删除该学生照片会立即无法访问该照片，文件本身会在后台清理任务中被移除",
-- not "删除照片" implying instant physical removal.
create function public.delete_exam_score_file(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_storage_object_key text;
  v_exam_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  select f.storage_object_key, es.exam_id
  into v_storage_object_key, v_exam_id
  from public.exam_score_files f
  join public.exam_scores es on es.id = f.exam_score_id
  where f.id = p_file_id;

  if v_exam_id is null then
    raise exception 'exam_score_file % not found', p_file_id using errcode = '42501';
  end if;

  if not private.teacher_owns_exam(v_exam_id) then
    raise exception 'exam_score_file % not owned by caller', p_file_id using errcode = '42501';
  end if;

  delete from public.exam_score_files where id = p_file_id;
  delete from public.upload_intents where storage_object_key = v_storage_object_key;
end;
$$;

create function public.delete_lesson_summary_file(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_storage_object_key text;
  v_summary_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  select storage_object_key, summary_id
  into v_storage_object_key, v_summary_id
  from public.lesson_summary_files
  where id = p_file_id;

  if v_summary_id is null then
    raise exception 'lesson_summary_file % not found', p_file_id using errcode = '42501';
  end if;

  if not private.teacher_owns_lesson_summary(v_summary_id) then
    raise exception 'lesson_summary_file % not owned by caller', p_file_id using errcode = '42501';
  end if;

  delete from public.lesson_summary_files where id = p_file_id;
  delete from public.upload_intents where storage_object_key = v_storage_object_key;
end;
$$;

revoke execute on function public.create_exam_with_students(text, text, date, numeric, uuid[], uuid[]) from public, anon;
revoke execute on function public.add_students_to_exam(uuid, uuid[], uuid[]) from public, anon;
revoke execute on function public.create_lesson_summary_with_students(text, text, date, uuid[], uuid[]) from public, anon;
revoke execute on function public.add_students_to_lesson_summary(uuid, uuid[], uuid[]) from public, anon;
revoke execute on function public.delete_exam_score_file(uuid) from public, anon;
revoke execute on function public.delete_lesson_summary_file(uuid) from public, anon;

grant execute on function public.create_exam_with_students(text, text, date, numeric, uuid[], uuid[]) to authenticated;
grant execute on function public.add_students_to_exam(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.create_lesson_summary_with_students(text, text, date, uuid[], uuid[]) to authenticated;
grant execute on function public.add_students_to_lesson_summary(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.delete_exam_score_file(uuid) to authenticated;
grant execute on function public.delete_lesson_summary_file(uuid) to authenticated;
;
