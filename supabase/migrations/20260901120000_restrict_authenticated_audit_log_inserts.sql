-- NA-SEC-001: audit rows are trusted records, not client-authored data.
--
-- Application audit writes use the service_role client or SECURITY DEFINER
-- functions. Keep those paths intact while removing every direct browser-role
-- INSERT grant and the historical self-attribution policy.

revoke insert on table public.audit_log from public, anon, authenticated;

drop policy if exists "audit_log_insert_self_attributed" on public.audit_log;
