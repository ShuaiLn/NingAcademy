\set ON_ERROR_STOP on

begin transaction read only;

select exists (
  select 1
  from information_schema.columns
  where table_schema = 'supabase_migrations'
    and table_name = 'schema_migrations'
    and column_name = 'name'
) as history_has_name
\gset

\if :history_has_name
  \copy (select row_number() over (order by version)::integer as execution_order, version::text as version, coalesce(name, '')::text as name from supabase_migrations.schema_migrations order by version) to '/audit/db_migrations.csv' with (format csv, header true)
\else
  \copy (select row_number() over (order by version)::integer as execution_order, version::text as version, ''::text as name from supabase_migrations.schema_migrations order by version) to '/audit/db_migrations.csv' with (format csv, header true)
\endif

commit;
