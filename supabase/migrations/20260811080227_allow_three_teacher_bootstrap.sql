-- ============================================================================
-- Raise the /setup teacher bootstrap cap from 1 to 3.
--
-- Original design assumed a single teacher; the deployment now needs up to
-- three teacher accounts created through /setup. Same lock + recheck shape,
-- just a higher threshold and a renamed error_code for the exhausted case.
-- ============================================================================

create or replace function public.finalize_teacher_bootstrap(
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_count bigint;
begin
  perform pg_advisory_xact_lock(hashtext('finalize_teacher_bootstrap'));

  select count(*) into v_teacher_count from public.teachers;

  if v_teacher_count >= 3 then
    insert into public.audit_log
      (actor_user_id, actor_type, action, target_table, request_id, outcome, error_code, detail)
    values
      (null, 'system', 'teacher_bootstrap', 'teachers', p_request_id, 'failed', 'teacher_limit_reached',
       jsonb_build_object('username', p_username));
    return false;
  end if;

  insert into public.profiles (id, username, full_name, role, is_active, must_change_password)
  values (p_user_id, p_username, p_full_name, 'teacher', true, false);

  insert into public.teachers (id) values (p_user_id);

  insert into public.audit_log
    (actor_user_id, actor_type, action, target_table, target_id, request_id, outcome, detail)
  values
    (null, 'system', 'teacher_bootstrap', 'teachers', p_user_id, p_request_id, 'succeeded',
     jsonb_build_object('username', p_username));

  return true;
end;
$$;
;
