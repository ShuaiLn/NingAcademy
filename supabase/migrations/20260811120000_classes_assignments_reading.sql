-- Phase 3: classes/enrollments, assignments (create/publish/submit/grade),
-- pronunciation reading tasks (create/publish/record/grade), and the
-- two-phase direct-to-Storage upload pipeline shared by all three subject
-- kinds (assignment_file / submission_file / audio_submission_file).
--
-- Upload pipeline: begin_upload() validates ownership/MIME/quota and mints a
-- storage_object_key + upload_intents row entirely in Postgres; the browser
-- then calls Supabase Storage's createSignedUploadUrl()/uploadToSignedUrl()
-- directly (see app/actions/uploads.ts -- no File ever touches a Server
-- Action, since Next.js Server Actions cap request bodies at 1MB by
-- default). finalize_upload() re-validates current state (never trusts the
-- 30-minute-old begin_upload() snapshot) and is the only path that ever
-- writes an assignment_files/submission_files/audio_submission_files row.
-- Known, accepted limitation: a signed upload URL stays valid for ~2h on
-- Supabase's side regardless of what happens to its upload_intent
-- afterwards, so an abandoned intent can still land an orphaned object in
-- Storage. finalize_upload()'s state re-validation guarantees an orphan can
-- never become a queryable *_files row; the periodic cleanup Edge Function
-- (see the next migration) is what actually removes the orphaned object.
--
-- Targeting: assignment_targets/pronunciation_targets carry EITHER a
-- class_id OR a student_id (never both), resolved for a student caller by
-- private.can_view_assignment()/can_view_pronunciation_task(), which call
-- private.student_enrolled_in_class() internally. Both helpers are
-- SECURITY DEFINER, so a student's own RLS reach never needs (and never
-- gets) a SELECT policy on classes/enrollments themselves -- Phase 3's UI
-- has no student-facing "my classes" page, only "my assignments"/"my
-- reading tasks", which are what assignment_targets/pronunciation_targets
-- exist to answer directly.
--
-- Visibility SELECT policies below are written as one combined
-- teacher-or-student policy from the start (never split-then-merged), per
-- the Postgres/Supabase performance advisor: multiple permissive policies
-- for the same role+action are evaluated and OR'd on every query. Every
-- cross-table EXISTS subquery qualifies the outer table explicitly
-- (`assignments.id`, never a bare `id`) to avoid the exact column-shadowing
-- bug Phase 2 hit and fixed in 20260811000400_vocabulary_fix_student_set_
-- visibility (an inner alias's own `id` silently wins over an unqualified
-- outer reference).
--
-- pronunciation_task_words diverges from vocabulary_words on purpose:
-- vocabulary_words.term is the hidden spelling answer, so Phase 2 gives
-- students no RLS-reachable SELECT at all. pronunciation_task_words.
-- text_prompt is the opposite -- it is exactly what the student must read
-- aloud -- so it gets a normal student-reachable SELECT policy scoped
-- through private.can_view_pronunciation_task().

-- ============================================================================
-- Tables
-- ============================================================================

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete restrict,
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classes_name_format check (btrim(name) <> '' and char_length(name) <= 200)
);

comment on table public.classes is
  'Teacher-defined student group ("班级"), used only to bulk-target assignments/pronunciation_tasks via assignment_targets.class_id / pronunciation_targets.class_id. Deliberately has no student-reachable RLS policy in this phase -- no Phase 3 UI needs a student "my classes" view, only "my assignments"/"my reading tasks" via *_targets.';

create index classes_teacher_id_idx on public.classes (teacher_id);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  enrolled_at timestamptz not null default now(),
  unenrolled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (class_id, student_id)
);

comment on table public.enrollments is
  'Teacher-managed class roster. INSERT only ever happens inside enroll_students_in_class() (no INSERT grant to authenticated); unenrolling is a plain UPDATE (column-scoped to unenrolled_at), re-enrolling goes back through the same RPC -- same convention as vocabulary_targets. No student-reachable RLS policy at all; see classes comment.';

create index enrollments_student_id_idx on public.enrollments (student_id);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete restrict,
  title text not null,
  description text,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignments_title_format check (btrim(title) <> '' and char_length(title) <= 200),
  constraint assignments_description_length check (description is null or char_length(description) <= 2000)
);

comment on table public.assignments is
  'Teacher-authored assignment ("作业"). description carries teacher instructions -- there is no separate "assignment brief" file kind. published_at is null while draft and can only be set by publish_assignment() -- authenticated has no UPDATE grant on this column. Never hard-deleted; archived_at marks retirement. No atomic-creation RPC exists (unlike vocabulary_sets): creation is a plain INSERT since there is no nested child-row to create alongside it.';

create index assignments_teacher_id_idx on public.assignments (teacher_id);

create table public.pronunciation_tasks (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete restrict,
  title text not null,
  description text,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pronunciation_tasks_title_format check (btrim(title) <> '' and char_length(title) <= 200),
  constraint pronunciation_tasks_description_length check (description is null or char_length(description) <= 2000)
);

comment on table public.pronunciation_tasks is
  'Teacher-authored pronunciation reading task ("跟读任务"). description carries teacher instructions. published_at/archived_at follow the same publish-gate convention as assignments/vocabulary_sets.';

create index pronunciation_tasks_teacher_id_idx on public.pronunciation_tasks (teacher_id);

create table public.pronunciation_task_words (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.pronunciation_tasks (id) on delete restrict,
  text_prompt text not null,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pronunciation_task_words_text_prompt_format check (btrim(text_prompt) <> '' and char_length(text_prompt) <= 500),
  constraint pronunciation_task_words_sort_order_range check (sort_order >= 0)
);

comment on table public.pronunciation_task_words is
  'One line/phrase a student must read aloud. Unlike vocabulary_words.term, text_prompt is not a hidden answer -- see migration header. audio_submission_files.task_word_id optionally ties a recording to one of these.';

create index pronunciation_task_words_task_id_idx on public.pronunciation_task_words (task_id);

create table public.upload_intents (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.profiles (id) on delete restrict,
  purpose text not null check (purpose in ('assignment_file', 'submission_file', 'audio_submission_file')),
  subject_id uuid not null,
  task_word_id uuid references public.pronunciation_task_words (id) on delete restrict,
  file_name text not null,
  mime_type text not null,
  declared_size_bytes bigint not null check (declared_size_bytes > 0),
  storage_object_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'finalized', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  constraint upload_intents_task_word_only_for_audio check (
    task_word_id is null or purpose = 'audio_submission_file'
  )
);

comment on table public.upload_intents is
  'Ephemeral record of a client-authorized direct-to-Storage upload, minted by begin_upload() and consumed by finalize_upload()/cancel_upload(). No GRANT to authenticated at all (RLS enabled, zero policies) -- every access goes through those SECURITY DEFINER RPCs, same "unreachable by any client query" shape as Phase 2''s practice_session_words. storage.objects RLS (below) reads this table via private.storage_object_authorized() to decide whether an INSERT into the attachments bucket is allowed.';

create index upload_intents_uploader_id_idx on public.upload_intents (uploader_id);
create index upload_intents_subject_id_idx on public.upload_intents (subject_id);
create index upload_intents_status_expires_at_idx on public.upload_intents (status, expires_at);

create table public.assignment_targets (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete restrict,
  class_id uuid references public.classes (id) on delete restrict,
  student_id uuid references public.students (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint assignment_targets_exactly_one_target check (
    (class_id is not null and student_id is null) or (class_id is null and student_id is not null)
  )
);

comment on table public.assignment_targets is
  'Teacher assignment of an assignment to either a whole class or an individual student (never both). INSERT only ever happens inside assign_assignment_to_targets() (no INSERT grant to authenticated), mirroring vocabulary_targets. A class-based row makes the assignment visible to every currently-enrolled member via private.student_enrolled_in_class(), not via any direct grant on classes/enrollments.';

create index assignment_targets_student_id_idx on public.assignment_targets (student_id);
create index assignment_targets_class_id_idx on public.assignment_targets (class_id);
create unique index assignment_targets_unique_class on public.assignment_targets (assignment_id, class_id) where class_id is not null;
create unique index assignment_targets_unique_student on public.assignment_targets (assignment_id, student_id) where student_id is not null;

create table public.assignment_files (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete restrict,
  storage_object_key text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

comment on table public.assignment_files is
  'Teacher-attached assignment material. INSERT only ever happens inside finalize_upload() -- no INSERT/UPDATE/DELETE grant to authenticated at all, select-only.';

create index assignment_files_assignment_id_idx on public.assignment_files (assignment_id);

create table public.pronunciation_targets (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.pronunciation_tasks (id) on delete restrict,
  class_id uuid references public.classes (id) on delete restrict,
  student_id uuid references public.students (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint pronunciation_targets_exactly_one_target check (
    (class_id is not null and student_id is null) or (class_id is null and student_id is not null)
  )
);

comment on table public.pronunciation_targets is
  'Same shape as assignment_targets, for pronunciation_tasks. INSERT only ever happens inside assign_pronunciation_task_to_targets().';

create index pronunciation_targets_student_id_idx on public.pronunciation_targets (student_id);
create index pronunciation_targets_class_id_idx on public.pronunciation_targets (class_id);
create unique index pronunciation_targets_unique_class on public.pronunciation_targets (task_id, class_id) where class_id is not null;
create unique index pronunciation_targets_unique_student on public.pronunciation_targets (task_id, student_id) where student_id is not null;

create table private.attempt_counters (
  subject_type text not null check (subject_type in ('assignment', 'pronunciation_task')),
  subject_id uuid not null,
  student_id uuid not null references public.students (id) on delete restrict,
  next_attempt_no integer not null default 1,
  primary key (subject_type, subject_id, student_id)
);

comment on table private.attempt_counters is
  'Backing store for private.next_attempt_no(). Lives in the private schema, never exposed via the API and never granted to authenticated/service_role -- only the SECURITY DEFINER next_attempt_no() function ever touches it.';

alter table private.attempt_counters enable row level security;

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  attempt_no integer not null,
  note text,
  submitted_at timestamptz,
  score numeric,
  feedback_text text,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint submissions_attempt_no_positive check (attempt_no > 0),
  constraint submissions_note_length check (note is null or char_length(note) <= 2000),
  constraint submissions_feedback_text_length check (feedback_text is null or char_length(feedback_text) <= 2000),
  constraint submissions_score_non_negative check (score is null or score >= 0)
);

comment on table public.submissions is
  'One attempt at an assignment. Row creation/completion only ever happen inside create_submission()/finish_submission() (resume-or-create draft pattern, see private.next_attempt_no()); authenticated additionally gets a narrow column UPDATE grant on (score, feedback_text) for grading, gated by submissions_teacher_update_graded_fields RLS (submitted_at is not null). graded_at is stamped by a trigger whenever score or feedback_text actually changes -- including back to NULL -- it means "last edited", not "currently graded".';

create index submissions_assignment_id_idx on public.submissions (assignment_id);
create index submissions_student_id_idx on public.submissions (student_id);

create unique index submissions_one_draft_per_student_assignment
  on public.submissions (assignment_id, student_id)
  where submitted_at is null;

create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete restrict,
  storage_object_key text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

comment on table public.submission_files is
  'Student-attached submission file. INSERT only ever happens inside finalize_upload(), and only while the parent submission is still a draft (finalize_upload() re-checks submitted_at is null).';

create index submission_files_submission_id_idx on public.submission_files (submission_id);

create table public.audio_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.pronunciation_tasks (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  attempt_no integer not null,
  note text,
  submitted_at timestamptz,
  score numeric,
  feedback_text text,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint audio_submissions_attempt_no_positive check (attempt_no > 0),
  constraint audio_submissions_note_length check (note is null or char_length(note) <= 2000),
  constraint audio_submissions_feedback_text_length check (feedback_text is null or char_length(feedback_text) <= 2000),
  constraint audio_submissions_score_non_negative check (score is null or score >= 0)
);

comment on table public.audio_submissions is
  'One attempt at a pronunciation_task, holding zero or more audio_submission_files (one per word attempted). Same resume-or-create/grading shape as submissions. finish_audio_submission() additionally requires at least one attached audio file -- see its comment.';

create index audio_submissions_task_id_idx on public.audio_submissions (task_id);
create index audio_submissions_student_id_idx on public.audio_submissions (student_id);

create unique index audio_submissions_one_draft_per_student_task
  on public.audio_submissions (task_id, student_id)
  where submitted_at is null;

create table public.audio_submission_files (
  id uuid primary key default gen_random_uuid(),
  audio_submission_id uuid not null references public.audio_submissions (id) on delete restrict,
  task_word_id uuid references public.pronunciation_task_words (id) on delete restrict,
  storage_object_key text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('audio/mpeg', 'audio/mp4', 'audio/webm')),
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

comment on table public.audio_submission_files is
  'Student-recorded audio, optionally tied to one pronunciation_task_words row. mime_type has its own audio-only CHECK, separate from assignment_files/submission_files'' shared whitelist -- see begin_upload().';

create index audio_submission_files_audio_submission_id_idx on public.audio_submission_files (audio_submission_id);
create index audio_submission_files_task_word_id_idx on public.audio_submission_files (task_word_id);

-- ============================================================================
-- Trigger functions
-- ============================================================================

create function public.protect_class_immutable_fields()
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

create trigger classes_set_updated_at
before update on public.classes
for each row
execute function public.set_updated_at();

create trigger classes_protect_immutable_fields
before update on public.classes
for each row
execute function public.protect_class_immutable_fields();

create function public.validate_enrollment_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class_teacher_id uuid;
  v_student_teacher_id uuid;
begin
  select teacher_id into v_class_teacher_id from public.classes where id = new.class_id;
  select teacher_id into v_student_teacher_id from public.students where id = new.student_id;

  if v_class_teacher_id is null then
    raise exception 'class % does not exist', new.class_id using errcode = 'P0001';
  end if;

  if v_student_teacher_id is null then
    raise exception 'student % does not exist', new.student_id using errcode = 'P0001';
  end if;

  if v_class_teacher_id <> v_student_teacher_id then
    raise exception 'class % and student % belong to different teachers', new.class_id, new.student_id using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger enrollments_validate_ownership
before insert on public.enrollments
for each row
execute function public.validate_enrollment_ownership();

create function public.protect_enrollment_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.class_id is distinct from old.class_id then
    raise exception 'class_id cannot be changed' using errcode = 'P0001';
  end if;
  if new.student_id is distinct from old.student_id then
    raise exception 'student_id cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger enrollments_protect_immutable_fields
before update on public.enrollments
for each row
execute function public.protect_enrollment_immutable_fields();

create function public.protect_assignment_immutable_fields()
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

create trigger assignments_set_updated_at
before update on public.assignments
for each row
execute function public.set_updated_at();

create trigger assignments_protect_immutable_fields
before update on public.assignments
for each row
execute function public.protect_assignment_immutable_fields();

create function public.protect_pronunciation_task_immutable_fields()
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

create trigger pronunciation_tasks_set_updated_at
before update on public.pronunciation_tasks
for each row
execute function public.set_updated_at();

create trigger pronunciation_tasks_protect_immutable_fields
before update on public.pronunciation_tasks
for each row
execute function public.protect_pronunciation_task_immutable_fields();

create function public.protect_pronunciation_task_word_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.task_id is distinct from old.task_id then
    raise exception 'task_id cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger pronunciation_task_words_set_updated_at
before update on public.pronunciation_task_words
for each row
execute function public.set_updated_at();

create trigger pronunciation_task_words_protect_immutable_fields
before update on public.pronunciation_task_words
for each row
execute function public.protect_pronunciation_task_word_immutable_fields();

create function public.validate_assignment_target_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_teacher_id uuid;
  v_target_teacher_id uuid;
begin
  select teacher_id into v_assignment_teacher_id from public.assignments where id = new.assignment_id;
  if v_assignment_teacher_id is null then
    raise exception 'assignment % does not exist', new.assignment_id using errcode = 'P0001';
  end if;

  if new.class_id is not null then
    select teacher_id into v_target_teacher_id from public.classes where id = new.class_id;
    if v_target_teacher_id is null then
      raise exception 'class % does not exist', new.class_id using errcode = 'P0001';
    end if;
  else
    select teacher_id into v_target_teacher_id from public.students where id = new.student_id;
    if v_target_teacher_id is null then
      raise exception 'student % does not exist', new.student_id using errcode = 'P0001';
    end if;
  end if;

  if v_assignment_teacher_id <> v_target_teacher_id then
    raise exception 'assignment_targets.assignment_id and its target must belong to the same teacher' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger assignment_targets_validate_ownership
before insert on public.assignment_targets
for each row
execute function public.validate_assignment_target_ownership();

create function public.protect_assignment_target_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignment_id is distinct from old.assignment_id then
    raise exception 'assignment_id cannot be changed' using errcode = 'P0001';
  end if;
  if new.class_id is distinct from old.class_id then
    raise exception 'class_id cannot be changed' using errcode = 'P0001';
  end if;
  if new.student_id is distinct from old.student_id then
    raise exception 'student_id cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger assignment_targets_protect_immutable_fields
before update on public.assignment_targets
for each row
execute function public.protect_assignment_target_immutable_fields();

create function public.validate_pronunciation_target_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_teacher_id uuid;
  v_target_teacher_id uuid;
begin
  select teacher_id into v_task_teacher_id from public.pronunciation_tasks where id = new.task_id;
  if v_task_teacher_id is null then
    raise exception 'pronunciation_task % does not exist', new.task_id using errcode = 'P0001';
  end if;

  if new.class_id is not null then
    select teacher_id into v_target_teacher_id from public.classes where id = new.class_id;
    if v_target_teacher_id is null then
      raise exception 'class % does not exist', new.class_id using errcode = 'P0001';
    end if;
  else
    select teacher_id into v_target_teacher_id from public.students where id = new.student_id;
    if v_target_teacher_id is null then
      raise exception 'student % does not exist', new.student_id using errcode = 'P0001';
    end if;
  end if;

  if v_task_teacher_id <> v_target_teacher_id then
    raise exception 'pronunciation_targets.task_id and its target must belong to the same teacher' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger pronunciation_targets_validate_ownership
before insert on public.pronunciation_targets
for each row
execute function public.validate_pronunciation_target_ownership();

create function public.protect_pronunciation_target_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.task_id is distinct from old.task_id then
    raise exception 'task_id cannot be changed' using errcode = 'P0001';
  end if;
  if new.class_id is distinct from old.class_id then
    raise exception 'class_id cannot be changed' using errcode = 'P0001';
  end if;
  if new.student_id is distinct from old.student_id then
    raise exception 'student_id cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger pronunciation_targets_protect_immutable_fields
before update on public.pronunciation_targets
for each row
execute function public.protect_pronunciation_target_immutable_fields();

create function public.validate_submission_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_teacher_id uuid;
  v_student_teacher_id uuid;
begin
  select teacher_id into v_assignment_teacher_id from public.assignments where id = new.assignment_id;
  select teacher_id into v_student_teacher_id from public.students where id = new.student_id;

  if v_assignment_teacher_id is null or v_student_teacher_id is null or v_assignment_teacher_id <> v_student_teacher_id then
    raise exception 'submissions.assignment_id and student_id must belong to the same teacher' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger submissions_validate_ownership
before insert on public.submissions
for each row
execute function public.validate_submission_ownership();

create function public.protect_submission_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignment_id is distinct from old.assignment_id then
    raise exception 'assignment_id cannot be changed' using errcode = 'P0001';
  end if;
  if new.student_id is distinct from old.student_id then
    raise exception 'student_id cannot be changed' using errcode = 'P0001';
  end if;
  if new.attempt_no is distinct from old.attempt_no then
    raise exception 'attempt_no cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger submissions_protect_immutable_fields
before update on public.submissions
for each row
execute function public.protect_submission_immutable_fields();

-- Shared by submissions and audio_submissions: stamps graded_at whenever
-- score or feedback_text actually changes, including a teacher clearing a
-- score/feedback back to NULL -- that is still a meaningful edit, not a
-- "reset to ungraded" state that needs to be excluded.
create function public.stamp_graded_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.score is distinct from old.score or new.feedback_text is distinct from old.feedback_text then
    new.graded_at = now();
  end if;
  return new;
end;
$$;

create trigger submissions_stamp_graded_at
before update on public.submissions
for each row
execute function public.stamp_graded_at();

create function public.validate_audio_submission_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_teacher_id uuid;
  v_student_teacher_id uuid;
begin
  select teacher_id into v_task_teacher_id from public.pronunciation_tasks where id = new.task_id;
  select teacher_id into v_student_teacher_id from public.students where id = new.student_id;

  if v_task_teacher_id is null or v_student_teacher_id is null or v_task_teacher_id <> v_student_teacher_id then
    raise exception 'audio_submissions.task_id and student_id must belong to the same teacher' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger audio_submissions_validate_ownership
before insert on public.audio_submissions
for each row
execute function public.validate_audio_submission_ownership();

create function public.protect_audio_submission_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.task_id is distinct from old.task_id then
    raise exception 'task_id cannot be changed' using errcode = 'P0001';
  end if;
  if new.student_id is distinct from old.student_id then
    raise exception 'student_id cannot be changed' using errcode = 'P0001';
  end if;
  if new.attempt_no is distinct from old.attempt_no then
    raise exception 'attempt_no cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger audio_submissions_protect_immutable_fields
before update on public.audio_submissions
for each row
execute function public.protect_audio_submission_immutable_fields();

create trigger audio_submissions_stamp_graded_at
before update on public.audio_submissions
for each row
execute function public.stamp_graded_at();

revoke execute on function public.protect_class_immutable_fields() from public;
revoke execute on function public.validate_enrollment_ownership() from public;
revoke execute on function public.protect_enrollment_immutable_fields() from public;
revoke execute on function public.protect_assignment_immutable_fields() from public;
revoke execute on function public.protect_pronunciation_task_immutable_fields() from public;
revoke execute on function public.protect_pronunciation_task_word_immutable_fields() from public;
revoke execute on function public.validate_assignment_target_ownership() from public;
revoke execute on function public.protect_assignment_target_immutable_fields() from public;
revoke execute on function public.validate_pronunciation_target_ownership() from public;
revoke execute on function public.protect_pronunciation_target_immutable_fields() from public;
revoke execute on function public.validate_submission_ownership() from public;
revoke execute on function public.protect_submission_immutable_fields() from public;
revoke execute on function public.stamp_graded_at() from public;
revoke execute on function public.validate_audio_submission_ownership() from public;
revoke execute on function public.protect_audio_submission_immutable_fields() from public;

-- ============================================================================
-- private schema helpers (SECURITY DEFINER, used inside RLS policies and RPCs)
-- ============================================================================

create function private.teacher_owns_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.classes c
    where c.id = p_class_id and c.teacher_id = private.current_teacher_id()
  )
$$;

create function private.student_enrolled_in_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.enrollments e
    where e.class_id = p_class_id
      and e.student_id = private.current_student_id()
      and e.unenrolled_at is null
  )
$$;

create function private.teacher_owns_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a
    where a.id = p_assignment_id and a.teacher_id = private.current_teacher_id()
  )
$$;

create function private.teacher_owns_pronunciation_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pronunciation_tasks t
    where t.id = p_task_id and t.teacher_id = private.current_teacher_id()
  )
$$;

-- True for the owning teacher always; true for a student only once the
-- assignment is published, not archived, and reachable via a non-revoked
-- assignment_targets row (direct student_id match, or class_id match with
-- the student currently enrolled in that class).
create function private.can_view_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a
    where a.id = p_assignment_id
      and (
        a.teacher_id = private.current_teacher_id()
        or (
          a.published_at is not null
          and a.archived_at is null
          and exists (
            select 1 from public.assignment_targets t
            where t.assignment_id = a.id
              and t.revoked_at is null
              and (
                t.student_id = private.current_student_id()
                or (t.class_id is not null and private.student_enrolled_in_class(t.class_id))
              )
          )
        )
      )
  )
$$;

create function private.can_view_pronunciation_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pronunciation_tasks pt
    where pt.id = p_task_id
      and (
        pt.teacher_id = private.current_teacher_id()
        or (
          pt.published_at is not null
          and pt.archived_at is null
          and exists (
            select 1 from public.pronunciation_targets t
            where t.task_id = pt.id
              and t.revoked_at is null
              and (
                t.student_id = private.current_student_id()
                or (t.class_id is not null and private.student_enrolled_in_class(t.class_id))
              )
          )
        )
      )
  )
$$;

-- Returns the next attempt_no for (subject_type, subject_id, student_id),
-- atomically. Called exactly once per create_submission()/
-- create_audio_submission() invocation, as part of a single INSERT ...
-- VALUES (..., private.next_attempt_no(...)) ON CONFLICT DO UPDATE
-- statement -- PostgreSQL evaluates a VALUES expression once per statement
-- regardless of which branch (insert vs. conflict) it ends up taking, so a
-- resumed (already-existing) draft never gets a second attempt_no computed
-- for it, and the draft row it returns keeps whatever attempt_no its
-- original INSERT assigned (the DO UPDATE clause never touches attempt_no).
create function private.next_attempt_no(p_subject_type text, p_subject_id uuid, p_student_id uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into private.attempt_counters as ac (subject_type, subject_id, student_id, next_attempt_no)
  values (p_subject_type, p_subject_id, p_student_id, 1)
  on conflict (subject_type, subject_id, student_id)
  do update set next_attempt_no = ac.next_attempt_no + 1
  returning next_attempt_no
$$;

revoke execute on function private.teacher_owns_class(uuid) from public;
revoke execute on function private.student_enrolled_in_class(uuid) from public;
revoke execute on function private.teacher_owns_assignment(uuid) from public;
revoke execute on function private.teacher_owns_pronunciation_task(uuid) from public;
revoke execute on function private.can_view_assignment(uuid) from public;
revoke execute on function private.can_view_pronunciation_task(uuid) from public;
revoke execute on function private.next_attempt_no(text, uuid, uuid) from public;

grant execute on function private.teacher_owns_class(uuid) to authenticated;
grant execute on function private.student_enrolled_in_class(uuid) to authenticated;
grant execute on function private.teacher_owns_assignment(uuid) to authenticated;
grant execute on function private.teacher_owns_pronunciation_task(uuid) to authenticated;
grant execute on function private.can_view_assignment(uuid) to authenticated;
grant execute on function private.can_view_pronunciation_task(uuid) to authenticated;
grant execute on function private.next_attempt_no(text, uuid, uuid) to authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.classes enable row level security;
alter table public.enrollments enable row level security;
alter table public.assignments enable row level security;
alter table public.pronunciation_tasks enable row level security;
alter table public.pronunciation_task_words enable row level security;
alter table public.upload_intents enable row level security;
alter table public.assignment_targets enable row level security;
alter table public.assignment_files enable row level security;
alter table public.pronunciation_targets enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_files enable row level security;
alter table public.audio_submissions enable row level security;
alter table public.audio_submission_files enable row level security;

-- classes / enrollments: teacher-only, no student-reachable policy at all.
create policy "classes_teacher_select"
on public.classes
for select
to authenticated
using (private.is_ready_profile() and teacher_id = private.current_teacher_id());

create policy "classes_teacher_insert"
on public.classes
for insert
to authenticated
with check (private.is_ready_profile() and teacher_id = private.current_teacher_id());

create policy "classes_teacher_update"
on public.classes
for update
to authenticated
using (private.is_ready_profile() and teacher_id = private.current_teacher_id())
with check (private.is_ready_profile() and teacher_id = private.current_teacher_id());

create policy "enrollments_teacher_select"
on public.enrollments
for select
to authenticated
using (private.is_ready_profile() and private.teacher_owns_class(class_id));

create policy "enrollments_teacher_update"
on public.enrollments
for update
to authenticated
using (private.is_ready_profile() and private.teacher_owns_class(class_id))
with check (private.is_ready_profile() and private.teacher_owns_class(class_id));

-- assignments: creation is a plain INSERT (no atomic-creation RPC needed,
-- see table comment); published_at stays RPC-only via publish_assignment().
create policy "assignments_select_own_or_targeted"
on public.assignments
for select
to authenticated
using (private.is_ready_profile() and private.can_view_assignment(id));

create policy "assignments_teacher_insert"
on public.assignments
for insert
to authenticated
with check (private.is_ready_profile() and teacher_id = private.current_teacher_id());

create policy "assignments_teacher_update"
on public.assignments
for update
to authenticated
using (private.is_ready_profile() and teacher_id = private.current_teacher_id())
with check (private.is_ready_profile() and teacher_id = private.current_teacher_id());

create policy "assignment_targets_select_own_or_reachable"
on public.assignment_targets
for select
to authenticated
using (
  private.is_ready_profile()
  and (
    private.teacher_owns_assignment(assignment_id)
    or student_id = private.current_student_id()
    or (class_id is not null and private.student_enrolled_in_class(class_id))
  )
);

create policy "assignment_targets_teacher_update"
on public.assignment_targets
for update
to authenticated
using (private.is_ready_profile() and private.teacher_owns_assignment(assignment_id))
with check (private.is_ready_profile() and private.teacher_owns_assignment(assignment_id));

create policy "assignment_files_select_via_assignment"
on public.assignment_files
for select
to authenticated
using (private.is_ready_profile() and private.can_view_assignment(assignment_id));

-- pronunciation_tasks: same shape as assignments.
create policy "pronunciation_tasks_select_own_or_targeted"
on public.pronunciation_tasks
for select
to authenticated
using (private.is_ready_profile() and private.can_view_pronunciation_task(id));

create policy "pronunciation_tasks_teacher_insert"
on public.pronunciation_tasks
for insert
to authenticated
with check (private.is_ready_profile() and teacher_id = private.current_teacher_id());

create policy "pronunciation_tasks_teacher_update"
on public.pronunciation_tasks
for update
to authenticated
using (private.is_ready_profile() and teacher_id = private.current_teacher_id())
with check (private.is_ready_profile() and teacher_id = private.current_teacher_id());

-- pronunciation_task_words: student-reachable SELECT -- see migration header.
create policy "pronunciation_task_words_select_via_task"
on public.pronunciation_task_words
for select
to authenticated
using (private.is_ready_profile() and private.can_view_pronunciation_task(task_id));

create policy "pronunciation_task_words_teacher_insert"
on public.pronunciation_task_words
for insert
to authenticated
with check (private.is_ready_profile() and private.teacher_owns_pronunciation_task(task_id));

create policy "pronunciation_task_words_teacher_update"
on public.pronunciation_task_words
for update
to authenticated
using (private.is_ready_profile() and private.teacher_owns_pronunciation_task(task_id))
with check (private.is_ready_profile() and private.teacher_owns_pronunciation_task(task_id));

create policy "pronunciation_targets_select_own_or_reachable"
on public.pronunciation_targets
for select
to authenticated
using (
  private.is_ready_profile()
  and (
    private.teacher_owns_pronunciation_task(task_id)
    or student_id = private.current_student_id()
    or (class_id is not null and private.student_enrolled_in_class(class_id))
  )
);

create policy "pronunciation_targets_teacher_update"
on public.pronunciation_targets
for update
to authenticated
using (private.is_ready_profile() and private.teacher_owns_pronunciation_task(task_id))
with check (private.is_ready_profile() and private.teacher_owns_pronunciation_task(task_id));

-- upload_intents: RLS enabled, deliberately zero policies -- see table comment.

create policy "submissions_select_own_or_own_students"
on public.submissions
for select
to authenticated
using (
  private.is_ready_profile()
  and (student_id = private.current_student_id() or private.teacher_owns_student(student_id))
);

-- Grading UPDATE: only the owning teacher, and only once submitted (a
-- teacher must not be able to edit a still-open draft's score/feedback).
create policy "submissions_teacher_update_graded_fields"
on public.submissions
for update
to authenticated
using (
  private.is_ready_profile()
  and private.teacher_owns_student(student_id)
  and submitted_at is not null
)
with check (
  private.is_ready_profile()
  and private.teacher_owns_student(student_id)
  and submitted_at is not null
);

create policy "submission_files_select_via_submission"
on public.submission_files
for select
to authenticated
using (
  private.is_ready_profile()
  and exists (
    select 1 from public.submissions s
    where s.id = submission_files.submission_id
      and (s.student_id = private.current_student_id() or private.teacher_owns_student(s.student_id))
  )
);

create policy "audio_submissions_select_own_or_own_students"
on public.audio_submissions
for select
to authenticated
using (
  private.is_ready_profile()
  and (student_id = private.current_student_id() or private.teacher_owns_student(student_id))
);

create policy "audio_submissions_teacher_update_graded_fields"
on public.audio_submissions
for update
to authenticated
using (
  private.is_ready_profile()
  and private.teacher_owns_student(student_id)
  and submitted_at is not null
)
with check (
  private.is_ready_profile()
  and private.teacher_owns_student(student_id)
  and submitted_at is not null
);

create policy "audio_submission_files_select_via_submission"
on public.audio_submission_files
for select
to authenticated
using (
  private.is_ready_profile()
  and exists (
    select 1 from public.audio_submissions a
    where a.id = audio_submission_files.audio_submission_id
      and (a.student_id = private.current_student_id() or private.teacher_owns_student(a.student_id))
  )
);

-- ============================================================================
-- Table-level grants (column-level where narrower access is required)
--
-- service_role gets full CRUD on every new public-schema table here for
-- consistency with Phase 1/2's convention (table privileges are not
-- automatic on this project). private.attempt_counters is deliberately
-- excluded: it lives in the private schema and only private.next_attempt_no()
-- ever touches it.
-- ============================================================================

grant usage on schema private to service_role;

grant select, insert on public.classes to authenticated;
grant update (name, archived_at) on public.classes to authenticated;
grant select, insert, update, delete on public.classes to service_role;

grant select on public.enrollments to authenticated;
grant update (unenrolled_at) on public.enrollments to authenticated;
grant select, insert, update, delete on public.enrollments to service_role;

grant select, insert on public.assignments to authenticated;
grant update (title, description, archived_at) on public.assignments to authenticated;
grant select, insert, update, delete on public.assignments to service_role;

grant select on public.assignment_targets to authenticated;
grant update (revoked_at) on public.assignment_targets to authenticated;
grant select, insert, update, delete on public.assignment_targets to service_role;

grant select on public.assignment_files to authenticated;
grant select, insert, update, delete on public.assignment_files to service_role;

grant select, insert on public.pronunciation_tasks to authenticated;
grant update (title, description, archived_at) on public.pronunciation_tasks to authenticated;
grant select, insert, update, delete on public.pronunciation_tasks to service_role;

grant select, insert on public.pronunciation_task_words to authenticated;
grant update (text_prompt, sort_order, archived_at) on public.pronunciation_task_words to authenticated;
grant select, insert, update, delete on public.pronunciation_task_words to service_role;

grant select on public.pronunciation_targets to authenticated;
grant update (revoked_at) on public.pronunciation_targets to authenticated;
grant select, insert, update, delete on public.pronunciation_targets to service_role;

grant select, insert, update, delete on public.upload_intents to service_role;

grant select on public.submissions to authenticated;
grant update (score, feedback_text) on public.submissions to authenticated;
grant select, insert, update, delete on public.submissions to service_role;

grant select on public.submission_files to authenticated;
grant select, insert, update, delete on public.submission_files to service_role;

grant select on public.audio_submissions to authenticated;
grant update (score, feedback_text) on public.audio_submissions to authenticated;
grant select, insert, update, delete on public.audio_submissions to service_role;

grant select on public.audio_submission_files to authenticated;
grant select, insert, update, delete on public.audio_submission_files to service_role;

-- ============================================================================
-- Storage: attachments bucket
--
-- private.storage_object_authorized() is what storage.objects' own INSERT
-- policy calls (it runs under the `authenticated` role, so it needs EXECUTE,
-- granted below) to decide whether a createSignedUploadUrl() call may
-- proceed: only when the object name exactly matches a still-pending,
-- unexpired upload_intent owned by the caller. Same SECURITY DEFINER /
-- search_path='' / narrow-grant discipline as every other private helper.
-- file_size_limit is a Storage-layer ceiling matching the 200MB per-subject
-- cumulative cap enforced in begin_upload() -- it must not be stricter than
-- what the app allows, or a legitimate large upload would fail at the
-- Storage layer with no relation to begin_upload()'s own bookkeeping.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 200 * 1024 * 1024)
on conflict (id) do nothing;

create function private.storage_object_authorized(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.upload_intents ui
    where ui.storage_object_key = p_object_name
      and ui.uploader_id = (select auth.uid())
      and ui.status = 'pending'
      and ui.expires_at > now()
  )
$$;

revoke execute on function private.storage_object_authorized(text) from public;
grant execute on function private.storage_object_authorized(text) to authenticated;

create policy "attachments_insert_authorized_pending_intent"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'attachments' and private.storage_object_authorized(name));

-- ============================================================================
-- RPCs
--
-- All twelve are SECURITY DEFINER, set search_path = '', EXECUTE revoked
-- from PUBLIC and anon, granted only to authenticated -- same shape as
-- Phase 2's seven RPCs. Every one starts with an explicit
-- private.is_ready_profile() check.
-- ============================================================================

-- 1. enrollments has no INSERT grant to authenticated at all; this is the
-- only path that can create one (a re-enroll after unenroll goes through
-- the same upsert, mirroring assign_vocabulary_set_to_students()).
create function public.enroll_students_in_class(p_class_id uuid, p_student_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.classes;
  v_student_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if not private.teacher_owns_class(p_class_id) then
    raise exception 'class % not found or not owned by caller', p_class_id using errcode = '42501';
  end if;

  select * into v_class from public.classes where id = p_class_id;

  if v_class.archived_at is not null then
    raise exception 'cannot enroll students into an archived class' using errcode = 'P0001';
  end if;

  if p_student_ids is null or array_length(p_student_ids, 1) is null then
    raise exception 'p_student_ids must be a non-empty array' using errcode = '22023';
  end if;

  foreach v_student_id in array p_student_ids
  loop
    if not private.teacher_owns_student(v_student_id) then
      raise exception 'student % not found or not owned by caller', v_student_id using errcode = '42501';
    end if;

    insert into public.enrollments (class_id, student_id)
    values (p_class_id, v_student_id)
    on conflict (class_id, student_id)
    do update set unenrolled_at = null, enrolled_at = now();
  end loop;
end;
$$;

-- 2. Mints a storage_object_key and upload_intents row; never touches
-- Storage or receives a File -- see migration header and app/actions/uploads.ts.
create function public.begin_upload(
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
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if p_purpose not in ('assignment_file', 'submission_file', 'audio_submission_file') then
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

  else -- audio_submission_file
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
  else
    select count(*), coalesce(sum(size_bytes), 0) into v_finalized_count, v_finalized_size
    from public.audio_submission_files where audio_submission_id = p_subject_id;
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

-- 3. Idempotent on an already-finalized intent (returns the same *_files row
-- id rather than erroring -- a client retry after a network timeout must be
-- able to get a definitive answer). Re-validates current state rather than
-- trusting begin_upload()'s snapshot -- see migration header.
create function public.finalize_upload(p_intent_id uuid)
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
    else
      select id into v_file_id from public.audio_submission_files where storage_object_key = v_intent.storage_object_key;
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

  else
    if not exists (select 1 from public.audio_submissions a where a.id = v_intent.subject_id and a.submitted_at is null) then
      raise exception 'audio_submission % is already submitted or no longer exists', v_intent.subject_id using errcode = 'P0001';
    end if;

    insert into public.audio_submission_files (audio_submission_id, task_word_id, storage_object_key, file_name, mime_type, size_bytes)
    values (v_intent.subject_id, v_intent.task_word_id, v_intent.storage_object_key, v_intent.file_name, v_intent.mime_type, v_intent.declared_size_bytes)
    returning id into v_file_id;
  end if;

  update public.upload_intents
  set status = 'finalized', finalized_at = now()
  where id = p_intent_id;

  return v_file_id;
end;
$$;

-- 4. Only flips status -- never attempts to delete the Storage object
-- itself (there is no "unsign a signed URL"; see migration header and the
-- cleanup Edge Function in the next migration).
create function public.cancel_upload(p_intent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  update public.upload_intents
  set status = 'cancelled'
  where id = p_intent_id and uploader_id = (select auth.uid()) and status = 'pending';

  if not found then
    raise exception 'upload_intent % not found, not owned by caller, or not pending', p_intent_id using errcode = '42501';
  end if;
end;
$$;

-- 5. published_at has no UPDATE grant to authenticated at all.
create function public.publish_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if not private.teacher_owns_assignment(p_assignment_id) then
    raise exception 'assignment % not found or not owned by caller', p_assignment_id using errcode = '42501';
  end if;

  select * into v_assignment from public.assignments where id = p_assignment_id for update;

  if v_assignment.archived_at is not null then
    raise exception 'cannot publish an archived assignment' using errcode = 'P0001';
  end if;

  if v_assignment.published_at is not null then
    return; -- idempotent no-op: already published
  end if;

  update public.assignments set published_at = now() where id = p_assignment_id;
end;
$$;

-- 6. assignment_targets has no INSERT grant to authenticated at all.
create function public.assign_assignment_to_targets(
  p_assignment_id uuid,
  p_class_ids uuid[],
  p_student_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.assignments;
  v_class_id uuid;
  v_student_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if not private.teacher_owns_assignment(p_assignment_id) then
    raise exception 'assignment % not found or not owned by caller', p_assignment_id using errcode = '42501';
  end if;

  select * into v_assignment from public.assignments where id = p_assignment_id;

  if v_assignment.published_at is null or v_assignment.archived_at is not null then
    raise exception 'assignment % must be published and not archived to be assigned', p_assignment_id using errcode = 'P0001';
  end if;

  if (p_class_ids is null or array_length(p_class_ids, 1) is null)
     and (p_student_ids is null or array_length(p_student_ids, 1) is null) then
    raise exception 'at least one of p_class_ids or p_student_ids must be non-empty' using errcode = '22023';
  end if;

  if p_class_ids is not null then
    foreach v_class_id in array p_class_ids
    loop
      if not private.teacher_owns_class(v_class_id) then
        raise exception 'class % not found or not owned by caller', v_class_id using errcode = '42501';
      end if;

      insert into public.assignment_targets (assignment_id, class_id)
      values (p_assignment_id, v_class_id)
      on conflict (assignment_id, class_id) where class_id is not null
      do update set revoked_at = null, assigned_at = now();
    end loop;
  end if;

  if p_student_ids is not null then
    foreach v_student_id in array p_student_ids
    loop
      if not private.teacher_owns_student(v_student_id) then
        raise exception 'student % not found or not owned by caller', v_student_id using errcode = '42501';
      end if;

      insert into public.assignment_targets (assignment_id, student_id)
      values (p_assignment_id, v_student_id)
      on conflict (assignment_id, student_id) where student_id is not null
      do update set revoked_at = null, assigned_at = now();
    end loop;
  end if;
end;
$$;

-- 7. Resume-or-create draft, same pattern as start_practice_session() --
-- see private.next_attempt_no() for why a double call never double-spends
-- an attempt number on the row it actually returns.
create function public.create_submission(p_assignment_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_submission_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_student_id := private.current_student_id();
  if v_student_id is null then
    raise exception 'caller is not an active student' using errcode = '28000';
  end if;

  if not private.can_view_assignment(p_assignment_id) then
    raise exception 'assignment % is not assigned to caller (or not published)', p_assignment_id using errcode = '42501';
  end if;

  insert into public.submissions (assignment_id, student_id, attempt_no, note)
  values (
    p_assignment_id,
    v_student_id,
    private.next_attempt_no('assignment', p_assignment_id, v_student_id),
    nullif(p_note, '')
  )
  on conflict (assignment_id, student_id) where submitted_at is null
  do update set assignment_id = excluded.assignment_id
  returning id into v_submission_id;

  return v_submission_id;
end;
$$;

-- 8.
create function public.finish_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_student_id := private.current_student_id();
  if v_student_id is null then
    raise exception 'caller is not an active student' using errcode = '28000';
  end if;

  perform 1
  from public.submissions
  where id = p_submission_id and student_id = v_student_id and submitted_at is null
  for update;

  if not found then
    raise exception 'submission % not found, not owned by caller, or already submitted', p_submission_id using errcode = '42501';
  end if;

  update public.submissions set submitted_at = now() where id = p_submission_id;
end;
$$;

-- 9. "At least one active word" mirrors publish_vocabulary_set()'s gate --
-- a published reading task with no words to read is not meaningfully usable.
create function public.publish_pronunciation_task(p_task_id uuid)
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

  if not exists (
    select 1 from public.pronunciation_task_words w
    where w.task_id = p_task_id and w.archived_at is null
  ) then
    raise exception 'pronunciation_task % has no active words to publish', p_task_id using errcode = 'P0001';
  end if;

  update public.pronunciation_tasks set published_at = now() where id = p_task_id;
end;
$$;

-- 10.
create function public.assign_pronunciation_task_to_targets(
  p_task_id uuid,
  p_class_ids uuid[],
  p_student_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.pronunciation_tasks;
  v_class_id uuid;
  v_student_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if not private.teacher_owns_pronunciation_task(p_task_id) then
    raise exception 'pronunciation_task % not found or not owned by caller', p_task_id using errcode = '42501';
  end if;

  select * into v_task from public.pronunciation_tasks where id = p_task_id;

  if v_task.published_at is null or v_task.archived_at is not null then
    raise exception 'pronunciation_task % must be published and not archived to be assigned', p_task_id using errcode = 'P0001';
  end if;

  if (p_class_ids is null or array_length(p_class_ids, 1) is null)
     and (p_student_ids is null or array_length(p_student_ids, 1) is null) then
    raise exception 'at least one of p_class_ids or p_student_ids must be non-empty' using errcode = '22023';
  end if;

  if p_class_ids is not null then
    foreach v_class_id in array p_class_ids
    loop
      if not private.teacher_owns_class(v_class_id) then
        raise exception 'class % not found or not owned by caller', v_class_id using errcode = '42501';
      end if;

      insert into public.pronunciation_targets (task_id, class_id)
      values (p_task_id, v_class_id)
      on conflict (task_id, class_id) where class_id is not null
      do update set revoked_at = null, assigned_at = now();
    end loop;
  end if;

  if p_student_ids is not null then
    foreach v_student_id in array p_student_ids
    loop
      if not private.teacher_owns_student(v_student_id) then
        raise exception 'student % not found or not owned by caller', v_student_id using errcode = '42501';
      end if;

      insert into public.pronunciation_targets (task_id, student_id)
      values (p_task_id, v_student_id)
      on conflict (task_id, student_id) where student_id is not null
      do update set revoked_at = null, assigned_at = now();
    end loop;
  end if;
end;
$$;

-- 11.
create function public.create_audio_submission(p_task_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_audio_submission_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_student_id := private.current_student_id();
  if v_student_id is null then
    raise exception 'caller is not an active student' using errcode = '28000';
  end if;

  if not private.can_view_pronunciation_task(p_task_id) then
    raise exception 'pronunciation_task % is not assigned to caller (or not published)', p_task_id using errcode = '42501';
  end if;

  insert into public.audio_submissions (task_id, student_id, attempt_no, note)
  values (
    p_task_id,
    v_student_id,
    private.next_attempt_no('pronunciation_task', p_task_id, v_student_id),
    nullif(p_note, '')
  )
  on conflict (task_id, student_id) where submitted_at is null
  do update set task_id = excluded.task_id
  returning id into v_audio_submission_id;

  return v_audio_submission_id;
end;
$$;

-- 12. Requires >=1 attached audio file (decided: any single audio file is
-- enough, no per-word completeness check at the database layer). The check
-- is placed after the ownership+submitted_at-is-null+for-update lock and
-- before the actual UPDATE, matching finalize_upload()'s MIME whitelist for
-- audio_submission_file (see begin_upload()) that already keeps non-audio
-- files out of this table entirely.
create function public.finish_audio_submission(p_audio_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_student_id := private.current_student_id();
  if v_student_id is null then
    raise exception 'caller is not an active student' using errcode = '28000';
  end if;

  perform 1
  from public.audio_submissions
  where id = p_audio_submission_id and student_id = v_student_id and submitted_at is null
  for update;

  if not found then
    raise exception 'audio_submission % not found, not owned by caller, or already submitted', p_audio_submission_id using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.audio_submission_files f
    where f.audio_submission_id = p_audio_submission_id
  ) then
    raise exception 'audio_submission % has no audio file attached', p_audio_submission_id using errcode = 'P0001';
  end if;

  update public.audio_submissions set submitted_at = now() where id = p_audio_submission_id;
end;
$$;

revoke execute on function public.enroll_students_in_class(uuid, uuid[]) from public, anon;
revoke execute on function public.begin_upload(text, uuid, text, text, bigint, uuid) from public, anon;
revoke execute on function public.finalize_upload(uuid) from public, anon;
revoke execute on function public.cancel_upload(uuid) from public, anon;
revoke execute on function public.publish_assignment(uuid) from public, anon;
revoke execute on function public.assign_assignment_to_targets(uuid, uuid[], uuid[]) from public, anon;
revoke execute on function public.create_submission(uuid, text) from public, anon;
revoke execute on function public.finish_submission(uuid) from public, anon;
revoke execute on function public.publish_pronunciation_task(uuid) from public, anon;
revoke execute on function public.assign_pronunciation_task_to_targets(uuid, uuid[], uuid[]) from public, anon;
revoke execute on function public.create_audio_submission(uuid, text) from public, anon;
revoke execute on function public.finish_audio_submission(uuid) from public, anon;

grant execute on function public.enroll_students_in_class(uuid, uuid[]) to authenticated;
grant execute on function public.begin_upload(text, uuid, text, text, bigint, uuid) to authenticated;
grant execute on function public.finalize_upload(uuid) to authenticated;
grant execute on function public.cancel_upload(uuid) to authenticated;
grant execute on function public.publish_assignment(uuid) to authenticated;
grant execute on function public.assign_assignment_to_targets(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.create_submission(uuid, text) to authenticated;
grant execute on function public.finish_submission(uuid) to authenticated;
grant execute on function public.publish_pronunciation_task(uuid) to authenticated;
grant execute on function public.assign_pronunciation_task_to_targets(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.create_audio_submission(uuid, text) to authenticated;
grant execute on function public.finish_audio_submission(uuid) to authenticated;
