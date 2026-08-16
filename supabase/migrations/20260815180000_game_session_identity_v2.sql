-- Games needs the database auth-session id for its server-only runtime identity.
-- This sibling preserves v1 and exposes no new credential or client user-id path.

do $membership$
begin
  execute pg_catalog.format('grant game_api_owner to %I', current_user);
end
$membership$;

set role game_api_owner;

create function game.validate_game_session_v2(p_game_session_token text)
returns table (
  auth_session_id uuid,
  user_id uuid,
  assignment_id uuid,
  force_exit_at timestamptz,
  launch_context jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity record;
begin
  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);

  return query select
    v_identity.auth_session_id,
    v_identity.authenticated_user_id,
    v_identity.bound_assignment_id,
    v_identity.force_exit_at,
    game_private.build_launch_context(
      v_identity.authenticated_user_id,
      v_identity.bound_assignment_id
    );
end;
$$;

revoke execute on function game.validate_game_session_v2(text)
  from public, anon, authenticated, service_role, game_server;
grant execute on function game.validate_game_session_v2(text) to game_server;

reset role;

do $membership$
begin
  execute pg_catalog.format('revoke game_api_owner from %I', current_user);
end
$membership$;
