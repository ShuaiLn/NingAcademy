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

-- This migration must converge both states we know exist:
--
-- * a clean replay, where core_auth.sql created the two legacy policies;
-- * Production, where the legacy policies are already gone and the combined
--   policies already exist.
--
-- DROP IF EXISTS makes removal of the legacy names repeatable. For each final
-- policy, preserve an already-compatible SELECT/permissive policy and ALTER it
-- to the canonical role/expression. If an object with the target name exists
-- with an incompatible command or permissiveness, replace only that object.
drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_select_own_students" on public.profiles;
drop policy if exists "students_select_self" on public.students;
drop policy if exists "students_select_own_teacher" on public.students;

do $migration$
begin
  if exists (
    select 1
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'profiles'
      and policy.polname = 'profiles_select_self_or_own_students'
      and (policy.polcmd <> 'r' or not policy.polpermissive)
  ) then
    drop policy "profiles_select_self_or_own_students" on public.profiles;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'profiles'
      and policy.polname = 'profiles_select_self_or_own_students'
  ) then
    alter policy "profiles_select_self_or_own_students"
    on public.profiles
    to authenticated
    using (
      id = (select auth.uid())
      or (role = 'student' and private.teacher_owns_student(id))
    );
  else
    create policy "profiles_select_self_or_own_students"
    on public.profiles
    for select
    to authenticated
    using (
      id = (select auth.uid())
      or (role = 'student' and private.teacher_owns_student(id))
    );
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'students'
      and policy.polname = 'students_select_self_or_own_teacher'
      and (policy.polcmd <> 'r' or not policy.polpermissive)
  ) then
    drop policy "students_select_self_or_own_teacher" on public.students;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'students'
      and policy.polname = 'students_select_self_or_own_teacher'
  ) then
    alter policy "students_select_self_or_own_teacher"
    on public.students
    to authenticated
    using (
      id = (select auth.uid())
      or teacher_id = private.current_teacher_id()
    );
  else
    create policy "students_select_self_or_own_teacher"
    on public.students
    for select
    to authenticated
    using (
      id = (select auth.uid())
      or teacher_id = private.current_teacher_id()
    );
  end if;
end
$migration$;

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.students to service_role;
grant select, insert, update, delete on public.teachers to service_role;
grant select, insert on public.audit_log to service_role;

-- The local Supabase bootstrap grants UPDATE on all future public sequences
-- to API roles through postgres's default ACL. Production does not carry those
-- defaults, and this repository requires sequence/table access to be granted
-- explicitly per object. REVOKE is safe when the default grants are already
-- absent and converges clean replay to the Production/application contract.
alter default privileges for role postgres in schema public
  revoke update on sequences from anon, authenticated, service_role;
