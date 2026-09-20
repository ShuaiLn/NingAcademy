# Production Read-Only Audit Setup

Status date: 2026-09-18 (America/Tijuana)

This runbook documents the credential and GitHub Environment used by the
manual Production branch of `.github/workflows/p1-database-audit.yml`. It does
not authorize a Production write. The workflow performs catalog checks and
read-only exports only.

The canonical existing login is `p1_readonly_audit_v2`. Do not rename or
recreate it merely because this procedure is now documented. On 2026-09-18,
read-only catalog inspection confirmed that it has only `pg_read_all_data`, no
elevated role attributes, no database or schema `CREATE`, no table mutation or
sequence write privileges, and no executable application `SECURITY DEFINER`
functions.

## Why `pg_read_all_data`

The audit exports every application schema plus migration and catalog metadata,
so a hand-maintained list of table grants would be brittle. PostgreSQL defines
[`pg_read_all_data`](https://www.postgresql.org/docs/16/predefined-roles.html)
as read access to all tables, views, and sequences, with schema `USAGE`. It
does not grant writes, role administration, or `BYPASSRLS`; the workflow also
fails closed if it detects elevated or mutation privileges.

## Manual create or recovery template

Run this only under separately approved owner recovery. Substitute a strong,
unique password through the operator's secret-safe mechanism; do not paste a
real password into SQL history, documentation, issues, or workflow logs.

```sql
create role p1_readonly_audit_v2
  login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

revoke all on database postgres from p1_readonly_audit_v2;
grant connect on database postgres to p1_readonly_audit_v2;
grant pg_read_all_data to p1_readonly_audit_v2;

alter role p1_readonly_audit_v2 set default_transaction_read_only = on;
alter role p1_readonly_audit_v2 set statement_timeout = '120s';
alter role p1_readonly_audit_v2 set lock_timeout = '5s';
```

For recovery of the existing role, use the corresponding `ALTER ROLE` and
`GRANT` statements instead of dropping or recreating it. Review any unexpected
membership before revoking it. The observed existing role has the first two
defaults; the workflow independently forces all three settings, including
`lock_timeout=5s`. Adding the third role default is an owner recovery action,
not a prerequisite for reusing the healthy canonical role.

## Verification queries

Run these as an owner in a read-only inspection session and retain sanitized
results. Each result must match the stated expectation before storing a URL.

```sql
-- Exactly the intended, non-elevated LOGIN attributes.
select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
       rolcreaterole, rolreplication, rolbypassrls
from pg_catalog.pg_roles
where rolname = 'p1_readonly_audit_v2';

-- Exactly one direct membership: pg_read_all_data.
select granted.rolname as granted_role,
       membership.admin_option,
       membership.inherit_option,
       membership.set_option
from pg_catalog.pg_auth_members membership
join pg_catalog.pg_roles member on member.oid = membership.member
join pg_catalog.pg_roles granted on granted.oid = membership.roleid
where member.rolname = 'p1_readonly_audit_v2'
order by granted.rolname;

-- CONNECT must be true and CREATE must be false.
select pg_catalog.has_database_privilege(
         'p1_readonly_audit_v2', 'postgres', 'CONNECT') as can_connect,
       pg_catalog.has_database_privilege(
         'p1_readonly_audit_v2', 'postgres', 'CREATE') as can_create;

-- No CREATE in any non-system application schema.
select n.nspname
from pg_catalog.pg_namespace n
where n.nspname not like 'pg_%'
  and n.nspname <> 'information_schema'
  and pg_catalog.has_schema_privilege(
        'p1_readonly_audit_v2', n.oid, 'CREATE');

-- No table mutation privilege. Expect no rows.
select n.nspname, c.relname, privilege_type
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
cross join lateral unnest(array[
  'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES'
]) as p(privilege_type)
where c.relkind in ('r', 'p', 'v', 'm', 'f')
  and n.nspname in ('public', 'private', 'game', 'game_private',
                    'storage', 'auth', 'supabase_migrations')
  and pg_catalog.has_table_privilege(
        'p1_readonly_audit_v2', c.oid, p.privilege_type);

-- Materialize sequence identities before privilege checks. Expect no rows.
with application_sequences as materialized (
  select c.oid, n.nspname, c.relname
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'S'
    and n.nspname in ('public', 'private', 'game', 'game_private',
                      'storage', 'auth', 'supabase_migrations')
)
select nspname, relname
from application_sequences
where pg_catalog.has_sequence_privilege(
        'p1_readonly_audit_v2', oid, 'USAGE')
   or pg_catalog.has_sequence_privilege(
        'p1_readonly_audit_v2', oid, 'UPDATE');

-- No executable application SECURITY DEFINER function. Expect no rows.
select n.nspname, p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname in ('public', 'private', 'game', 'game_private',
                    'storage', 'auth')
  and pg_catalog.has_function_privilege(
        'p1_readonly_audit_v2', p.oid, 'EXECUTE')
order by n.nspname, p.proname, arguments;

-- Confirm role defaults.
select r.rolname, d.datname, s.setconfig
from pg_catalog.pg_db_role_setting s
join pg_catalog.pg_roles r on r.oid = s.setrole
left join pg_catalog.pg_database d on d.oid = s.setdatabase
where r.rolname = 'p1_readonly_audit_v2';
```

All privilege result sets above must be empty except role attributes,
membership, database access, and defaults. Membership must contain only
`pg_read_all_data`; `can_connect` must be true and `can_create` false.

## Connection string

Prefer the direct PostgreSQL endpoint on port 5432, copied from the Supabase
Dashboard:

```text
postgresql://p1_readonly_audit_v2:<URL-ENCODED-PASSWORD>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
```

Supabase documents the direct connection as IPv6 by default. If a GitHub-hosted
runner cannot reach that endpoint, copy the Dashboard-provided **shared Session
Pooler** connection string on port 5432 and use username
`p1_readonly_audit_v2.<project-ref>`. Never construct a pooler hostname
manually. Never use transaction mode on port 6543: `pg_dump` and this audit
need a session connection. See the official
[Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

## GitHub Environment

1. In repository settings, create or open the Environment named exactly
   `production-read-only-audit`.
2. Configure an appropriate required reviewer if repository plan and policy
   support it. The current reviewer/protection configuration remains
   **UNVERIFIED** and requires owner confirmation. If reviewers are
   intentionally optional, record that owner decision explicitly rather than
   inferring it from the absence of an approval prompt.
3. Add one Environment secret named exactly
   `PRODUCTION_DATABASE_READ_ONLY_URL`, containing the dedicated connection
   string above.
4. Do not put this URL in repository or organization secrets, application
   `.env` files, Vercel variables, artifacts, or logs.
5. Do not substitute a database owner/`postgres` URL, Supabase service-role
   key, anon/application key, JWT, or any Vercel credential. Those are either
   the wrong protocol or materially overprivileged.

## Run and retain evidence

From `Actions -> P-1 database audit -> Run workflow`, select the intended
`main` revision and set `run_production_audit=true`. Require replay,
application verification, aggregate gate, and Production read-only audit to
pass. Review the role proof, 33/33 histories, migration preconditions, raw and
filtered schema/ACL comparisons, and all three artifacts before recording the
result. Artifacts currently retain for 14 days, so download and archive them
under the owner's evidence-retention process before expiry.

The resulting run proves only the application SHA it audited. If an
evidence-only documentation commit records the run afterward, state that
relationship explicitly; do not describe the documentation commit as the
audited predecessor.
