-- P-1 non-game convergence migration for the core identity foreign keys.
--
-- RESTRICT / RESTRICT is the confirmed authoritative design for the
-- auth.users -> profiles -> teachers identity chain. A clean replay already
-- has this state from 20260810164324_core_auth.sql, while the audited
-- Production schema has the same two named constraints with ON DELETE
-- CASCADE. Only a missing or non-canonical constraint is replaced; an
-- already-final database performs no constraint DDL.

do $migration$
declare
  v_source_attnum pg_catalog.int2;
  v_target_attnum pg_catalog.int2;
  v_is_final boolean;
begin
  select attribute.attnum
  into strict v_source_attnum
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.profiles'::pg_catalog.regclass
    and attribute.attname = 'id'
    and not attribute.attisdropped;

  select attribute.attnum
  into strict v_target_attnum
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'auth.users'::pg_catalog.regclass
    and attribute.attname = 'id'
    and not attribute.attisdropped;

  select exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.profiles'::pg_catalog.regclass
      and constraint_row.conname = 'profiles_id_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'auth.users'::pg_catalog.regclass
      and constraint_row.conkey = array[v_source_attnum]::pg_catalog.int2[]
      and constraint_row.confkey = array[v_target_attnum]::pg_catalog.int2[]
      and constraint_row.confupdtype = 'a'
      and constraint_row.confdeltype = 'r'
      and constraint_row.confmatchtype = 's'
      and not constraint_row.condeferrable
      and not constraint_row.condeferred
      and constraint_row.convalidated
  ) into v_is_final;

  if not v_is_final then
    alter table public.profiles
      drop constraint if exists profiles_id_fkey;
    alter table public.profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users (id) on delete restrict;
  end if;
end
$migration$;

do $migration$
declare
  v_source_attnum pg_catalog.int2;
  v_target_attnum pg_catalog.int2;
  v_is_final boolean;
begin
  select attribute.attnum
  into strict v_source_attnum
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.teachers'::pg_catalog.regclass
    and attribute.attname = 'id'
    and not attribute.attisdropped;

  select attribute.attnum
  into strict v_target_attnum
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'public.profiles'::pg_catalog.regclass
    and attribute.attname = 'id'
    and not attribute.attisdropped;

  select exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.teachers'::pg_catalog.regclass
      and constraint_row.conname = 'teachers_id_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.profiles'::pg_catalog.regclass
      and constraint_row.conkey = array[v_source_attnum]::pg_catalog.int2[]
      and constraint_row.confkey = array[v_target_attnum]::pg_catalog.int2[]
      and constraint_row.confupdtype = 'a'
      and constraint_row.confdeltype = 'r'
      and constraint_row.confmatchtype = 's'
      and not constraint_row.condeferrable
      and not constraint_row.condeferred
      and constraint_row.convalidated
  ) into v_is_final;

  if not v_is_final then
    alter table public.teachers
      drop constraint if exists teachers_id_fkey;
    alter table public.teachers
      add constraint teachers_id_fkey
      foreign key (id) references public.profiles (id) on delete restrict;
  end if;
end
$migration$;
