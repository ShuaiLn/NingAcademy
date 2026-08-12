-- Phase 1: core_auth
-- profiles / teachers / students / audit_log, private helper schema,
-- role-bootstrap RPCs, and precise grants/RLS for the identity chain.
--
-- Identity chain: auth.users -> profiles -> teachers|students, all ON DELETE
-- RESTRICT. There is intentionally no application-level "change role" or
-- "delete identity" path in Phase 1.

-- ============================================================================
-- Schemas
-- ============================================================================

create schema if not exists private;

-- ============================================================================
-- Tables
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  username text not null unique,
  full_name text not null,
  role text not null check (role in ('teacher', 'student')),
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_-]{3,30}$')
);

comment on table public.profiles is
  'One row per auth.users identity. No email column: auth.users email is a fixed {username}@users.ningacademy.internal placeholder solely to satisfy Supabase Auth, never shown to users.';

create table public.teachers (
  id uuid primary key references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key references public.profiles (id) on delete restrict,
  teacher_id uuid not null references public.teachers (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index students_teacher_id_idx on public.students (teacher_id);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_type text not null check (actor_type in ('teacher', 'student', 'system')),
  action text not null,
  target_table text,
  target_id uuid,
  request_id uuid not null,
  outcome text not null check (outcome in ('started', 'succeeded', 'failed')),
  error_code text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_log_detail_no_secrets check (
    not (
      detail ? 'password' or detail ? 'token' or detail ? 'secret' or detail ? 'key'
    )
  )
);

comment on table public.audit_log is
  'Append-only audit trail for sensitive account/credential operations. detail must never contain raw passwords/tokens/keys.';

create index audit_log_request_id_idx on public.audit_log (request_id);
create index audit_log_target_idx on public.audit_log (target_table, target_id);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

-- ============================================================================
-- Trigger functions
-- ============================================================================

create function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create function public.protect_immutable_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.username is distinct from old.username then
    raise exception 'username cannot be changed' using errcode = 'P0001';
  end if;
  if new.role is distinct from old.role then
    raise exception 'role cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_immutable_fields
before update on public.profiles
for each row
execute function public.protect_immutable_profile_fields();

create function public.validate_teacher_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = new.id;

  if v_role is null then
    raise exception 'profile % does not exist', new.id using errcode = 'P0001';
  end if;

  if v_role <> 'teacher' then
    raise exception 'profile % is not a teacher (role=%)', new.id, v_role using errcode = 'P0001';
  end if;

  if exists (select 1 from public.students where id = new.id) then
    raise exception 'profile % already exists as a student', new.id using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger teachers_validate_role
before insert on public.teachers
for each row
execute function public.validate_teacher_role();

create function public.validate_student_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = new.id;

  if v_role is null then
    raise exception 'profile % does not exist', new.id using errcode = 'P0001';
  end if;

  if v_role <> 'student' then
    raise exception 'profile % is not a student (role=%)', new.id, v_role using errcode = 'P0001';
  end if;

  if exists (select 1 from public.teachers where id = new.id) then
    raise exception 'profile % already exists as a teacher', new.id using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger students_validate_role
before insert on public.students
for each row
execute function public.validate_student_role();

revoke execute on function public.set_updated_at() from public;
revoke execute on function public.protect_immutable_profile_fields() from public;
revoke execute on function public.validate_teacher_role() from public;
revoke execute on function public.validate_student_role() from public;

-- ============================================================================
-- private schema helpers (SECURITY DEFINER, used inside RLS policies)
-- ============================================================================

create function private.current_teacher_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.teachers t
  join public.profiles p on p.id = t.id
  where t.id = (select auth.uid())
    and p.is_active = true
  limit 1
$$;

create function private.current_student_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.students s
  join public.profiles p on p.id = s.id
  where s.id = (select auth.uid())
    and p.is_active = true
  limit 1
$$;

create function private.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_active from public.profiles p where p.id = (select auth.uid())),
    false
  )
$$;

create function private.teacher_owns_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.students s
    where s.id = p_student_id
      and s.teacher_id = private.current_teacher_id()
  )
$$;

revoke execute on function private.current_teacher_id() from public;
revoke execute on function private.current_student_id() from public;
revoke execute on function private.is_active_profile() from public;
revoke execute on function private.teacher_owns_student(uuid) from public;

grant usage on schema private to authenticated;
grant execute on function private.current_teacher_id() to authenticated;
grant execute on function private.current_student_id() to authenticated;
grant execute on function private.is_active_profile() to authenticated;
grant execute on function private.teacher_owns_student(uuid) to authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.audit_log enable row level security;

-- profiles: everyone can see their own row; a teacher can see (and rename)
-- the profiles of their own students.
create policy "profiles_select_self"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

create policy "profiles_select_own_students"
on public.profiles
for select
to authenticated
using (role = 'student' and private.teacher_owns_student(id));

create policy "profiles_update_own_students_full_name"
on public.profiles
for update
to authenticated
using (role = 'student' and private.teacher_owns_student(id))
with check (role = 'student' and private.teacher_owns_student(id));

-- teachers: self only.
create policy "teachers_select_self"
on public.teachers
for select
to authenticated
using (id = (select auth.uid()));

-- students: self, or the owning teacher.
create policy "students_select_self"
on public.students
for select
to authenticated
using (id = (select auth.uid()));

create policy "students_select_own_teacher"
on public.students
for select
to authenticated
using (teacher_id = private.current_teacher_id());

-- audit_log: append-only, and only ever self-attributed when written
-- directly by an authenticated client (RPC-driven writes run as the table
-- owner and bypass RLS entirely).
create policy "audit_log_insert_self_attributed"
on public.audit_log
for insert
to authenticated
with check (actor_user_id = (select auth.uid()));

-- ============================================================================
-- Table-level grants (column-level where narrower access is required)
-- ============================================================================

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

grant select on public.teachers to authenticated;

grant select on public.students to authenticated;

grant insert on public.audit_log to authenticated;

-- ============================================================================
-- Account-creation RPCs
--
-- Both are called exclusively by trusted server code using the secret
-- (service_role) Supabase client, immediately after auth.admin.createUser.
-- They are never exposed to anon/authenticated (EXECUTE stays revoked from
-- PUBLIC below, and is deliberately not re-granted to authenticated).
-- ============================================================================

create function public.finalize_teacher_bootstrap(
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_count bigint;
begin
  perform pg_advisory_xact_lock(hashtext('finalize_teacher_bootstrap'));

  select count(*) into v_teacher_count from public.teachers;

  if v_teacher_count > 0 then
    raise exception 'a teacher account already exists' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, username, full_name, role, is_active, must_change_password)
  values (p_user_id, p_username, p_full_name, 'teacher', true, false);

  insert into public.teachers (id) values (p_user_id);

  insert into public.audit_log
    (actor_user_id, actor_type, action, target_table, target_id, request_id, outcome, detail)
  values
    (null, 'system', 'teacher_bootstrap', 'teachers', p_user_id, p_request_id, 'succeeded',
     jsonb_build_object('username', p_username));
exception
  when others then
    insert into public.audit_log
      (actor_user_id, actor_type, action, target_table, target_id, request_id, outcome, error_code, detail)
    values
      (null, 'system', 'teacher_bootstrap', 'teachers', null, p_request_id, 'failed', sqlstate,
       jsonb_build_object('username', p_username, 'error', sqlerrm));
    raise;
end;
$$;

create function public.finalize_student_creation(
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_teacher_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.teachers where id = p_teacher_id) then
    raise exception 'teacher % does not exist', p_teacher_id using errcode = 'P0001';
  end if;

  insert into public.profiles (id, username, full_name, role, is_active, must_change_password)
  values (p_user_id, p_username, p_full_name, 'student', true, true);

  insert into public.students (id, teacher_id) values (p_user_id, p_teacher_id);

  insert into public.audit_log
    (actor_user_id, actor_type, action, target_table, target_id, request_id, outcome, detail)
  values
    (p_teacher_id, 'teacher', 'student_create', 'students', p_user_id, p_request_id, 'succeeded',
     jsonb_build_object('username', p_username));
exception
  when others then
    insert into public.audit_log
      (actor_user_id, actor_type, action, target_table, target_id, request_id, outcome, error_code, detail)
    values
      (p_teacher_id, 'teacher', 'student_create', 'students', null, p_request_id, 'failed', sqlstate,
       jsonb_build_object('username', p_username, 'error', sqlerrm));
    raise;
end;
$$;

revoke execute on function public.finalize_teacher_bootstrap(uuid, text, text, uuid) from public;
revoke execute on function public.finalize_student_creation(uuid, text, text, uuid, uuid) from public;

-- ============================================================================
-- complete_password_change RPC
--
-- Called by the authenticated user themselves (regular server client) right
-- after a successful supabase.auth.updateUser({ password }). Exempt from the
-- is_active/must_change_password gate that guards ordinary business data,
-- since a user who must change their password has to be able to reach this.
-- ============================================================================

create function public.complete_password_change(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select role into v_role from public.profiles where id = v_uid;

  update public.profiles
  set must_change_password = false
  where id = v_uid;

  insert into public.audit_log
    (actor_user_id, actor_type, action, target_table, target_id, request_id, outcome, detail)
  values
    (v_uid, coalesce(v_role, 'system'), 'change_password', 'profiles', v_uid, p_request_id, 'succeeded', '{}'::jsonb);
exception
  when others then
    insert into public.audit_log
      (actor_user_id, actor_type, action, target_table, target_id, request_id, outcome, error_code, detail)
    values
      (v_uid, coalesce(v_role, 'system'), 'change_password', 'profiles', v_uid, p_request_id, 'failed', sqlstate,
       jsonb_build_object('error', sqlerrm));
    raise;
end;
$$;

revoke execute on function public.complete_password_change(uuid) from public;
grant execute on function public.complete_password_change(uuid) to authenticated;
;
