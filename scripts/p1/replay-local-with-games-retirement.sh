#!/usr/bin/env bash

# Replay the local P-1 database around the immutable Games teardown migration.
# This helper is intentionally GitHub-Actions-only and accepts no database URL:
# both Supabase CLI operations target the already-running local stack, and the
# temporary role membership is created inside that stack's Docker container.

set -euo pipefail

readonly teardown_filename="20260910073101_retire_ningacademy_games.sql"
readonly predecessor_filename="20260901120000_restrict_authenticated_audit_log_inserts.sql"
readonly migrations_dir="supabase/migrations"
readonly teardown_path="$migrations_dir/$teardown_filename"
readonly predecessor_path="$migrations_dir/$predecessor_filename"

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${CI:-}" != "true" ]]; then
  printf 'Refusing to run: this helper is restricted to GitHub Actions local CI.\n' >&2
  exit 64
fi

if [[ ! -f "$teardown_path" ]]; then
  printf 'Required Games teardown migration is missing: %s\n' "$teardown_path" >&2
  exit 66
fi

if [[ ! -f "$predecessor_path" ]]; then
  printf 'Required pre-teardown migration is missing: %s\n' "$predecessor_path" >&2
  exit 66
fi

mapfile -t ordered_migrations < <(
  find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' \
    | LC_ALL=C sort
)
mapfile -t replay_suffix < <(
  printf '%s\n' "${ordered_migrations[@]}" \
    | awk -v teardown="$teardown_filename" '$0 >= teardown'
)
mapfile -t replay_prefix < <(
  printf '%s\n' "${ordered_migrations[@]}" \
    | awk -v teardown="$teardown_filename" '$0 < teardown'
)

if [[ "${replay_suffix[0]:-}" != "$teardown_filename" ]]; then
  printf 'Games teardown is not the first migration in the staged replay suffix.\n' >&2
  exit 65
fi

if [[ "${replay_prefix[-1]:-}" != "$predecessor_filename" ]]; then
  printf 'Expected %s immediately before the Games teardown.\n' \
    "$predecessor_filename" >&2
  exit 65
fi

staging_dir="$(mktemp -d)"

restore_replay_suffix() {
  local filename
  for filename in "${replay_suffix[@]}"; do
    if [[ -f "$staging_dir/$filename" && ! -e "$migrations_dir/$filename" ]]; then
      mv "$staging_dir/$filename" "$migrations_dir/$filename"
    fi
  done
  rm -rf -- "$staging_dir"
}
trap restore_replay_suffix EXIT

printf 'Replaying local migrations through %s with the Games teardown suffix staged.\n' \
  "$predecessor_filename"
for filename in "${replay_suffix[@]}"; do
  mv "$migrations_dir/$filename" "$staging_dir/$filename"
done
supabase db reset --local --no-seed --debug

mapfile -t db_containers < <(
  docker ps --filter status=running --format '{{.Names}}' \
    | grep '^supabase_db_' || true
)
if [[ "${#db_containers[@]}" -ne 1 ]]; then
  printf 'Expected exactly one running local Supabase database container; found %s.\n' \
    "${#db_containers[@]}" >&2
  exit 69
fi
readonly db_container="${db_containers[0]}"

printf 'Granting the temporary postgres -> game_api_owner SET-only membership in local CI.\n'
docker exec --interactive "$db_container" psql \
  --username postgres --dbname postgres --no-psqlrc --set ON_ERROR_STOP=1 <<'SQL'
do $precondition$
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception 'local replay membership must be created by postgres';
  end if;

  if pg_catalog.to_regrole('game_api_owner') is null then
    raise exception 'game_api_owner is missing before the Games teardown';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_auth_members membership
    where membership.member = pg_catalog.to_regrole('postgres')
      and membership.roleid = pg_catalog.to_regrole('game_api_owner')
  ) then
    raise exception 'postgres already has an unexpected game_api_owner membership';
  end if;
end
$precondition$;

grant game_api_owner to postgres
  with admin false, inherit false, set true;

do $postcondition$
begin
  if not exists (
    select 1
    from pg_catalog.pg_auth_members membership
    where membership.member = pg_catalog.to_regrole('postgres')
      and membership.roleid = pg_catalog.to_regrole('game_api_owner')
      and not membership.admin_option
      and not membership.inherit_option
      and membership.set_option
  ) then
    raise exception 'temporary postgres -> game_api_owner membership has unexpected options';
  end if;
end
$postcondition$;
SQL

restore_replay_suffix
printf 'Applying the restored Games teardown to the local CI database.\n'
supabase migration up --local --debug --yes

docker exec --interactive "$db_container" psql \
  --username postgres --dbname postgres --no-psqlrc --set ON_ERROR_STOP=1 <<'SQL'
do $post_teardown$
begin
  if pg_catalog.to_regrole('game_api_owner') is not null then
    raise exception 'game_api_owner survived the Games teardown';
  end if;
end
$post_teardown$;
SQL

printf 'Local split replay completed; the temporary membership was removed with game_api_owner.\n'
