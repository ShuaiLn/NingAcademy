-- public.rls_auto_enable() is the Supabase Dashboard's "automatically enable
-- RLS on new tables" event trigger function (docs/p1/MIGRATION_DRIFT_REPORT.md
-- IA-2: Production-only, created outside this repo's migrations, hash-pinned
-- and left in place rather than dropped). PostgreSQL grants EXECUTE to PUBLIC
-- on every new function by default, so anon/authenticated/service_role and
-- both game runtime roles could call it directly even though it is only ever
-- meant to run as the ddl_command_end event trigger's SECURITY DEFINER
-- action. This revokes only the direct-call surface; it does not touch the
-- function body, its owner, or the "ensure_rls" event trigger itself, which
-- keeps firing on every DDL command exactly as before.
--
-- Because the function is Production-only and was never created by any
-- migration in this repo, a clean/local/CI replay never has it. A bare
-- REVOKE there fails with SQLSTATE 42883 (undefined function), so this is a
-- conditional no-op: it checks for the function with
-- pg_catalog.to_regprocedure() and only issues the two REVOKE EXECUTE
-- statements -- via EXECUTE so they are never parsed/prepared unless that
-- check passes -- when it actually exists. It never creates the function,
-- never touches its body/owner/SECURITY DEFINER, never drops it, and never
-- touches the event trigger.

do $$
begin
  if pg_catalog.to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public';
    execute 'revoke execute on function public.rls_auto_enable() from anon, authenticated, service_role, game_server, games_api';
  end if;
end
$$;
