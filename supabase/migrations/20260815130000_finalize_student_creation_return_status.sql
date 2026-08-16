-- P-1 forward-fix (drift finding 6, docs/p1/MIGRATION_DRIFT_REPORT.md):
--
-- Same bug class as migration 11 (allow_three_teacher_bootstrap.sql) fixed
-- for finalize_teacher_bootstrap: core_auth.sql's original
-- finalize_student_creation returns void and re-raises on any error,
-- which (per this project's own "return a status, not RAISE after
-- logging" rule) rolls back its own compensating audit_log insert on every
-- failure path. AGENTS.md already documents finalize_student_creation as
-- following the fixed return-boolean pattern, but unlike
-- finalize_teacher_bootstrap, no migration ever actually applied that fix
-- here -- and core_auth.sql never granted execute on this function to any
-- role at all, not even service_role.
--
-- Production has carried a corrected, RETURNS boolean version of this
-- function (with a service_role execute grant) since before this
-- repository's Git history began. The body below is that verified
-- Production version, read directly from a live schema dump, not a
-- redesign: app/actions/students.ts calls this RPC through the
-- service-role admin client and checks `!rpcOk`, so the contract below
-- (return false + a logged 'failed' audit_log row for both the
-- teacher-not-found and username-taken cases, return true + a logged
-- 'succeeded' row on success, no top-level exception handler so a
-- genuinely unexpected error still raises and skips the audit row) is
-- exactly what the caller already assumes.
--
-- PostgreSQL cannot change a function's return type with CREATE OR REPLACE.
-- Drop the exact overload only when it still has the legacy non-boolean return
-- type. Production already has the boolean contract, so it keeps the same
-- function object/OID and is updated safely through CREATE OR REPLACE below.
-- A missing function also falls through to CREATE OR REPLACE.
do $migration$
declare
  v_return_type pg_catalog.oid;
begin
  select routine.prorettype
  into v_return_type
  from pg_catalog.pg_proc as routine
  where routine.oid = pg_catalog.to_regprocedure(
    'public.finalize_student_creation(uuid,text,text,uuid,uuid)'
  );

  if found and v_return_type <> 'boolean'::pg_catalog.regtype then
    drop function public.finalize_student_creation(uuid, text, text, uuid, uuid);
  end if;
end
$migration$;

create or replace function public.finalize_student_creation(
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_teacher_id uuid,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.teachers where id = p_teacher_id) then
    insert into public.audit_log
      (actor_user_id, actor_type, action, target_table, request_id, outcome, error_code, detail)
    values
      (p_teacher_id, 'teacher', 'student_create', 'students', p_request_id, 'failed', 'teacher_not_found',
       jsonb_build_object('username', p_username));
    return false;
  end if;

  begin
    insert into public.profiles (id, username, full_name, role, is_active, must_change_password)
    values (p_user_id, p_username, p_full_name, 'student', true, true);

    insert into public.students (id, teacher_id) values (p_user_id, p_teacher_id);
  exception
    when unique_violation then
      insert into public.audit_log
        (actor_user_id, actor_type, action, target_table, request_id, outcome, error_code, detail)
      values
        (p_teacher_id, 'teacher', 'student_create', 'students', p_request_id, 'failed', 'username_taken',
         jsonb_build_object('username', p_username));
      return false;
  end;

  insert into public.audit_log
    (actor_user_id, actor_type, action, target_table, target_id, request_id, outcome, detail)
  values
    (p_teacher_id, 'teacher', 'student_create', 'students', p_user_id, p_request_id, 'succeeded',
     jsonb_build_object('username', p_username));

  return true;
end;
$$;

revoke execute on function public.finalize_student_creation(uuid, text, text, uuid, uuid) from public;
grant execute on function public.finalize_student_creation(uuid, text, text, uuid, uuid) to service_role;
