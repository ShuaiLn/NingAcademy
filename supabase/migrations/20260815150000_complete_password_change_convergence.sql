-- P-1 non-game convergence migration for complete_password_change(uuid).
--
-- Production has the authoritative simple body below. The historical active
-- migration was edited after that shared state was created and added a
-- WHEN OTHERS handler whose audit insert is rolled back by its own RAISE.
--
-- CREATE OR REPLACE keeps the existing function identity/OID, owner, ACL and
-- dependencies. The signature, return type, language, SECURITY DEFINER flag,
-- empty search_path, caller-visible errors and success behavior are unchanged.
-- Reapplying this migration is safe and converges both the historical replay
-- body and an already-final Production-like body to the same definition.

create or replace function public.complete_password_change(p_request_id uuid)
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
end;
$$;
