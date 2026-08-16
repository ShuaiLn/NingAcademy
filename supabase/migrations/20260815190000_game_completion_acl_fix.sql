-- get_game_assignment_completion_v1 is SECURITY DEFINER-owned by
-- game_api_owner and calls the existing private visibility helper. The P0
-- grant list covered the identity helpers but omitted this dependency, so
-- authenticated student/teacher calls failed closed with 42501.

grant execute on function private.can_view_assignment(uuid) to game_api_owner;
