-- Phase 2: vocabulary
-- Teacher-authored vocabulary sets, word-level spelling practice for
-- students, and the SECURITY DEFINER surface that lets students practice
-- without ever being able to SELECT the answer (vocabulary_words.term)
-- directly.
--
-- Grading direction: students are shown `meaning` (+ optional `image_url`)
-- and must spell `term`. `term` is therefore the sensitive column -- the
-- opposite of a naive "hide the definition" assumption. Because teachers
-- and students are the same Postgres role (`authenticated`), RLS (row-only)
-- and column GRANTs (role-only) cannot by themselves give teachers full
-- column access while denying students one column on the same table. The
-- fix used throughout this migration: vocabulary_words has no
-- student-reachable RLS policy at all, and every student-facing read/write
-- goes through a SECURITY DEFINER function that hand-picks safe columns.
--
-- Concurrency: this is the first phase with real double-submit/multi-tab
-- risk (a student starting a session twice, or answering the last word at
-- the same time as clicking "finish"). Those are handled with a partial
-- unique index (one open session per student+set) and `for update` row
-- locks inside the RPCs below, not application-level check-then-act.
--
-- Snapshot integrity: "发布后仍可自由编辑" (sets stay editable after
-- publish) must not mean a teacher's mid-session edit can change what an
-- already-open session shows or how it grades. practice_session_words
-- freezes meaning/image_url/term for a session at start_practice_session()
-- time; get_practice_words() and record_vocabulary_attempt() only ever read
-- that frozen snapshot, never live vocabulary_words.
--
-- Account-state gate: private.current_teacher_id()/current_student_id()
-- (Phase 1) already require is_active=true, but not must_change_password=
-- false. private.is_ready_profile() (below) adds that missing check and is
-- required by every RLS policy and RPC in this migration.
--
-- audit_log is intentionally untouched here: per its own table comment it
-- is scoped to identity/credential events, and every table below already
-- carries its own created_at/archived_at/revoked_at/completed_at trail.

-- ============================================================================
-- Tables
-- ============================================================================

create table public.vocabulary_sets (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete restrict,
  title text not null,
  description text,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vocabulary_sets_title_format check (btrim(title) <> '' and char_length(title) <= 200),
  constraint vocabulary_sets_description_length check (description is null or char_length(description) <= 2000)
);

comment on table public.vocabulary_sets is
  'A teacher-authored word list ("词库"). published_at is null while draft and can only be set by publish_vocabulary_set() -- authenticated has no UPDATE grant on this column. Never hard-deleted; archived_at marks retirement.';

create index vocabulary_sets_teacher_id_idx on public.vocabulary_sets (teacher_id);

create table public.vocabulary_words (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.vocabulary_sets (id) on delete restrict,
  term text not null,
  meaning text not null,
  image_url text,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vocabulary_words_term_format check (btrim(term) <> '' and char_length(term) <= 100),
  constraint vocabulary_words_meaning_format check (btrim(meaning) <> '' and char_length(meaning) <= 500),
  constraint vocabulary_words_image_url_format check (
    image_url is null or (char_length(image_url) <= 2048 and image_url ~ '^https://')
  ),
  constraint vocabulary_words_sort_order_range check (sort_order >= 0)
);

comment on table public.vocabulary_words is
  'term is the sensitive spelling answer the student must produce -- students never get an RLS-reachable SELECT on this table (see RLS below); meaning/image_url are the safe practice prompt.';

create index vocabulary_words_set_id_idx on public.vocabulary_words (set_id);

create table public.vocabulary_targets (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.vocabulary_sets (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (set_id, student_id)
);

comment on table public.vocabulary_targets is
  'Teacher assignment of a vocabulary_set to a student. INSERT only ever happens inside assign_vocabulary_set_to_students() (no INSERT grant to authenticated) so "must be published and not archived to be assigned" is enforced in the database, not just the Server Action. Ordinary clients may only flip revoked_at (unassign); re-assigning after a revoke goes back through the same RPC.';

create index vocabulary_targets_student_id_idx on public.vocabulary_targets (student_id);

create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  set_id uuid not null references public.vocabulary_sets (id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_words integer not null,
  created_at timestamptz not null default now(),
  constraint practice_sessions_total_words_positive check (total_words > 0),
  constraint practice_sessions_completed_after_started check (completed_at is null or completed_at >= started_at)
);

comment on table public.practice_sessions is
  'One practice round. Row creation and every mutation only ever happen inside the RPCs below -- authenticated has select-only access. Reporting contract: "开始次数" = sessions with >=1 row in vocabulary_attempts (a session with zero attempts was opened but never engaged); "完整完成次数" = completed_at is not null and attempts count = total_words; completed_at is not null with attempts count < total_words is an early finish ("提前放弃/部分完成"), not a failure state.';

create index practice_sessions_student_id_idx on public.practice_sessions (student_id);
create index practice_sessions_set_id_idx on public.practice_sessions (set_id);

-- One open (not yet completed) session per (student, set). This is what
-- makes start_practice_session()'s "reuse-or-create" logic safe under real
-- concurrency (two tabs, a double click) -- see the function body below.
create unique index practice_sessions_one_open_per_student_set
  on public.practice_sessions (student_id, set_id)
  where completed_at is null;

create table public.vocabulary_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_sessions (id) on delete restrict,
  word_id uuid not null references public.vocabulary_words (id) on delete restrict,
  prompt_meaning text not null,
  correct_term text not null,
  submitted_spelling text not null,
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (session_id, word_id),
  constraint vocabulary_attempts_submitted_spelling_length check (char_length(submitted_spelling) <= 100)
);

comment on table public.vocabulary_attempts is
  'One row per word answered in a session (linear one-pass model: unique(session_id, word_id)). prompt_meaning/correct_term are copied from practice_session_words at grading time, not read live from vocabulary_words, so a later edit never rewrites history. INSERT only ever happens inside record_vocabulary_attempt().';

create index vocabulary_attempts_session_id_idx on public.vocabulary_attempts (session_id);
create index vocabulary_attempts_word_id_idx on public.vocabulary_attempts (word_id);

create table public.practice_session_words (
  session_id uuid not null references public.practice_sessions (id) on delete cascade,
  word_id uuid not null references public.vocabulary_words (id) on delete restrict,
  sort_order integer not null,
  prompt_meaning text not null,
  prompt_image_url text,
  correct_term text not null,
  created_at timestamptz not null default now(),
  primary key (session_id, word_id)
);

comment on table public.practice_session_words is
  'Full freeze of a session''s word list, taken once by start_practice_session(). get_practice_words() and record_vocabulary_attempt() only ever read this table, never live vocabulary_words -- a teacher editing or archiving a word mid-session cannot change what an open session shows or how it grades. No GRANT to authenticated at all (not even select): this is the one place correct_term persists outside vocabulary_words itself, and only SECURITY DEFINER function bodies ever touch it. vocabulary_attempts keeps its own copy of prompt_meaning/correct_term so review UIs never need to query this table.';

-- ============================================================================
-- Trigger functions
-- ============================================================================

create function public.protect_vocabulary_set_immutable_fields()
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

create trigger vocabulary_sets_protect_immutable_fields
before update on public.vocabulary_sets
for each row
execute function public.protect_vocabulary_set_immutable_fields();

create trigger vocabulary_sets_set_updated_at
before update on public.vocabulary_sets
for each row
execute function public.set_updated_at();

create function public.protect_vocabulary_word_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.set_id is distinct from old.set_id then
    raise exception 'set_id cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger vocabulary_words_protect_immutable_fields
before update on public.vocabulary_words
for each row
execute function public.protect_vocabulary_word_immutable_fields();

create trigger vocabulary_words_set_updated_at
before update on public.vocabulary_words
for each row
execute function public.set_updated_at();

create function public.validate_vocabulary_target_ownership()
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

  if v_set_teacher_id is null then
    raise exception 'vocabulary_set % does not exist', new.set_id using errcode = 'P0001';
  end if;

  if v_student_teacher_id is null then
    raise exception 'student % does not exist', new.student_id using errcode = 'P0001';
  end if;

  if v_set_teacher_id <> v_student_teacher_id then
    raise exception 'vocabulary_set % and student % belong to different teachers', new.set_id, new.student_id using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger vocabulary_targets_validate_ownership
before insert on public.vocabulary_targets
for each row
execute function public.validate_vocabulary_target_ownership();

create function public.protect_vocabulary_target_immutable_fields()
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
  return new;
end;
$$;

create trigger vocabulary_targets_protect_immutable_fields
before update on public.vocabulary_targets
for each row
execute function public.protect_vocabulary_target_immutable_fields();

create function public.validate_practice_session_ownership()
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
    raise exception 'practice_sessions.set_id and student_id must belong to the same teacher' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger practice_sessions_validate_ownership
before insert on public.practice_sessions
for each row
execute function public.validate_practice_session_ownership();

revoke execute on function public.protect_vocabulary_set_immutable_fields() from public;
revoke execute on function public.protect_vocabulary_word_immutable_fields() from public;
revoke execute on function public.validate_vocabulary_target_ownership() from public;
revoke execute on function public.protect_vocabulary_target_immutable_fields() from public;
revoke execute on function public.validate_practice_session_ownership() from public;

-- ============================================================================
-- private schema helpers (SECURITY DEFINER, used inside RLS policies and RPCs)
-- ============================================================================

-- Phase 1's private.current_teacher_id()/current_student_id() already
-- require is_active=true. They do not check must_change_password, so a
-- student who has never changed their initial temp password could still
-- pass those checks. is_ready_profile() adds the missing must_change_password
-- gate; every Phase 2 policy and RPC uses it in addition to (not instead of)
-- the existing ownership helpers.
create function private.is_ready_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_profile()
    and not coalesce(
      (select p.must_change_password from public.profiles p where p.id = (select auth.uid())),
      true
    )
$$;

create function private.teacher_owns_vocabulary_set(p_set_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.vocabulary_sets s
    where s.id = p_set_id
      and s.teacher_id = private.current_teacher_id()
  )
$$;

-- Shared by record_vocabulary_attempt() so the submitted spelling and the
-- frozen correct_term are always compared with identical normalization.
create function private.normalize_spelling(p_text text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select lower(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')))
$$;

revoke execute on function private.is_ready_profile() from public;
revoke execute on function private.teacher_owns_vocabulary_set(uuid) from public;
revoke execute on function private.normalize_spelling(text) from public;

grant execute on function private.is_ready_profile() to authenticated;
grant execute on function private.teacher_owns_vocabulary_set(uuid) to authenticated;
grant execute on function private.normalize_spelling(text) to authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.vocabulary_sets enable row level security;
alter table public.vocabulary_words enable row level security;
alter table public.vocabulary_targets enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.vocabulary_attempts enable row level security;
alter table public.practice_session_words enable row level security;

-- vocabulary_sets: teacher has full read/write on their own sets (creation
-- itself is RPC-only, see below -- no INSERT policy needed here); a student
-- may only see a set that is published, not archived, and currently
-- (non-revoked) assigned to them.
create policy "vocabulary_sets_teacher_select"
on public.vocabulary_sets
for select
to authenticated
using (private.is_ready_profile() and teacher_id = private.current_teacher_id());

create policy "vocabulary_sets_teacher_update"
on public.vocabulary_sets
for update
to authenticated
using (private.is_ready_profile() and teacher_id = private.current_teacher_id())
with check (private.is_ready_profile() and teacher_id = private.current_teacher_id());

create policy "vocabulary_sets_student_select_assigned"
on public.vocabulary_sets
for select
to authenticated
using (
  private.is_ready_profile()
  and published_at is not null
  and archived_at is null
  and exists (
    select 1
    from public.vocabulary_targets t
    where t.set_id = id
      and t.student_id = private.current_student_id()
      and t.revoked_at is null
  )
);

-- vocabulary_words: teacher only. No student-visible policy at all -- this
-- is the mechanism that hides `term` (the spelling answer) from students;
-- see the table comment and the migration header.
create policy "vocabulary_words_teacher_select"
on public.vocabulary_words
for select
to authenticated
using (private.is_ready_profile() and private.teacher_owns_vocabulary_set(set_id));

create policy "vocabulary_words_teacher_insert"
on public.vocabulary_words
for insert
to authenticated
with check (private.is_ready_profile() and private.teacher_owns_vocabulary_set(set_id));

create policy "vocabulary_words_teacher_update"
on public.vocabulary_words
for update
to authenticated
using (private.is_ready_profile() and private.teacher_owns_vocabulary_set(set_id))
with check (private.is_ready_profile() and private.teacher_owns_vocabulary_set(set_id));

-- vocabulary_targets: teacher can see all their own assignments and revoke
-- them (UPDATE grant is column-scoped to revoked_at below); a student can
-- see their own. INSERT ("assign") has no policy at all -- it only happens
-- inside assign_vocabulary_set_to_students().
create policy "vocabulary_targets_teacher_select"
on public.vocabulary_targets
for select
to authenticated
using (private.is_ready_profile() and private.teacher_owns_vocabulary_set(set_id));

create policy "vocabulary_targets_teacher_update"
on public.vocabulary_targets
for update
to authenticated
using (private.is_ready_profile() and private.teacher_owns_vocabulary_set(set_id))
with check (private.is_ready_profile() and private.teacher_owns_vocabulary_set(set_id));

create policy "vocabulary_targets_student_select_own"
on public.vocabulary_targets
for select
to authenticated
using (private.is_ready_profile() and student_id = private.current_student_id());

-- practice_sessions / vocabulary_attempts: select-only for both roles. All
-- writes happen inside SECURITY DEFINER RPCs, which bypass RLS entirely, so
-- no INSERT/UPDATE policy exists (or is needed) here.
create policy "practice_sessions_student_select_own"
on public.practice_sessions
for select
to authenticated
using (private.is_ready_profile() and student_id = private.current_student_id());

create policy "practice_sessions_teacher_select_own_students"
on public.practice_sessions
for select
to authenticated
using (private.is_ready_profile() and private.teacher_owns_student(student_id));

create policy "vocabulary_attempts_student_select_own"
on public.vocabulary_attempts
for select
to authenticated
using (
  private.is_ready_profile()
  and exists (
    select 1 from public.practice_sessions ps
    where ps.id = session_id and ps.student_id = private.current_student_id()
  )
);

create policy "vocabulary_attempts_teacher_select_own_students"
on public.vocabulary_attempts
for select
to authenticated
using (
  private.is_ready_profile()
  and exists (
    select 1 from public.practice_sessions ps
    where ps.id = session_id and private.teacher_owns_student(ps.student_id)
  )
);

-- practice_session_words: RLS enabled, deliberately zero policies. Combined
-- with zero GRANTs below, this table is unreachable from any client query
-- regardless of role -- see the table comment.

-- ============================================================================
-- Table-level grants (column-level where narrower access is required)
--
-- service_role gets full CRUD on every new table here for consistency with
-- Phase 1's convention (table privileges are not automatic on this
-- project), even though no Phase 2 code path is expected to use
-- utils/supabase/admin.ts -- Phase 2 has no Auth-admin operations at all.
-- ============================================================================

grant select on public.vocabulary_sets to authenticated;
grant update (title, description, archived_at) on public.vocabulary_sets to authenticated;
grant select, insert, update, delete on public.vocabulary_sets to service_role;

grant select, insert on public.vocabulary_words to authenticated;
grant update (term, meaning, image_url, sort_order, archived_at) on public.vocabulary_words to authenticated;
grant select, insert, update, delete on public.vocabulary_words to service_role;

grant select on public.vocabulary_targets to authenticated;
grant update (revoked_at) on public.vocabulary_targets to authenticated;
grant select, insert, update, delete on public.vocabulary_targets to service_role;

grant select on public.practice_sessions to authenticated;
grant select, insert, update, delete on public.practice_sessions to service_role;

grant select on public.vocabulary_attempts to authenticated;
grant select, insert, update, delete on public.vocabulary_attempts to service_role;

grant select, insert, update, delete on public.practice_session_words to service_role;

-- ============================================================================
-- RPCs
--
-- All seven are SECURITY DEFINER, set search_path = '', EXECUTE revoked from
-- PUBLIC and anon, and granted only to authenticated -- these run inside an
-- already-authenticated user's own session (the same shape as Phase 1's
-- complete_password_change), not the pre-session service_role-only shape of
-- finalize_teacher_bootstrap/finalize_student_creation. Every one starts by
-- checking private.is_ready_profile() explicitly, even where an ownership
-- helper used later would already fail closed for an inactive caller --
-- must_change_password is not covered by those helpers, so this is not
-- fully redundant, and being explicit here means the check is visible in
-- the function body rather than depended on implicitly.
-- ============================================================================

-- 1. Atomic set + words creation. A plain multi-request Server Action
-- (insert set, then insert words) could leave an empty draft behind if the
-- second request failed; doing both inserts in one function body makes it
-- all-or-nothing. Word-level validation (non-empty term/meaning, image_url
-- format, length caps) is enforced by vocabulary_words' own CHECK
-- constraints, not duplicated here.
create function public.create_vocabulary_set_with_words(
  p_title text,
  p_description text,
  p_words jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_set_id uuid;
  v_word jsonb;
  v_position integer := 0;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'caller is not an active teacher' using errcode = '28000';
  end if;

  if p_words is null or jsonb_typeof(p_words) <> 'array' or jsonb_array_length(p_words) = 0 then
    raise exception 'p_words must be a non-empty json array' using errcode = '22023';
  end if;

  insert into public.vocabulary_sets (teacher_id, title, description)
  values (v_teacher_id, p_title, p_description)
  returning id into v_set_id;

  for v_word in select * from jsonb_array_elements(p_words)
  loop
    insert into public.vocabulary_words (set_id, term, meaning, image_url, sort_order)
    values (
      v_set_id,
      v_word ->> 'term',
      v_word ->> 'meaning',
      nullif(v_word ->> 'imageUrl', ''),
      v_position
    );
    v_position := v_position + 1;
  end loop;

  return v_set_id;
end;
$$;

-- 2. "At least one active word" is checked here, not just in the Server
-- Action, because published_at has no UPDATE grant to authenticated at
-- all -- this function is the only thing that can ever set it.
create function public.publish_vocabulary_set(p_set_id uuid)
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

  if not exists (
    select 1 from public.vocabulary_words w
    where w.set_id = p_set_id and w.archived_at is null
  ) then
    raise exception 'vocabulary_set % has no active words to publish', p_set_id using errcode = 'P0001';
  end if;

  update public.vocabulary_sets set published_at = now() where id = p_set_id;
end;
$$;

-- 3. "Only published, not archived sets can be assigned" is checked here,
-- not just in the Server Action -- vocabulary_targets has no INSERT grant
-- to authenticated at all, so this is the only path that can create an
-- assignment (a re-assign after revoke goes through the same upsert).
create function public.assign_vocabulary_set_to_students(
  p_set_id uuid,
  p_student_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.vocabulary_sets;
  v_student_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if not private.teacher_owns_vocabulary_set(p_set_id) then
    raise exception 'vocabulary_set % not found or not owned by caller', p_set_id using errcode = '42501';
  end if;

  select * into v_set from public.vocabulary_sets where id = p_set_id;

  if v_set.published_at is null or v_set.archived_at is not null then
    raise exception 'vocabulary_set % must be published and not archived to be assigned', p_set_id using errcode = 'P0001';
  end if;

  if p_student_ids is null or array_length(p_student_ids, 1) is null then
    raise exception 'p_student_ids must be a non-empty array' using errcode = '22023';
  end if;

  foreach v_student_id in array p_student_ids
  loop
    if not private.teacher_owns_student(v_student_id) then
      raise exception 'student % not found or not owned by caller', v_student_id using errcode = '42501';
    end if;

    insert into public.vocabulary_targets (set_id, student_id)
    values (p_set_id, v_student_id)
    on conflict (set_id, student_id)
    do update set revoked_at = null, assigned_at = now();
  end loop;
end;
$$;

-- 4. Concurrency-safe "resume-or-start". The partial unique index
-- practice_sessions_one_open_per_student_set is what actually guarantees
-- at most one open session per (student, set) under real concurrency --
-- the ON CONFLICT DO UPDATE ... RETURNING is a single atomic statement so
-- there is no separate "insert failed, now go SELECT the winner" step with
-- its own race window. (xmax = 0) distinguishes "this call actually
-- inserted the row" from "this call landed on the conflict branch", which
-- is how we know whether to freeze a fresh snapshot.
create function public.start_practice_session(p_set_id uuid)
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
    insert into public.practice_session_words (session_id, word_id, sort_order, prompt_meaning, prompt_image_url, correct_term)
    select v_session_id, w.id, w.sort_order, w.meaning, w.image_url, w.term
    from public.vocabulary_words w
    where w.set_id = p_set_id and w.archived_at is null
    order by w.sort_order, w.id;
  end if;

  return v_session_id;
end;
$$;

-- 5. The only path a student has to read word prompts. Reads exclusively
-- from the frozen practice_session_words snapshot -- never live
-- vocabulary_words -- so a teacher's mid-session edit never changes what
-- an open session displays. Returns no `term`.
create function public.get_practice_words(p_session_id uuid)
returns table (word_id uuid, meaning text, image_url text, sort_order integer)
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
    select psw.word_id, psw.prompt_meaning, psw.prompt_image_url, psw.sort_order
    from public.practice_session_words psw
    where psw.session_id = p_session_id
    order by psw.sort_order, psw.word_id;
end;
$$;

-- 6. The only path a student has to submit and grade a word. `for update`
-- on the practice_sessions row is the key correctness device: it makes
-- this function and complete_practice_session() mutually exclusive on the
-- same session, so there is no window where one has decided the session is
-- still open while the other has already closed it. Idempotency (an
-- already-graded word returns its stored result, even post-completion,
-- instead of erroring) is checked before the completed_at gate so a
-- network retry of the last answer never fails just because the client
-- already moved on and called complete_practice_session(). Grading always
-- compares against the frozen practice_session_words.correct_term, never
-- live vocabulary_words.term.
create function public.record_vocabulary_attempt(
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

  select a.is_correct, a.correct_term into v_is_correct, v_correct_term
  from public.vocabulary_attempts a
  where a.session_id = p_session_id and a.word_id = p_word_id;

  if found then
    return query select v_is_correct, v_correct_term, true;
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

-- 7. Shares the same row lock discipline as record_vocabulary_attempt() so
-- the two can never race. Does not require every word to have been
-- attempted -- an explicit early "结束" and a full walkthrough both just
-- mean completed_at gets set; see the practice_sessions table comment for
-- how those are told apart when reporting.
create function public.complete_practice_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  perform 1
  from public.practice_sessions
  where id = p_session_id and student_id = private.current_student_id()
  for update;

  if not found then
    raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501';
  end if;

  update public.practice_sessions
  set completed_at = now()
  where id = p_session_id and completed_at is null;
end;
$$;

revoke execute on function public.create_vocabulary_set_with_words(text, text, jsonb) from public, anon;
revoke execute on function public.publish_vocabulary_set(uuid) from public, anon;
revoke execute on function public.assign_vocabulary_set_to_students(uuid, uuid[]) from public, anon;
revoke execute on function public.start_practice_session(uuid) from public, anon;
revoke execute on function public.get_practice_words(uuid) from public, anon;
revoke execute on function public.record_vocabulary_attempt(uuid, uuid, text) from public, anon;
revoke execute on function public.complete_practice_session(uuid) from public, anon;

grant execute on function public.create_vocabulary_set_with_words(text, text, jsonb) to authenticated;
grant execute on function public.publish_vocabulary_set(uuid) to authenticated;
grant execute on function public.assign_vocabulary_set_to_students(uuid, uuid[]) to authenticated;
grant execute on function public.start_practice_session(uuid) to authenticated;
grant execute on function public.get_practice_words(uuid) to authenticated;
grant execute on function public.record_vocabulary_attempt(uuid, uuid, text) to authenticated;
grant execute on function public.complete_practice_session(uuid) to authenticated;
