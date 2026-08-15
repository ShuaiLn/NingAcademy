\set ON_ERROR_STOP on

begin transaction read only;

select (current_setting('transaction_read_only') = 'on') as transaction_is_read_only
\gset
\if :transaction_is_read_only
\else
  \echo 'Refusing Production audit: transaction_read_only is not on.'
  do $$ begin raise exception 'Refusing Production audit: transaction_read_only is not on.' using errcode = 'P0001'; end; $$;
\endif

select not (
  coalesce(rolsuper, false)
  or coalesce(rolcreatedb, false)
  or coalesce(rolcreaterole, false)
  or coalesce(rolreplication, false)
  or coalesce(rolbypassrls, false)
) as role_is_restricted
from pg_catalog.pg_roles
where rolname = current_user
\gset
\if :role_is_restricted
\else
  \echo 'Refusing Production audit: the connection role is elevated.'
  do $$ begin raise exception 'Refusing Production audit: the connection role is elevated.' using errcode = 'P0001'; end; $$;
\endif

select not (
  pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE')
  or exists (
    select 1
    from pg_catalog.pg_namespace as namespace
    where namespace.nspname <> 'information_schema'
      and namespace.nspname !~ '^pg_'
      and pg_catalog.has_schema_privilege(current_user, namespace.oid, 'CREATE')
  )
) as role_cannot_create_objects
\gset
\if :role_cannot_create_objects
\else
  \echo 'Refusing Production audit: the connection role can create database objects.'
  do $$ begin raise exception 'Refusing Production audit: the connection role can create database objects.' using errcode = 'P0001'; end; $$;
\endif

-- Scoped to NingAcademy's own project schemas only, not every non-system
-- schema. Supabase-managed extension schemas (cron, net, auth, storage,
-- extensions, realtime, vault, supabase_migrations, ...) commonly grant
-- some privileges on their own bookkeeping tables to PUBLIC as part of
-- their own installation (e.g. cron.job_run_details, net._http_response,
-- net.http_request_queue) -- privileges every role inherits regardless of
-- how restricted it is, and that have nothing to do with whether this
-- audit role can write NingAcademy's own data. The workflow's Production
-- export/comparison steps never read or touch anything outside these four
-- schemas either, so scoping the write-privilege proof to match is not a
-- weaker guarantee for anything this audit actually does.
select not exists (
  select 1
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname in (
    'public',
    'private',
    'game',
    'game_private'
  )
    and relation.relkind in ('r', 'p', 'v', 'm', 'f')
    and pg_catalog.has_table_privilege(
      current_user,
      relation.oid,
      'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES'
    )
) as role_has_no_table_write_privileges
\gset
\if :role_has_no_table_write_privileges
\else
  \echo 'Refusing Production audit: the connection role has table write privileges.'
  do $$ begin raise exception 'Refusing Production audit: the connection role has table write privileges.' using errcode = 'P0001'; end; $$;
\endif

select not exists (
  select 1
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname in (
    'public',
    'private',
    'game',
    'game_private'
  )
    and relation.relkind = 'S'
    and pg_catalog.has_sequence_privilege(current_user, relation.oid, 'USAGE,UPDATE')
) as role_has_no_sequence_write_privileges
\gset
\if :role_has_no_sequence_write_privileges
\else
  \echo 'Refusing Production audit: the connection role has sequence write privileges.'
  do $$ begin raise exception 'Refusing Production audit: the connection role has sequence write privileges.' using errcode = 'P0001'; end; $$;
\endif

select current_database() as audited_database, current_user as audit_role,
       current_setting('transaction_read_only') as transaction_read_only;

commit;
