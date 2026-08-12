-- Phase 2 follow-up: performance advisor fixes
--
-- Combines the split teacher/student SELECT policies on vocabulary_sets,
-- vocabulary_targets, practice_sessions, and vocabulary_attempts into one
-- policy per table -- the same fix Phase 1 already applied to profiles
-- (see profiles_select_self_or_own_students), per the Postgres/Supabase
-- performance advisor: multiple permissive policies for the same role+
-- action are evaluated and OR'd on every query. Also adds the one FK index
-- the performance advisor flagged as missing.

drop policy "vocabulary_sets_teacher_select" on public.vocabulary_sets;
drop policy "vocabulary_sets_student_select_assigned" on public.vocabulary_sets;

create policy "vocabulary_sets_select_own_or_assigned"
on public.vocabulary_sets
for select
to authenticated
using (
  private.is_ready_profile()
  and (
    teacher_id = private.current_teacher_id()
    or (
      published_at is not null
      and archived_at is null
      and exists (
        select 1
        from public.vocabulary_targets t
        where t.set_id = id
          and t.student_id = private.current_student_id()
          and t.revoked_at is null
      )
    )
  )
);

drop policy "vocabulary_targets_teacher_select" on public.vocabulary_targets;
drop policy "vocabulary_targets_student_select_own" on public.vocabulary_targets;

create policy "vocabulary_targets_select_own_or_owned_set"
on public.vocabulary_targets
for select
to authenticated
using (
  private.is_ready_profile()
  and (
    private.teacher_owns_vocabulary_set(set_id)
    or student_id = private.current_student_id()
  )
);

drop policy "practice_sessions_student_select_own" on public.practice_sessions;
drop policy "practice_sessions_teacher_select_own_students" on public.practice_sessions;

create policy "practice_sessions_select_own_or_own_students"
on public.practice_sessions
for select
to authenticated
using (
  private.is_ready_profile()
  and (
    student_id = private.current_student_id()
    or private.teacher_owns_student(student_id)
  )
);

drop policy "vocabulary_attempts_student_select_own" on public.vocabulary_attempts;
drop policy "vocabulary_attempts_teacher_select_own_students" on public.vocabulary_attempts;

create policy "vocabulary_attempts_select_own_or_own_students"
on public.vocabulary_attempts
for select
to authenticated
using (
  private.is_ready_profile()
  and exists (
    select 1 from public.practice_sessions ps
    where ps.id = session_id
      and (ps.student_id = private.current_student_id() or private.teacher_owns_student(ps.student_id))
  )
);

create index practice_session_words_word_id_idx on public.practice_session_words (word_id);
