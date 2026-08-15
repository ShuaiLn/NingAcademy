-- P-1 forward-fix (drift finding 4 and 5, docs/p1/MIGRATION_DRIFT_REPORT.md):
--
-- core_auth.sql (migration 1) never combined the split profiles/students
-- SELECT policies the way the later vocabulary_rls_perf_fixes.sql (migration
-- 3) combined vocabulary_sets/vocabulary_targets/practice_sessions/
-- vocabulary_attempts -- even though that migration's own comment already
-- says "the same fix Phase 1 already applied to profiles (see
-- profiles_select_self_or_own_students)". Production has carried the
-- combined policies since before this repository's Git history began; this
-- migration is the first time that pre-Git "Phase 1" change is captured as
-- a tracked migration. The USING clauses below are the verified OR of
-- core_auth.sql's original two policies per table, read directly from a
-- live Production schema dump -- not a redesign.
--
-- Production also carries wider service_role table privileges on these
-- same four core_auth.sql tables than any tracked migration ever grants:
-- core_auth.sql never touches service_role privileges on profiles/students/
-- teachers/audit_log at all (every other table created by migrations 2-19
-- does get an explicit service_role grant at creation time). The grants
-- below add exactly the missing privileges confirmed present on Production
-- and nothing more: full read/write on profiles/students/teachers, and
-- append-only read/write (no update/delete) on audit_log, matching its
-- documented append-only design.

drop policy "profiles_select_self" on public.profiles;
drop policy "profiles_select_own_students" on public.profiles;

create policy "profiles_select_self_or_own_students"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (role = 'student' and private.teacher_owns_student(id))
);

drop policy "students_select_self" on public.students;
drop policy "students_select_own_teacher" on public.students;

create policy "students_select_self_or_own_teacher"
on public.students
for select
to authenticated
using (
  id = (select auth.uid())
  or teacher_id = private.current_teacher_id()
);

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.students to service_role;
grant select, insert, update, delete on public.teachers to service_role;
grant select, insert on public.audit_log to service_role;
