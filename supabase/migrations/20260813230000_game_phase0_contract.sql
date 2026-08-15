-- NingAcademy Game P0: additive database contract for the smallest main-site
-- login -> one-time launch ticket -> authoritative room -> one question ->
-- idempotent settlement -> student/teacher result loop.
--
-- Security boundaries:
--   * public remains the only Data API schema used here.
--   * game and game_private are deliberately NOT exposed in config.toml.
--   * browser roles can issue a launch ticket and read only self/owned-student
--     reports through narrowly granted public RPCs.
--   * the authoritative server receives EXECUTE on a whitelist through the
--     NOLOGIN game_server group role; it receives no table privileges.
--   * correct answers, raw submitted answers, bearer-token hashes and
--     idempotency rows live only in game_private.
--   * no Supabase JWT is accepted by any game-server RPC. The only identity
--     path starts with issue_game_launch_ticket_v1() under auth.uid().

-- ============================================================================
-- Roles and unexposed schemas
-- ============================================================================

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'game_api_owner') then
    create role game_api_owner nologin noinherit nobypassrls;
  else
    alter role game_api_owner nologin noinherit nobypassrls;
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'game_server') then
    create role game_server nologin noinherit nobypassrls;
  else
    alter role game_server nologin noinherit nobypassrls;
  end if;

  -- ALTER ... OWNER requires the migration executor to be able to SET ROLE
  -- to the new owner on non-superuser hosted Postgres. This membership is
  -- temporary and is revoked at the end of the migration.
  execute pg_catalog.format('grant game_api_owner to %I', current_user);
end
$roles$;

create schema if not exists game authorization game_api_owner;
create schema if not exists game_private authorization game_api_owner;

revoke all on schema game from public, anon, authenticated, service_role;
revoke all on schema game_private from public, anon, authenticated, service_role;
grant usage on schema game to game_server;

comment on schema game is
  'Unexposed game-domain schema. No browser table access and no high-frequency tick/position storage.';
comment on schema game_private is
  'Unexposed secrets/personal-payload schema: correct answers, raw answers, token hashes and idempotency records.';

-- ============================================================================
-- Existing assignment integration: one canonical parent, one game config
-- ============================================================================

alter table public.assignments
  add column assignment_kind text not null default 'plain';

alter table public.assignments
  add constraint assignments_assignment_kind_valid
  check (assignment_kind in ('plain', 'game'));

comment on column public.assignments.assignment_kind is
  'Dispatch discriminator. Existing rows/default creation remain plain; a game row must have exactly one game_assignment_configs row.';

create table public.game_assignment_configs (
  assignment_id uuid primary key references public.assignments (id) on delete restrict,
  allowed_modes text[] not null default array['pve']::text[],
  map_key text not null default 'house',
  learning_difficulty text not null default 'standard',
  minimum_day integer not null default 3,
  minimum_learning_questions integer not null default 5,
  minimum_accuracy numeric(5,2) not null default 60,
  screen_shake_max smallint not null default 100,
  hit_stop_allowed boolean not null default true,
  flash_intensity text not null default 'normal',
  shard_intensity text not null default 'normal',
  screamer_distortion_allowed boolean not null default true,
  slow_motion_allowed boolean not null default true,
  camera_bob_allowed boolean not null default false,
  motion_blur_allowed boolean not null default false,
  timing_multiplier numeric(3,1) not null default 1.0,
  ruleset_version text not null,
  content_release_id text not null,
  retention_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_assignment_configs_modes_valid check (
    cardinality(allowed_modes) between 1 and 3
    and allowed_modes <@ array['pve', 'coop', 'asymmetric']::text[]
  ),
  constraint game_assignment_configs_map_valid check (map_key in ('house', 'grass', 'desert', 'hell')),
  constraint game_assignment_configs_learning_difficulty_valid check (
    learning_difficulty in ('easy', 'standard', 'hard')
  ),
  constraint game_assignment_configs_minimum_day_range check (minimum_day between 1 and 200),
  constraint game_assignment_configs_minimum_questions_range check (minimum_learning_questions between 1 and 500),
  constraint game_assignment_configs_minimum_accuracy_range check (minimum_accuracy between 0 and 100),
  constraint game_assignment_configs_screen_shake_range check (screen_shake_max between 0 and 100),
  constraint game_assignment_configs_flash_valid check (flash_intensity in ('off', 'reduced', 'normal')),
  constraint game_assignment_configs_shards_valid check (shard_intensity in ('off', 'reduced', 'normal')),
  constraint game_assignment_configs_timing_multiplier_valid check (timing_multiplier in (1.0, 1.5, 2.0)),
  constraint game_assignment_configs_ruleset_format check (
    ruleset_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  ),
  constraint game_assignment_configs_content_release_format check (
    content_release_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
  ),
  constraint game_assignment_configs_retention_window check (
    retention_until > created_at and retention_until <= created_at + interval '400 days'
  )
);

comment on table public.game_assignment_configs is
  'One-to-one configuration for assignments.assignment_kind=game. Visual safety fields are explicit teacher caps; student settings may only reduce them.';
comment on column public.game_assignment_configs.retention_until is
  'Explicit personal-data deletion boundary (normally academic-term end plus export grace), copied to each game attempt.';

create trigger game_assignment_configs_set_updated_at
before update on public.game_assignment_configs
for each row execute function public.set_updated_at();

create table public.game_assignment_accommodations (
  assignment_id uuid not null references public.game_assignment_configs (assignment_id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  timing_mode text not null default 'standard',
  timing_multiplier numeric(3,1) not null default 1.0,
  flash_intensity text not null default 'normal',
  screen_shake_max smallint not null default 100,
  screamer_distortion_allowed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (assignment_id, student_id),
  constraint game_assignment_accommodations_timing_mode_valid check (
    timing_mode in ('standard', 'extended', 'untimed')
  ),
  constraint game_assignment_accommodations_timing_multiplier_valid check (
    (timing_mode = 'standard' and timing_multiplier = 1.0)
    or (timing_mode = 'extended' and timing_multiplier in (1.5, 2.0, 3.0))
    or (timing_mode = 'untimed' and timing_multiplier = 1.0)
  ),
  constraint game_assignment_accommodations_flash_valid check (
    flash_intensity in ('off', 'reduced', 'normal')
  ),
  constraint game_assignment_accommodations_screen_shake_range check (
    screen_shake_max between 0 and 100
  )
);

comment on table public.game_assignment_accommodations is
  'Per-student teacher accommodation. It overrides host choices and may only reduce motion/flash or extend/remove answer timing.';

create trigger game_assignment_accommodations_set_updated_at
before update on public.game_assignment_accommodations
for each row execute function public.set_updated_at();

create table public.game_assignment_vocabulary_sources (
  assignment_id uuid not null references public.game_assignment_configs (assignment_id) on delete restrict,
  vocabulary_set_id uuid not null references public.vocabulary_sets (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (assignment_id, vocabulary_set_id)
);

comment on table public.game_assignment_vocabulary_sources is
  'Teacher-selected structured vocabulary sources for a game assignment. The game server never chooses arbitrary prompts or answers and has no table privilege here.';

alter table public.game_assignment_configs enable row level security;
alter table public.game_assignment_accommodations enable row level security;
alter table public.game_assignment_vocabulary_sources enable row level security;

create policy "game_assignment_configs_select_via_assignment"
on public.game_assignment_configs
for select
to authenticated
using (private.is_ready_profile() and private.can_view_assignment(assignment_id));

create policy "game_assignment_accommodations_select_owned_or_self"
on public.game_assignment_accommodations
for select
to authenticated
using (
  private.is_ready_profile()
  and private.can_view_assignment(assignment_id)
  and (
    student_id = private.current_student_id()
    or private.teacher_owns_student(student_id)
  )
);

grant select on public.game_assignment_configs to authenticated;
grant select on public.game_assignment_accommodations to authenticated;

-- ============================================================================
-- Game-domain tables (no direct grants to browser or runtime roles)
-- ============================================================================

create table game.game_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id text not null unique,
  host_user_id uuid references public.profiles (id) on delete restrict,
  mode text not null check (mode in ('pve', 'coop', 'asymmetric')),
  map_key text not null check (map_key in ('house', 'grass', 'desert', 'hell')),
  status text not null default 'active' check (status in ('active', 'completed', 'terminated', 'expired')),
  protocol_version text not null,
  simulation_version text not null,
  ruleset_version text not null,
  content_release_id text not null,
  region text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_checkpoint_at timestamptz,
  checkpoint_sequence integer not null default 0 check (checkpoint_sequence >= 0),
  termination_reason text,
  retention_until timestamptz not null default (now() + interval '30 days'),
  archived_at timestamptz,
  personal_data_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint game_sessions_room_id_format check (room_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  constraint game_sessions_version_fields check (
    protocol_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    and simulation_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    and ruleset_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    and content_release_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
  ),
  constraint game_sessions_region_format check (region ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  constraint game_sessions_end_state check (
    (status = 'active' and ended_at is null) or (status <> 'active' and ended_at is not null)
  )
);

create index game_sessions_status_idx on game.game_sessions (status, started_at);
create index game_sessions_retention_idx on game.game_sessions (retention_until)
  where personal_data_deleted_at is null;

create table game.session_players (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references game.game_sessions (id) on delete restrict,
  user_id uuid references public.profiles (id) on delete restrict,
  anonymous_subject_id uuid not null default gen_random_uuid(),
  player_side text not null check (player_side in ('survivor', 'zombie', 'spectator')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  disconnect_reason text,
  created_at timestamptz not null default now()
);

create unique index session_players_one_identity_per_session
  on game.session_players (game_session_id, user_id)
  where user_id is not null;
create index session_players_user_id_idx on game.session_players (user_id)
  where user_id is not null;

create table game.game_attempts (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references game.game_sessions (id) on delete restrict,
  session_player_id uuid not null unique references game.session_players (id) on delete restrict,
  user_id uuid references public.profiles (id) on delete restrict,
  assignment_id uuid references public.assignments (id) on delete restrict,
  queue text not null check (queue in ('solo_survivor', 'coop_survivor', 'zombie')),
  status text not null default 'in_progress' check (
    status in ('in_progress', 'completed', 'abandoned', 'no_contest', 'terminated')
  ),
  outcome text check (outcome is null or outcome in ('win', 'loss', 'no_contest', 'terminated')),
  max_day integer not null default 0 check (max_day between 0 and 10000),
  equivalent_day integer not null default 0 check (equivalent_day between 0 and 10000),
  verified_win boolean not null default false,
  rank_eligible boolean not null default false,
  official_question_count integer not null default 0 check (official_question_count >= 0),
  official_correct_count integer not null default 0 check (
    official_correct_count >= 0 and official_correct_count <= official_question_count
  ),
  assignment_question_count integer not null default 0 check (assignment_question_count >= 0),
  assignment_correct_count integer not null default 0 check (
    assignment_correct_count >= 0 and assignment_correct_count <= assignment_question_count
  ),
  assignment_completed boolean not null default false,
  finalization_request_id uuid unique,
  finalization_input_hash bytea,
  result_detail jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  retention_until timestamptz not null,
  archived_at timestamptz,
  personal_data_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint game_attempts_result_detail_object check (
    jsonb_typeof(result_detail) = 'object'
    and pg_column_size(result_detail) <= 16384
    and not (
      result_detail ? 'correct_answers' or result_detail ? 'correctAnswer'
      or result_detail ? 'submitted_answer' or result_detail ? 'rawAnswer'
      or result_detail ? 'token' or result_detail ? 'secret'
    )
  ),
  constraint game_attempts_status_completion check (
    (status = 'in_progress' and completed_at is null and outcome is null)
    or (status <> 'in_progress' and completed_at is not null and outcome is not null)
  ),
  constraint game_attempts_verified_win_valid check (
    not verified_win or (queue = 'zombie' and outcome = 'win' and rank_eligible)
  ),
  constraint game_attempts_finalization_hash_state check (
    (finalization_request_id is null and finalization_input_hash is null)
    or (finalization_request_id is not null and octet_length(finalization_input_hash) = 32)
  )
);

create index game_attempts_user_queue_completed_idx
  on game.game_attempts (user_id, queue, completed_at desc)
  where user_id is not null and completed_at is not null;
create index game_attempts_assignment_user_idx
  on game.game_attempts (assignment_id, user_id, completed_at desc)
  where assignment_id is not null and user_id is not null;
create index game_attempts_retention_idx
  on game.game_attempts (retention_until)
  where personal_data_deleted_at is null;

create table game_private.question_instances (
  id uuid primary key default gen_random_uuid(),
  issue_request_id uuid not null unique,
  issue_input_hash bytea not null,
  game_attempt_id uuid not null references game.game_attempts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  question_type text not null check (question_type in ('en_to_zh', 'zh_to_en', 'listening_spelling', 'math')),
  question_purpose text not null check (question_purpose in ('card', 'rescue', 'unlock', 'review', 'custom')),
  source_kind text not null check (source_kind in ('official', 'assignment', 'custom')),
  difficulty text not null check (difficulty in ('unscored', 'easy', 'standard', 'hard')),
  question_tier smallint not null check (question_tier between 0 and 20),
  answer_mode text not null check (answer_mode in ('standard', 'text_alternative')),
  prompt_payload jsonb not null,
  grading_mode text not null check (grading_mode in ('normalized_text', 'case_sensitive', 'numeric', 'choice')),
  correct_answers text[] not null,
  explanation text not null default '',
  timed boolean not null,
  timeout_ms integer,
  counts_for_rank boolean not null,
  counts_for_assignment boolean not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  pool_item_id uuid,
  source_set_id uuid references public.vocabulary_sets (id) on delete restrict,
  source_word_id uuid references public.vocabulary_words (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint question_instances_prompt_object check (
    jsonb_typeof(prompt_payload) = 'object' and pg_column_size(prompt_payload) <= 16384
  ),
  constraint question_instances_issue_hash_length check (octet_length(issue_input_hash) = 32),
  constraint question_instances_answers_valid check (
    cardinality(correct_answers) between 1 and 16
    and array_position(correct_answers, null) is null
  ),
  constraint question_instances_explanation_length check (char_length(explanation) <= 2000),
  constraint question_instances_timing_valid check (
    (timed and timeout_ms between 1000 and 300000 and expires_at is not null)
    or (not timed and timeout_ms is null and expires_at is null)
  ),
  constraint question_instances_rank_scope check (
    not counts_for_rank
    or (
      timed and question_purpose = 'card' and source_kind = 'official'
      and answer_mode = 'standard'
    )
  ),
  constraint question_instances_assignment_scope check (
    not counts_for_assignment
    or (
      question_purpose = 'card' and source_kind in ('official', 'assignment')
      and answer_mode = 'standard'
    )
  ),
  constraint question_instances_text_alternative_scope check (
    answer_mode <> 'text_alternative' or (not counts_for_rank and not counts_for_assignment)
  )
);

create index question_instances_attempt_issued_idx
  on game_private.question_instances (game_attempt_id, issued_at);

create table game.learning_attempts (
  id uuid primary key default gen_random_uuid(),
  game_attempt_id uuid not null references game.game_attempts (id) on delete cascade,
  question_instance_id uuid not null unique references game_private.question_instances (id) on delete cascade,
  question_type text not null,
  question_purpose text not null,
  source_kind text not null,
  difficulty text not null,
  question_tier smallint not null,
  answer_mode text not null,
  source_set_id uuid references public.vocabulary_sets (id) on delete restrict,
  source_word_id uuid references public.vocabulary_words (id) on delete restrict,
  is_correct boolean not null,
  timed_out boolean not null default false,
  response_ms integer check (response_ms is null or response_ms >= 0),
  counts_for_rank boolean not null,
  counts_for_assignment boolean not null,
  causally_voided boolean not null default false,
  causal_void_reason text,
  answered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint learning_attempts_void_reason check (
    (causally_voided and causal_void_reason is not null and char_length(causal_void_reason) <= 200)
    or (not causally_voided and causal_void_reason is null)
  )
);

create index learning_attempts_game_attempt_idx
  on game.learning_attempts (game_attempt_id, answered_at);
create index learning_attempts_rank_window_idx
  on game.learning_attempts (answered_at desc)
  where counts_for_rank and not causally_voided;

create table game_private.learning_answer_payloads (
  learning_attempt_id uuid primary key references game.learning_attempts (id) on delete cascade,
  submitted_answer text,
  submitted_answer_hash bytea not null,
  created_at timestamptz not null default now(),
  constraint learning_answer_payloads_answer_length check (
    submitted_answer is null or char_length(submitted_answer) <= 1000
  ),
  constraint learning_answer_payloads_hash_length check (octet_length(submitted_answer_hash) = 32)
);

create table game_private.answer_requests (
  request_id uuid primary key,
  question_instance_id uuid not null references game_private.question_instances (id) on delete cascade,
  learning_attempt_id uuid not null references game.learning_attempts (id) on delete cascade,
  submitted_answer_hash bytea not null,
  created_at timestamptz not null default now(),
  constraint answer_requests_hash_length check (octet_length(submitted_answer_hash) = 32)
);

create index answer_requests_learning_attempt_idx
  on game_private.answer_requests (learning_attempt_id);

create table game.personal_rank_snapshots (
  user_id uuid not null references public.profiles (id) on delete restrict,
  queue text not null check (queue in ('solo_survivor', 'coop_survivor', 'zombie')),
  tier text not null check (tier in ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'mythic')),
  placement_status text not null check (placement_status in ('calibrating', 'placed')),
  official_accuracy numeric(5,2),
  sample_size integer not null default 0 check (sample_size between 0 and 70),
  highest_equivalent_day integer not null default 0 check (highest_equivalent_day >= 0),
  verified_wins integer not null default 0 check (verified_wins >= 0),
  ruleset_version text not null,
  updated_at timestamptz not null default now(),
  retention_until timestamptz not null,
  primary key (user_id, queue),
  constraint personal_rank_accuracy_range check (official_accuracy is null or official_accuracy between 0 and 100)
);

comment on table game.personal_rank_snapshots is
  'One personal snapshot per user/queue. It is intentionally never directly queryable and has no cross-user/global leaderboard RPC.';

create table game.personal_rank_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete restrict,
  anonymous_subject_id uuid not null default gen_random_uuid(),
  queue text not null check (queue in ('solo_survivor', 'coop_survivor', 'zombie')),
  previous_tier text check (previous_tier is null or previous_tier in ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'mythic')),
  new_tier text not null check (new_tier in ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'mythic')),
  placement_status text not null check (placement_status in ('calibrating', 'placed')),
  official_accuracy numeric(5,2),
  sample_size integer not null check (sample_size between 0 and 70),
  highest_equivalent_day integer not null check (highest_equivalent_day >= 0),
  verified_wins integer not null check (verified_wins >= 0),
  source_game_attempt_id uuid references game.game_attempts (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 100),
  ruleset_version text not null,
  retention_until timestamptz not null,
  personal_data_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint personal_rank_history_accuracy_range check (
    official_accuracy is null or official_accuracy between 0 and 100
  )
);

create index personal_rank_history_user_queue_idx
  on game.personal_rank_history (user_id, queue, created_at desc)
  where user_id is not null;
create index personal_rank_history_retention_idx
  on game.personal_rank_history (retention_until)
  where personal_data_deleted_at is null;

create table game.domain_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  game_session_id uuid not null references game.game_sessions (id) on delete cascade,
  game_attempt_id uuid references game.game_attempts (id) on delete set null,
  actor_user_id uuid references public.profiles (id) on delete restrict,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (game_session_id, event_id),
  constraint domain_events_type_format check (
    event_type ~ '^[a-z][a-z0-9_]{1,63}$'
    and event_type !~ '(^|_)(tick|position|transform|input|snapshot|projectile)(_|$)'
  ),
  constraint domain_events_payload_object check (
    jsonb_typeof(payload) = 'object'
    and pg_column_size(payload) <= 16384
    and not (
      payload ? 'correct_answers' or payload ? 'correctAnswer'
      or payload ? 'submitted_answer' or payload ? 'rawAnswer'
      or payload ? 'token' or payload ? 'secret'
    )
  )
);

comment on table game.domain_events is
  'Low-rate domain events only. Simulation ticks, positions, transforms, raw input, projectiles and high-frequency firing telemetry are forbidden.';

create index domain_events_session_time_idx
  on game.domain_events (game_session_id, occurred_at);

-- ============================================================================
-- Private identity/session and cleanup tables
-- ============================================================================

create table game_private.launch_tickets (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  user_id uuid not null references public.profiles (id) on delete restrict,
  assignment_id uuid references public.assignments (id) on delete restrict,
  request_id uuid not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  exchange_request_id uuid,
  created_at timestamptz not null default now(),
  constraint launch_tickets_hash_length check (octet_length(token_hash) = 32),
  constraint launch_tickets_expiry_window check (
    expires_at > created_at and expires_at <= created_at + interval '60 seconds'
  ),
  constraint launch_tickets_revoke_reason check (
    (revoked_at is null and revoke_reason is null)
    or (revoked_at is not null and revoke_reason is not null and char_length(revoke_reason) <= 100)
  ),
  constraint launch_tickets_exchange_state check (
    (used_at is null and exchange_request_id is null)
    or (used_at is not null and exchange_request_id is not null)
  )
);

create index launch_tickets_user_active_idx
  on game_private.launch_tickets (user_id, expires_at)
  where used_at is null and revoked_at is null;

create table game_private.game_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  launch_ticket_id uuid not null unique references game_private.launch_tickets (id) on delete restrict,
  session_token_hash bytea not null unique,
  user_id uuid not null references public.profiles (id) on delete restrict,
  assignment_id uuid references public.assignments (id) on delete restrict,
  active_game_session_id uuid references game.game_sessions (id) on delete set null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_validated_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  constraint game_auth_sessions_hash_length check (octet_length(session_token_hash) = 32),
  constraint game_auth_sessions_expiry_window check (
    expires_at > issued_at and expires_at <= issued_at + interval '5 hours'
  ),
  constraint game_auth_sessions_revoke_reason check (
    (revoked_at is null and revoke_reason is null)
    or (revoked_at is not null and revoke_reason is not null and char_length(revoke_reason) <= 100)
  )
);

create index game_auth_sessions_user_active_idx
  on game_private.game_auth_sessions (user_id, expires_at)
  where revoked_at is null;

alter table game.session_players
  add column game_auth_session_id uuid
  references game_private.game_auth_sessions (id) on delete set null;

create unique index session_players_auth_session_room_idx
  on game.session_players (game_session_id, game_auth_session_id)
  where game_auth_session_id is not null;

create table game_private.rpc_requests (
  actor_user_id uuid not null references public.profiles (id) on delete restrict,
  rpc_name text not null,
  request_id uuid not null,
  input_hash bytea not null,
  result_payload jsonb,
  retention_until timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_user_id, rpc_name, request_id),
  constraint rpc_requests_name_format check (rpc_name ~ '^[a-z][a-z0-9_.]{2,63}$'),
  constraint rpc_requests_hash_length check (octet_length(input_hash) = 32),
  constraint rpc_requests_result_state check (
    (result_payload is null and completed_at is null)
    or (result_payload is not null and jsonb_typeof(result_payload) = 'object' and completed_at is not null)
  )
);

create index rpc_requests_retention_idx on game_private.rpc_requests (retention_until);

create table game_private.question_pool_snapshots (
  id uuid primary key default gen_random_uuid(),
  game_attempt_id uuid not null references game.game_attempts (id) on delete cascade,
  source_set_id uuid not null references public.vocabulary_sets (id) on delete restrict,
  source_engine_version text not null,
  content_hash bytea not null,
  retention_until timestamptz not null,
  created_at timestamptz not null default now(),
  unique (game_attempt_id, source_set_id),
  constraint question_pool_snapshots_hash_length check (octet_length(content_hash) = 32)
);

create table game_private.question_pool_items (
  id uuid primary key default gen_random_uuid(),
  pool_snapshot_id uuid not null references game_private.question_pool_snapshots (id) on delete cascade,
  source_word_id uuid not null references public.vocabulary_words (id) on delete restrict,
  term text not null,
  meaning text not null,
  accepted_terms text[] not null,
  accepted_meanings text[] not null,
  image_url text,
  source_sort_order integer not null,
  created_at timestamptz not null default now(),
  unique (pool_snapshot_id, source_word_id),
  constraint question_pool_items_term_valid check (btrim(term) <> '' and char_length(term) <= 100),
  constraint question_pool_items_meaning_valid check (btrim(meaning) <> '' and char_length(meaning) <= 500),
  constraint question_pool_items_image_valid check (
    image_url is null or (char_length(image_url) <= 2048 and image_url ~ '^https://')
  )
);

alter table game_private.question_instances
  add constraint question_instances_pool_item_fk
  foreign key (pool_item_id) references game_private.question_pool_items (id) on delete restrict;

create table game_private.question_exposures (
  user_id uuid not null references public.profiles (id) on delete restrict,
  source_set_id uuid not null references public.vocabulary_sets (id) on delete restrict,
  source_word_id uuid not null references public.vocabulary_words (id) on delete restrict,
  question_type text not null check (question_type in ('en_to_zh', 'zh_to_en')),
  exposure_count integer not null default 0 check (exposure_count >= 0),
  last_exposed_at timestamptz,
  last_correct_at timestamptz,
  next_eligible_at timestamptz not null default now(),
  retention_until timestamptz not null,
  primary key (user_id, source_set_id, source_word_id, question_type)
);

create index question_exposures_next_idx
  on game_private.question_exposures (user_id, next_eligible_at);

create table game.session_checkpoints (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references game.game_sessions (id) on delete cascade,
  request_id uuid not null,
  input_hash bytea not null,
  checkpoint_sequence integer not null check (checkpoint_sequence > 0),
  day_number integer not null check (day_number between 1 and 10000),
  phase text not null check (phase in ('day_start', 'combat', 'boss_pending', 'boss', 'rescue_pending', 'transition')),
  state_payload jsonb not null,
  ruleset_version text not null,
  created_at timestamptz not null default now(),
  unique (game_session_id, request_id),
  unique (game_session_id, checkpoint_sequence),
  constraint session_checkpoints_hash_length check (octet_length(input_hash) = 32),
  constraint session_checkpoints_payload_size check (
    jsonb_typeof(state_payload) = 'object' and pg_column_size(state_payload) <= 262144
  )
);

create table game_private.correction_requests (
  game_attempt_id uuid not null references game.game_attempts (id) on delete cascade,
  request_id uuid not null,
  input_hash bytea not null,
  learning_attempt_id uuid not null references game.learning_attempts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_attempt_id, request_id),
  constraint correction_requests_hash_length check (octet_length(input_hash) = 32)
);

-- ============================================================================
-- Ownership and RLS: enabled everywhere, direct access nowhere
-- ============================================================================

-- ALTER ... OWNER also requires the prospective owner to have CREATE on the
-- object's containing schema. Keep CREATE only for this migration's ownership
-- transfers; the final privilege block revokes it again.
grant usage, create on schema public to game_api_owner;

alter table public.game_assignment_configs owner to game_api_owner;
alter table public.game_assignment_accommodations owner to game_api_owner;
alter table public.game_assignment_vocabulary_sources owner to game_api_owner;
alter table game.game_sessions owner to game_api_owner;
alter table game.session_players owner to game_api_owner;
alter table game.game_attempts owner to game_api_owner;
alter table game.learning_attempts owner to game_api_owner;
alter table game.personal_rank_snapshots owner to game_api_owner;
alter table game.personal_rank_history owner to game_api_owner;
alter table game.domain_events owner to game_api_owner;
alter table game.session_checkpoints owner to game_api_owner;
alter table game_private.question_instances owner to game_api_owner;
alter table game_private.learning_answer_payloads owner to game_api_owner;
alter table game_private.answer_requests owner to game_api_owner;
alter table game_private.launch_tickets owner to game_api_owner;
alter table game_private.game_auth_sessions owner to game_api_owner;
alter table game_private.rpc_requests owner to game_api_owner;
alter table game_private.question_pool_snapshots owner to game_api_owner;
alter table game_private.question_pool_items owner to game_api_owner;
alter table game_private.question_exposures owner to game_api_owner;
alter table game_private.correction_requests owner to game_api_owner;

alter table game.game_sessions enable row level security;
alter table game.session_players enable row level security;
alter table game.game_attempts enable row level security;
alter table game.learning_attempts enable row level security;
alter table game.personal_rank_snapshots enable row level security;
alter table game.personal_rank_history enable row level security;
alter table game.domain_events enable row level security;
alter table game.session_checkpoints enable row level security;
alter table game_private.question_instances enable row level security;
alter table game_private.learning_answer_payloads enable row level security;
alter table game_private.answer_requests enable row level security;
alter table game_private.launch_tickets enable row level security;
alter table game_private.game_auth_sessions enable row level security;
alter table game_private.rpc_requests enable row level security;
alter table game_private.question_pool_snapshots enable row level security;
alter table game_private.question_pool_items enable row level security;
alter table game_private.question_exposures enable row level security;
alter table game_private.correction_requests enable row level security;

revoke all on all tables in schema game from public, anon, authenticated, service_role, game_server;
revoke all on all tables in schema game_private from public, anon, authenticated, service_role, game_server;

-- game_api_owner is NOLOGIN and is used only as a controlled SECURITY
-- DEFINER owner. These policies let its functions inspect the existing
-- public identity/assignment graph without making that graph public.
grant usage on schema auth, private to game_api_owner;
grant execute on function auth.uid() to game_api_owner;
grant execute on function private.is_ready_profile() to game_api_owner;
grant select on public.profiles, public.teachers, public.students,
  public.classes, public.enrollments, public.assignments, public.assignment_targets,
  public.game_assignment_accommodations, public.vocabulary_sets,
  public.vocabulary_targets, public.vocabulary_words,
  public.vocabulary_word_alt_meanings, public.vocabulary_word_alt_terms,
  public.game_assignment_vocabulary_sources
  to game_api_owner;
grant insert on public.assignments, public.assignment_targets, public.audit_log to game_api_owner;

create policy "profiles_game_api_owner_select"
on public.profiles for select to game_api_owner using (true);
create policy "teachers_game_api_owner_select"
on public.teachers for select to game_api_owner using (true);
create policy "students_game_api_owner_select"
on public.students for select to game_api_owner using (true);
create policy "classes_game_api_owner_select"
on public.classes for select to game_api_owner using (true);
create policy "enrollments_game_api_owner_select"
on public.enrollments for select to game_api_owner using (true);
create policy "assignments_game_api_owner_select"
on public.assignments for select to game_api_owner using (true);
create policy "assignments_game_api_owner_insert"
on public.assignments for insert to game_api_owner with check (true);
create policy "assignment_targets_game_api_owner_select"
on public.assignment_targets for select to game_api_owner using (true);
create policy "assignment_targets_game_api_owner_insert"
on public.assignment_targets for insert to game_api_owner with check (true);
create policy "audit_log_game_api_owner_insert"
on public.audit_log for insert to game_api_owner with check (true);

create policy "game_assignment_accommodations_game_api_owner_select"
on public.game_assignment_accommodations for select to game_api_owner using (true);

create policy "vocabulary_sets_game_api_owner_select"
on public.vocabulary_sets for select to game_api_owner using (true);
create policy "vocabulary_targets_game_api_owner_select"
on public.vocabulary_targets for select to game_api_owner using (true);
create policy "vocabulary_words_game_api_owner_select"
on public.vocabulary_words for select to game_api_owner using (true);
create policy "vocabulary_word_alt_meanings_game_api_owner_select"
on public.vocabulary_word_alt_meanings for select to game_api_owner using (true);
create policy "vocabulary_word_alt_terms_game_api_owner_select"
on public.vocabulary_word_alt_terms for select to game_api_owner using (true);

-- ============================================================================
-- Private helpers and cross-table invariants
-- ============================================================================

create function game_private.sha256_text(p_value text)
returns bytea
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.sha256(pg_catalog.convert_to(p_value, 'UTF8'))
$$;

create function game_private.base64url(p_value bytea)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.rtrim(
    pg_catalog.translate(pg_catalog.encode(p_value, 'base64'), '+/', '-_'),
    '='
  )
$$;

create function game_private.normalize_answer(p_grading_mode text, p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    when p_grading_mode = 'case_sensitive' then pg_catalog.btrim(p_value)
    when p_grading_mode = 'numeric' then pg_catalog.regexp_replace(pg_catalog.btrim(p_value), '[[:space:]]+', '', 'g')
    else pg_catalog.lower(
      pg_catalog.regexp_replace(pg_catalog.btrim(p_value), '[[:space:]]+', ' ', 'g')
    )
  end
$$;

create function game_private.valid_correct_answers(p_answers text[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_answer text;
begin
  if p_answers is null or pg_catalog.cardinality(p_answers) not between 1 and 16 then
    return false;
  end if;

  foreach v_answer in array p_answers
  loop
    if v_answer is null
       or pg_catalog.btrim(v_answer) = ''
       or pg_catalog.char_length(v_answer) > 500 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create function game_private.jsonb_has_sensitive_key(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_child jsonb;
  v_normalized_key text;
begin
  if p_value is null then
    return false;
  elsif pg_catalog.jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from pg_catalog.jsonb_each(p_value)
    loop
      v_normalized_key := pg_catalog.lower(pg_catalog.regexp_replace(v_key, '[^a-zA-Z0-9]', '', 'g'));
      if v_normalized_key in (
        'answer', 'answers', 'correctanswer', 'correctanswers',
        'submittedanswer', 'rawanswer', 'token', 'secret', 'password', 'key'
      ) or game_private.jsonb_has_sensitive_key(v_child) then
        return true;
      end if;
    end loop;
  elsif pg_catalog.jsonb_typeof(p_value) = 'array' then
    for v_child in select value from pg_catalog.jsonb_array_elements(p_value)
    loop
      if game_private.jsonb_has_sensitive_key(v_child) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create function game_private.valid_safe_prompt(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if p_value is null
     or pg_catalog.jsonb_typeof(p_value) <> 'object'
     or game_private.jsonb_has_sensitive_key(p_value)
     or not (p_value ? 'kind')
     or not (p_value ? 'text')
     or p_value ->> 'kind' not in ('en_to_zh', 'zh_to_en')
     or pg_catalog.btrim(p_value ->> 'text') = ''
     or pg_catalog.char_length(p_value ->> 'text') > 500 then
    return false;
  end if;

  for v_key, v_child in select key, value from pg_catalog.jsonb_each(p_value)
  loop
    if v_key not in ('kind', 'text', 'imageUrl')
       or (v_key in ('kind', 'text') and pg_catalog.jsonb_typeof(v_child) <> 'string')
       or (v_key = 'imageUrl' and pg_catalog.jsonb_typeof(v_child) not in ('string', 'null')) then
      return false;
    end if;
  end loop;

  return not (p_value ? 'imageUrl')
    or p_value ->> 'imageUrl' is null
    or (
      pg_catalog.char_length(p_value ->> 'imageUrl') <= 2048
      and p_value ->> 'imageUrl' ~ '^https://'
    );
end;
$$;

create function game_private.valid_result_detail(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if p_value is null
     or pg_catalog.jsonb_typeof(p_value) <> 'object'
     or game_private.jsonb_has_sensitive_key(p_value) then
    return false;
  end if;

  for v_key, v_child in select key, value from pg_catalog.jsonb_each(p_value)
  loop
    if v_key not in (
      'kills', 'assists', 'revives', 'rescues', 'healing', 'damageDealt',
      'damageTaken', 'objectiveScore', 'downs', 'disconnects',
      'bossDefeated', 'convertedToPve'
    ) or pg_catalog.jsonb_typeof(v_child) not in ('number', 'boolean') then
      return false;
    end if;
  end loop;

  return pg_column_size(p_value) <= 16384;
end;
$$;

create function game_private.valid_domain_event_payload(p_event_type text, p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if p_event_type not in (
    'day_started', 'boss_started', 'boss_defeated', 'player_downed',
    'player_revived', 'mode_converted_to_pve', 'watchdog_forced_transition',
    'admin_terminated', 'checkpoint_saved'
  ) or p_value is null
     or pg_catalog.jsonb_typeof(p_value) <> 'object'
     or game_private.jsonb_has_sensitive_key(p_value) then
    return false;
  end if;

  for v_key, v_child in select key, value from pg_catalog.jsonb_each(p_value)
  loop
    if v_key not in ('day', 'reason', 'fromMode', 'toMode', 'bossVariant', 'phase')
       or pg_catalog.jsonb_typeof(v_child) not in ('string', 'number', 'boolean', 'null') then
      return false;
    end if;
  end loop;

  return pg_column_size(p_value) <= 16384;
end;
$$;

alter table game_private.question_instances
  add constraint question_instances_answers_trimmed
  check (game_private.valid_correct_answers(correct_answers));

alter table game_private.question_instances
  add constraint question_instances_safe_prompt
  check (game_private.valid_safe_prompt(prompt_payload));

alter table game_private.question_pool_items
  add constraint question_pool_items_accepted_terms_valid
  check (game_private.valid_correct_answers(accepted_terms));

alter table game_private.question_pool_items
  add constraint question_pool_items_accepted_meanings_valid
  check (game_private.valid_correct_answers(accepted_meanings));

alter table game.game_attempts
  add constraint game_attempts_result_detail_strict
  check (game_private.valid_result_detail(result_detail));

alter table game.domain_events
  add constraint domain_events_payload_strict
  check (game_private.valid_domain_event_payload(event_type, payload));

create function game_private.user_can_access_game_assignment(
  p_user_id uuid,
  p_assignment_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.assignments a on a.id = p_assignment_id
    join public.game_assignment_configs c on c.assignment_id = a.id
    where p.id = p_user_id
      and p.is_active
      and not p.must_change_password
      and a.assignment_kind = 'game'
      and a.published_at is not null
      and a.archived_at is null
      and c.retention_until > pg_catalog.now()
      and (
        a.teacher_id = p_user_id
        or (
          exists (
            select 1 from public.students owning_student
            where owning_student.id = p_user_id
              and owning_student.teacher_id = a.teacher_id
          )
          and exists (
          select 1
          from public.assignment_targets at
          where at.assignment_id = a.id
            and at.revoked_at is null
            and (
              at.student_id = p_user_id
              or exists (
                select 1
                from public.enrollments e
                where e.class_id = at.class_id
                  and e.student_id = p_user_id
                  and e.unenrolled_at is null
              )
            )
          )
        )
      )
  )
$$;

create function game_private.user_is_ready(p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select p.is_active and not p.must_change_password
    from public.profiles p
    where p.id = p_user_id
  ), false)
$$;

create function game_private.revoke_credentials(
  p_user_id uuid,
  p_assignment_id uuid,
  p_reason text
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_ticket_count integer;
  v_session_count integer;
begin
  if p_user_id is null and p_assignment_id is null then
    raise exception 'revocation requires a user or assignment scope' using errcode = '22023';
  end if;

  if p_reason is null or pg_catalog.btrim(p_reason) = '' or pg_catalog.char_length(p_reason) > 100 then
    raise exception 'revocation reason must contain 1..100 characters' using errcode = '22023';
  end if;

  update game_private.launch_tickets lt
  set revoked_at = pg_catalog.now(), revoke_reason = p_reason
  where lt.revoked_at is null
    and lt.used_at is null
    and (p_user_id is null or lt.user_id = p_user_id)
    and (p_assignment_id is null or lt.assignment_id = p_assignment_id);
  get diagnostics v_ticket_count = row_count;

  update game_private.game_auth_sessions gas
  set revoked_at = pg_catalog.now(), revoke_reason = p_reason
  where gas.revoked_at is null
    and (p_user_id is null or gas.user_id = p_user_id)
    and (p_assignment_id is null or gas.assignment_id = p_assignment_id);
  get diagnostics v_session_count = row_count;

  return v_ticket_count + v_session_count;
end;
$$;

create function game_private.claim_rpc_request(
  p_actor_user_id uuid,
  p_rpc_name text,
  p_request_id uuid,
  p_input_hash bytea,
  p_retention_until timestamptz
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_request game_private.rpc_requests;
begin
  if p_actor_user_id is null or p_request_id is null or octet_length(p_input_hash) <> 32 then
    raise exception 'invalid idempotency request identity/hash' using errcode = '22023';
  end if;

  insert into game_private.rpc_requests as rr (
    actor_user_id, rpc_name, request_id, input_hash, retention_until
  ) values (
    p_actor_user_id, p_rpc_name, p_request_id, p_input_hash, p_retention_until
  )
  on conflict (actor_user_id, rpc_name, request_id) do update
    set request_id = rr.request_id
  returning rr.* into v_request;

  if v_request.input_hash <> p_input_hash then
    raise exception 'request id was reused with different input' using errcode = '22000';
  end if;

  return v_request.result_payload;
end;
$$;

create function game_private.complete_rpc_request(
  p_actor_user_id uuid,
  p_rpc_name text,
  p_request_id uuid,
  p_result_payload jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_result_payload is null or pg_catalog.jsonb_typeof(p_result_payload) <> 'object' then
    raise exception 'idempotency result must be a JSON object' using errcode = '22023';
  end if;

  update game_private.rpc_requests rr
  set result_payload = p_result_payload, completed_at = pg_catalog.now()
  where rr.actor_user_id = p_actor_user_id
    and rr.rpc_name = p_rpc_name
    and rr.request_id = p_request_id
    and rr.result_payload is null;

  if not found then
    raise exception 'idempotency request is missing or already completed' using errcode = '55000';
  end if;
end;
$$;

create function game_private.enforce_assignment_kind_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assignment_kind is distinct from old.assignment_kind then
    raise exception 'assignment_kind is immutable; create a new canonical assignment instead'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create function game_private.ensure_game_assignment_has_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignment_kind = 'game'
     and not exists (
       select 1
       from public.game_assignment_configs c
       where c.assignment_id = new.id
     ) then
    raise exception 'game assignment % requires exactly one game config', new.id
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create function game_private.ensure_game_config_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.assignments a
    where a.id = new.assignment_id
      and a.assignment_kind = 'game'
  ) then
    raise exception 'game config parent must be an assignment_kind=game row'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create function game_private.ensure_accommodation_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.assignments a
    join public.students s on s.id = new.student_id
    where a.id = new.assignment_id
      and s.teacher_id = a.teacher_id
  ) then
    raise exception 'student accommodation must be set by the assignment teacher for their own student'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create function game_private.ensure_game_vocabulary_source_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.assignments a
    join public.vocabulary_sets vs on vs.id = new.vocabulary_set_id
    where a.id = new.assignment_id
      and a.assignment_kind = 'game'
      and a.teacher_id = vs.teacher_id
      and vs.published_at is not null
      and vs.archived_at is null
  ) then
    raise exception 'game assignment and vocabulary source must be active and owned by the same teacher'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create function game_private.reject_game_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.assignments a
    where a.id = new.assignment_id and a.assignment_kind = 'game'
  ) then
    raise exception 'game assignments use game.game_attempts, not public.submissions'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger assignments_assignment_kind_immutable
before update of assignment_kind on public.assignments
for each row execute function game_private.enforce_assignment_kind_immutable();

create constraint trigger assignments_game_config_required
after insert or update of assignment_kind on public.assignments
deferrable initially deferred
for each row execute function game_private.ensure_game_assignment_has_config();

create trigger game_assignment_configs_parent_kind
before insert or update of assignment_id on public.game_assignment_configs
for each row execute function game_private.ensure_game_config_parent();

create trigger game_assignment_accommodations_owner
before insert or update of assignment_id, student_id on public.game_assignment_accommodations
for each row execute function game_private.ensure_accommodation_owner();

create trigger game_assignment_vocabulary_sources_owner
before insert or update of assignment_id, vocabulary_set_id
on public.game_assignment_vocabulary_sources
for each row execute function game_private.ensure_game_vocabulary_source_owner();

create trigger submissions_reject_game_assignment
before insert or update of assignment_id on public.submissions
for each row execute function game_private.reject_game_submission();

create function game_private.revoke_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.is_active and not new.is_active)
     or (not old.must_change_password and new.must_change_password) then
    perform game_private.revoke_credentials(new.id, null, 'profile_not_ready');
  end if;
  return new;
end;
$$;

create function game_private.revoke_on_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.archived_at is null and new.archived_at is not null)
     or (old.published_at is not null and new.published_at is null) then
    perform game_private.revoke_credentials(null, new.id, 'assignment_unavailable');
  end if;
  return new;
end;
$$;

create function game_private.revoke_on_assignment_target_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
begin
  v_assignment_id := case when tg_op = 'DELETE' then old.assignment_id else new.assignment_id end;

  if tg_op = 'DELETE'
     or (old.revoked_at is null and new.revoked_at is not null)
     or old.assignment_id is distinct from new.assignment_id
     or old.class_id is distinct from new.class_id
     or old.student_id is distinct from new.student_id then
    perform game_private.revoke_credentials(null, v_assignment_id, 'assignment_target_changed');
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function game_private.revoke_on_unenrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
begin
  if (tg_op = 'DELETE')
     or (old.unenrolled_at is null and new.unenrolled_at is not null) then
    for v_assignment_id in
      select distinct at.assignment_id
      from public.assignment_targets at
      join public.assignments a on a.id = at.assignment_id
      where at.class_id = old.class_id
        and at.revoked_at is null
        and a.assignment_kind = 'game'
    loop
      perform game_private.revoke_credentials(old.student_id, v_assignment_id, 'student_unenrolled');
    end loop;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function game_private.revoke_on_student_teacher_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.teacher_id is distinct from new.teacher_id then
    perform game_private.revoke_credentials(new.id, null, 'student_teacher_changed');
    delete from public.game_assignment_accommodations ac
    where ac.student_id = new.id;
  end if;
  return new;
end;
$$;

create trigger profiles_revoke_game_credentials
after update of is_active, must_change_password on public.profiles
for each row execute function game_private.revoke_on_profile_change();

create trigger assignments_revoke_game_credentials
after update of published_at, archived_at on public.assignments
for each row execute function game_private.revoke_on_assignment_change();

create trigger assignment_targets_revoke_game_credentials
after update of assignment_id, class_id, student_id, revoked_at or delete on public.assignment_targets
for each row execute function game_private.revoke_on_assignment_target_change();

create trigger enrollments_revoke_game_credentials
after update of unenrolled_at or delete on public.enrollments
for each row execute function game_private.revoke_on_unenrollment();

create trigger students_revoke_game_credentials
after update of teacher_id on public.students
for each row execute function game_private.revoke_on_student_teacher_change();

create function game_private.revoke_on_game_config_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
begin
  v_assignment_id := case when tg_op = 'DELETE' then old.assignment_id else new.assignment_id end;
  perform game_private.revoke_credentials(null, v_assignment_id, 'game_config_changed');
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function game_private.revoke_on_accommodation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_student_id uuid;
begin
  v_assignment_id := case when tg_op = 'DELETE' then old.assignment_id else new.assignment_id end;
  v_student_id := case when tg_op = 'DELETE' then old.student_id else new.student_id end;
  perform game_private.revoke_credentials(v_student_id, v_assignment_id, 'accommodation_changed');
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger game_assignment_configs_revoke_credentials
after update or delete on public.game_assignment_configs
for each row execute function game_private.revoke_on_game_config_change();

create trigger game_assignment_accommodations_revoke_credentials
after insert or update or delete on public.game_assignment_accommodations
for each row execute function game_private.revoke_on_accommodation_change();

create trigger game_assignment_vocabulary_sources_revoke_credentials
after insert or update or delete on public.game_assignment_vocabulary_sources
for each row execute function game_private.revoke_on_game_config_change();

-- ============================================================================
-- Main-site RPCs: canonical game assignment, accommodations and launch
-- ============================================================================

create function public.create_and_publish_game_assignment_v1(
  p_title text,
  p_description text,
  p_due_at timestamptz,
  p_class_ids uuid[],
  p_student_ids uuid[],
  p_vocabulary_set_ids uuid[],
  p_allowed_modes text[],
  p_map_key text,
  p_learning_difficulty text,
  p_minimum_day integer,
  p_minimum_learning_questions integer,
  p_minimum_accuracy numeric,
  p_screen_shake_max smallint,
  p_hit_stop_allowed boolean,
  p_flash_intensity text,
  p_shard_intensity text,
  p_screamer_distortion_allowed boolean,
  p_slow_motion_allowed boolean,
  p_camera_bob_allowed boolean,
  p_motion_blur_allowed boolean,
  p_timing_multiplier numeric,
  p_ruleset_version text,
  p_content_release_id text,
  p_retention_until timestamptz,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_assignment_id uuid;
  v_class_id uuid;
  v_student_id uuid;
  v_set_id uuid;
  v_input_hash bytea;
  v_previous_result jsonb;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  select t.id into v_teacher_id
  from public.teachers t
  where t.id = (select auth.uid());

  if v_teacher_id is null then
    raise exception 'caller is not an active teacher' using errcode = '28000';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id is required' using errcode = '22023';
  end if;

  v_input_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'title', p_title, 'description', p_description, 'dueAt', p_due_at,
    'classIds', p_class_ids, 'studentIds', p_student_ids,
    'vocabularySetIds', p_vocabulary_set_ids,
    'allowedModes', p_allowed_modes, 'map', p_map_key,
    'learningDifficulty', p_learning_difficulty,
    'minimumDay', p_minimum_day,
    'minimumLearningQuestions', p_minimum_learning_questions,
    'minimumAccuracy', p_minimum_accuracy,
    'screenShakeMax', p_screen_shake_max,
    'hitStopAllowed', p_hit_stop_allowed,
    'flashIntensity', p_flash_intensity,
    'shardIntensity', p_shard_intensity,
    'screamerDistortionAllowed', p_screamer_distortion_allowed,
    'slowMotionAllowed', p_slow_motion_allowed,
    'cameraBobAllowed', p_camera_bob_allowed,
    'motionBlurAllowed', p_motion_blur_allowed,
    'timingMultiplier', p_timing_multiplier,
    'rulesetVersion', p_ruleset_version,
    'contentReleaseId', p_content_release_id,
    'retentionUntil', p_retention_until
  )::text);

  v_previous_result := game_private.claim_rpc_request(
    v_teacher_id, 'public.create_game_assignment_v1', p_request_id,
    v_input_hash, p_retention_until
  );
  if v_previous_result is not null then
    return (v_previous_result ->> 'assignmentId')::uuid;
  end if;

  if coalesce(pg_catalog.cardinality(p_class_ids), 0)
     + coalesce(pg_catalog.cardinality(p_student_ids), 0) = 0 then
    raise exception 'at least one class or student target is required' using errcode = '22023';
  end if;

  if coalesce(pg_catalog.cardinality(p_vocabulary_set_ids), 0) = 0 then
    raise exception 'at least one structured vocabulary source is required' using errcode = '22023';
  end if;

  foreach v_class_id in array coalesce(p_class_ids, array[]::uuid[])
  loop
    if v_class_id is null or not exists (
      select 1 from public.classes c
      where c.id = v_class_id and c.teacher_id = v_teacher_id and c.archived_at is null
    ) then
      raise exception 'class target is missing, archived, or not owned by caller' using errcode = '42501';
    end if;
  end loop;

  foreach v_student_id in array coalesce(p_student_ids, array[]::uuid[])
  loop
    if v_student_id is null or not exists (
      select 1 from public.students s
      where s.id = v_student_id and s.teacher_id = v_teacher_id
    ) then
      raise exception 'student target is missing or not owned by caller' using errcode = '42501';
    end if;
  end loop;

  foreach v_set_id in array coalesce(p_vocabulary_set_ids, array[]::uuid[])
  loop
    if v_set_id is null or not exists (
      select 1 from public.vocabulary_sets vs
      where vs.id = v_set_id
        and vs.teacher_id = v_teacher_id
        and vs.published_at is not null
        and vs.archived_at is null
    ) then
      raise exception 'vocabulary source is missing, inactive, or not owned by caller' using errcode = '42501';
    end if;
  end loop;

  insert into public.assignments (
    teacher_id, title, description, due_at, published_at, assignment_kind
  ) values (
    v_teacher_id, p_title, nullif(p_description, ''), p_due_at, pg_catalog.now(), 'game'
  ) returning id into v_assignment_id;

  insert into public.game_assignment_configs (
    assignment_id, allowed_modes, map_key, learning_difficulty,
    minimum_day, minimum_learning_questions, minimum_accuracy,
    screen_shake_max, hit_stop_allowed, flash_intensity, shard_intensity,
    screamer_distortion_allowed, slow_motion_allowed, camera_bob_allowed,
    motion_blur_allowed, timing_multiplier, ruleset_version,
    content_release_id, retention_until
  ) values (
    v_assignment_id, p_allowed_modes, p_map_key, p_learning_difficulty,
    p_minimum_day, p_minimum_learning_questions, p_minimum_accuracy,
    p_screen_shake_max, p_hit_stop_allowed, p_flash_intensity, p_shard_intensity,
    p_screamer_distortion_allowed, p_slow_motion_allowed, p_camera_bob_allowed,
    p_motion_blur_allowed, p_timing_multiplier, p_ruleset_version,
    p_content_release_id, p_retention_until
  );

  insert into public.assignment_targets (assignment_id, class_id)
  select v_assignment_id, target_id
  from pg_catalog.unnest(coalesce(p_class_ids, array[]::uuid[])) as target_id
  group by target_id;

  insert into public.assignment_targets (assignment_id, student_id)
  select v_assignment_id, target_id
  from pg_catalog.unnest(coalesce(p_student_ids, array[]::uuid[])) as target_id
  group by target_id;

  insert into public.game_assignment_vocabulary_sources (assignment_id, vocabulary_set_id)
  select v_assignment_id, source_id
  from pg_catalog.unnest(p_vocabulary_set_ids) as source_id
  group by source_id;

  insert into public.audit_log (
    actor_user_id, actor_type, action, target_table, target_id,
    request_id, outcome, detail
  ) values (
    v_teacher_id, 'teacher', 'game.assignment.create', 'assignments',
    v_assignment_id, p_request_id, 'succeeded',
    pg_catalog.jsonb_build_object('assignment_kind', 'game')
  );

  perform game_private.complete_rpc_request(
    v_teacher_id, 'public.create_game_assignment_v1', p_request_id,
    pg_catalog.jsonb_build_object('assignmentId', v_assignment_id)
  );

  return v_assignment_id;
end;
$$;

create function public.set_game_assignment_accommodation_v1(
  p_assignment_id uuid,
  p_student_id uuid,
  p_timing_mode text,
  p_timing_multiplier numeric,
  p_flash_intensity text,
  p_screen_shake_max smallint,
  p_screamer_distortion_allowed boolean,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_config public.game_assignment_configs;
  v_flash_order integer;
  v_config_flash_order integer;
  v_input_hash bytea;
  v_previous_result jsonb;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'caller is not an active teacher' using errcode = '28000';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id is required' using errcode = '22023';
  end if;

  v_input_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'assignmentId', p_assignment_id, 'studentId', p_student_id,
    'timingMode', p_timing_mode, 'timingMultiplier', p_timing_multiplier,
    'flashIntensity', p_flash_intensity,
    'screenShakeMax', p_screen_shake_max,
    'screamerDistortionAllowed', p_screamer_distortion_allowed
  )::text);

  v_previous_result := game_private.claim_rpc_request(
    v_teacher_id, 'public.set_game_accommodation_v1', p_request_id,
    v_input_hash, pg_catalog.now() + interval '30 days'
  );
  if v_previous_result is not null then
    return;
  end if;

  select c.* into v_config
  from public.game_assignment_configs c
  join public.assignments a on a.id = c.assignment_id
  where c.assignment_id = p_assignment_id
    and a.teacher_id = v_teacher_id
  for update of c;

  if not found then
    raise exception 'game assignment not found or not owned by caller' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.teacher_id = v_teacher_id
  ) then
    raise exception 'student not found or not owned by caller' using errcode = '42501';
  end if;

  v_flash_order := case p_flash_intensity when 'off' then 0 when 'reduced' then 1 when 'normal' then 2 else -1 end;
  v_config_flash_order := case v_config.flash_intensity when 'off' then 0 when 'reduced' then 1 else 2 end;

  if v_flash_order < 0
     or v_flash_order > v_config_flash_order
     or p_screen_shake_max > v_config.screen_shake_max
     or (p_screamer_distortion_allowed and not v_config.screamer_distortion_allowed) then
    raise exception 'an accommodation cannot increase assignment motion or flash limits' using errcode = '22023';
  end if;

  insert into public.game_assignment_accommodations (
    assignment_id, student_id, timing_mode, timing_multiplier,
    flash_intensity, screen_shake_max, screamer_distortion_allowed
  ) values (
    p_assignment_id, p_student_id, p_timing_mode, p_timing_multiplier,
    p_flash_intensity, p_screen_shake_max, p_screamer_distortion_allowed
  )
  on conflict (assignment_id, student_id) do update set
    timing_mode = excluded.timing_mode,
    timing_multiplier = excluded.timing_multiplier,
    flash_intensity = excluded.flash_intensity,
    screen_shake_max = excluded.screen_shake_max,
    screamer_distortion_allowed = excluded.screamer_distortion_allowed;

  insert into public.audit_log (
    actor_user_id, actor_type, action, target_table, target_id,
    request_id, outcome, detail
  ) values (
    v_teacher_id, 'teacher', 'game.accommodation.set',
    'game_assignment_accommodations', p_student_id, p_request_id,
    'succeeded', pg_catalog.jsonb_build_object('assignment_id', p_assignment_id)
  );

  perform game_private.complete_rpc_request(
    v_teacher_id, 'public.set_game_accommodation_v1', p_request_id,
    pg_catalog.jsonb_build_object('ok', true)
  );
end;
$$;

create function public.issue_game_launch_ticket_v1(
  p_assignment_id uuid,
  p_request_id uuid,
  p_client_nonce text
)
returns table (
  launch_ticket text,
  expires_at timestamptz,
  assignment_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_raw_ticket text;
  v_expires_at timestamptz;
  v_input_hash bytea;
  v_previous_result jsonb;
  v_existing_ticket game_private.launch_tickets;
begin
  v_user_id := (select auth.uid());

  if v_user_id is null or not game_private.user_is_ready(v_user_id) then
    raise exception 'account is not ready for game launch' using errcode = '28000';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id is required' using errcode = '22023';
  end if;

  if p_client_nonce is null
     or pg_catalog.char_length(p_client_nonce) not between 43 and 128
     or p_client_nonce !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'p_client_nonce must be 43..128 base64url characters from a CSPRNG'
      using errcode = '22023';
  end if;

  -- Serializes all ticket issuance for this user, including different
  -- request ids, so only one unused launch ticket survives.
  perform 1 from public.profiles p where p.id = v_user_id for update;

  v_input_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'assignmentId', p_assignment_id,
    'clientNonceHash', pg_catalog.encode(game_private.sha256_text(p_client_nonce), 'hex')
  )::text);

  v_previous_result := game_private.claim_rpc_request(
    v_user_id, 'public.issue_game_launch_ticket_v1', p_request_id,
    v_input_hash, pg_catalog.now() + interval '10 minutes'
  );

  v_raw_ticket := game_private.base64url(game_private.sha256_text(
    p_client_nonce || ':' || v_user_id::text || ':' || p_request_id::text
      || ':' || coalesce(p_assignment_id::text, 'free-play') || ':launch-ticket-v1'
  ));

  if v_previous_result is not null then
    select lt.* into v_existing_ticket
    from game_private.launch_tickets lt
    where lt.id = (v_previous_result ->> 'ticketId')::uuid
      and lt.user_id = v_user_id;

    if not found
       or v_existing_ticket.token_hash <> game_private.sha256_text(v_raw_ticket) then
      raise exception 'idempotent launch-ticket state is inconsistent' using errcode = '55000';
    end if;

    return query select
      v_raw_ticket, v_existing_ticket.expires_at, v_existing_ticket.assignment_id;
    return;
  end if;

  if p_assignment_id is not null
     and not game_private.user_can_access_game_assignment(v_user_id, p_assignment_id) then
    raise exception 'game assignment is not currently available to caller' using errcode = '42501';
  end if;

  update game_private.launch_tickets lt
  set revoked_at = pg_catalog.now(), revoke_reason = 'superseded_by_new_ticket'
  where lt.user_id = v_user_id
    and lt.used_at is null
    and lt.revoked_at is null;

  v_expires_at := pg_catalog.now() + interval '60 seconds';

  insert into game_private.launch_tickets (
    token_hash, user_id, assignment_id, request_id, expires_at
  ) values (
    game_private.sha256_text(v_raw_ticket), v_user_id, p_assignment_id,
    p_request_id, v_expires_at
  ) returning * into v_existing_ticket;

  insert into public.audit_log (
    actor_user_id, actor_type, action, target_table, target_id,
    request_id, outcome, detail
  ) values (
    v_user_id,
    case when exists (select 1 from public.teachers t where t.id = v_user_id)
      then 'teacher' else 'student' end,
    'game.launch_ticket.issue', 'assignments', p_assignment_id,
    p_request_id, 'succeeded', '{}'::jsonb
  );

  perform game_private.complete_rpc_request(
    v_user_id, 'public.issue_game_launch_ticket_v1', p_request_id,
    pg_catalog.jsonb_build_object(
      'ticketId', v_existing_ticket.id,
      'expiresAt', v_existing_ticket.expires_at,
      'assignmentId', v_existing_ticket.assignment_id
    )
  );

  return query select v_raw_ticket, v_expires_at, p_assignment_id;
end;
$$;

create function public.revoke_game_sessions_v1(
  p_user_id uuid,
  p_reason text,
  p_request_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revoked integer;
begin
  if p_user_id is null or p_request_id is null then
    raise exception 'p_user_id and p_request_id are required' using errcode = '22023';
  end if;

  v_revoked := game_private.revoke_credentials(p_user_id, null, p_reason);

  insert into public.audit_log (
    actor_user_id, actor_type, action, target_table, target_id,
    request_id, outcome, detail
  ) values (
    null, 'system', 'game.session.revoke', 'profiles', p_user_id,
    p_request_id, 'succeeded', pg_catalog.jsonb_build_object('revoked_count', v_revoked)
  );

  return v_revoked;
end;
$$;

create table game_private.join_requests (
  request_id uuid primary key,
  game_auth_session_id uuid not null references game_private.game_auth_sessions (id) on delete cascade,
  room_id text not null,
  input_hash bytea not null,
  game_session_id uuid not null references game.game_sessions (id) on delete cascade,
  session_player_id uuid not null references game.session_players (id) on delete cascade,
  game_attempt_id uuid not null references game.game_attempts (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint join_requests_room_id_format check (room_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  constraint join_requests_hash_length check (octet_length(input_hash) = 32)
);

alter table game_private.join_requests owner to game_api_owner;
alter table game_private.join_requests enable row level security;
revoke all on game_private.join_requests from public, anon, authenticated, service_role, game_server;

-- ============================================================================
-- Authoritative-server identity and room boundary
-- ============================================================================

create function game_private.resolve_game_auth_session(p_session_token text)
returns table (
  auth_session_id uuid,
  authenticated_user_id uuid,
  bound_assignment_id uuid,
  force_exit_at timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  v_session game_private.game_auth_sessions;
begin
  if p_session_token is null
     or pg_catalog.char_length(p_session_token) < 32
     or pg_catalog.char_length(p_session_token) > 512 then
    raise exception 'invalid game session credential' using errcode = '28000';
  end if;

  select gas.* into v_session
  from game_private.game_auth_sessions gas
  where gas.session_token_hash = game_private.sha256_text(p_session_token)
  for update;

  if not found
     or v_session.revoked_at is not null
     or v_session.expires_at <= pg_catalog.now() then
    raise exception 'game session is missing, revoked, or expired' using errcode = '28000';
  end if;

  if not game_private.user_is_ready(v_session.user_id)
     or (
       v_session.assignment_id is not null
       and not game_private.user_can_access_game_assignment(
         v_session.user_id,
         v_session.assignment_id
       )
     ) then
    raise exception 'game session is no longer eligible' using errcode = '28000';
  end if;

  update game_private.game_auth_sessions gas
  set last_validated_at = pg_catalog.now()
  where gas.id = v_session.id;

  return query
  select v_session.id, v_session.user_id, v_session.assignment_id, v_session.expires_at;
end;
$$;

create function game_private.build_launch_context(
  p_user_id uuid,
  p_assignment_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'profile', pg_catalog.jsonb_build_object(
      'id', p.id,
      'role', p.role,
      'displayName', p.full_name
    ),
    'assignment', case when a.id is null then null else pg_catalog.jsonb_build_object(
      'id', a.id,
      'title', a.title,
      'dueAt', a.due_at,
      'allowedModes', c.allowed_modes,
      'map', c.map_key,
      'learningDifficulty', c.learning_difficulty,
      'screenShakeMax', pg_catalog.least(c.screen_shake_max, coalesce(ac.screen_shake_max, c.screen_shake_max)),
      'hitStopAllowed', c.hit_stop_allowed,
      'flashIntensity', coalesce(ac.flash_intensity, c.flash_intensity),
      'shardIntensity', c.shard_intensity,
      'screamerDistortionAllowed', c.screamer_distortion_allowed and coalesce(ac.screamer_distortion_allowed, true),
      'slowMotionAllowed', c.slow_motion_allowed,
      'cameraBobAllowed', c.camera_bob_allowed,
      'motionBlurAllowed', c.motion_blur_allowed,
      'timingMode', coalesce(ac.timing_mode, 'standard'),
      'timingMultiplier', case
        when ac.timing_mode = 'extended' then ac.timing_multiplier
        else c.timing_multiplier
      end,
      'rulesetVersion', c.ruleset_version,
      'contentReleaseId', c.content_release_id
    ) end
  )
  from public.profiles p
  left join public.assignments a on a.id = p_assignment_id
  left join public.game_assignment_configs c on c.assignment_id = a.id
  left join public.game_assignment_accommodations ac
    on ac.assignment_id = a.id and ac.student_id = p_user_id
  where p.id = p_user_id
$$;

create function game.redeem_game_launch_ticket_v1(
  p_launch_ticket text,
  p_exchange_request_id uuid
)
returns table (
  game_session_token text,
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
  v_ticket game_private.launch_tickets;
  v_auth_session game_private.game_auth_sessions;
  v_raw_session_token text;
  v_force_exit_at timestamptz;
begin
  if p_exchange_request_id is null
     or p_launch_ticket is null
     or pg_catalog.char_length(p_launch_ticket) < 43
     or pg_catalog.char_length(p_launch_ticket) > 512 then
    raise exception 'invalid launch-ticket exchange request' using errcode = '22023';
  end if;

  select lt.* into v_ticket
  from game_private.launch_tickets lt
  where lt.token_hash = game_private.sha256_text(p_launch_ticket)
  for update;

  if not found or v_ticket.revoked_at is not null then
    raise exception 'launch ticket is missing or revoked' using errcode = '28000';
  end if;

  v_raw_session_token := game_private.base64url(
    game_private.sha256_text(
      p_launch_ticket || ':' || p_exchange_request_id::text || ':game-session-v1'
    )
  );

  if v_ticket.used_at is not null then
    if v_ticket.exchange_request_id is distinct from p_exchange_request_id then
      raise exception 'launch ticket has already been consumed' using errcode = '28000';
    end if;

    select gas.* into v_auth_session
    from game_private.game_auth_sessions gas
    where gas.launch_ticket_id = v_ticket.id;

    if not found
       or v_auth_session.revoked_at is not null
       or v_auth_session.expires_at <= pg_catalog.now()
       or not game_private.user_is_ready(v_ticket.user_id)
       or (
         v_ticket.assignment_id is not null
         and not game_private.user_can_access_game_assignment(
           v_ticket.user_id,
           v_ticket.assignment_id
         )
       ) then
      raise exception 'exchanged game session is no longer valid' using errcode = '28000';
    end if;

    return query select
      v_raw_session_token,
      v_ticket.user_id,
      v_ticket.assignment_id,
      v_auth_session.expires_at,
      game_private.build_launch_context(v_ticket.user_id, v_ticket.assignment_id);
    return;
  end if;

  if v_ticket.expires_at <= pg_catalog.now() then
    raise exception 'launch ticket expired' using errcode = '28000';
  end if;

  if not game_private.user_is_ready(v_ticket.user_id)
     or (
       v_ticket.assignment_id is not null
       and not game_private.user_can_access_game_assignment(
         v_ticket.user_id,
         v_ticket.assignment_id
       )
     ) then
    raise exception 'launch eligibility changed before exchange' using errcode = '28000';
  end if;

  v_force_exit_at := pg_catalog.now() + interval '5 hours';

  insert into game_private.game_auth_sessions (
    launch_ticket_id, session_token_hash, user_id, assignment_id, expires_at
  ) values (
    v_ticket.id, game_private.sha256_text(v_raw_session_token),
    v_ticket.user_id, v_ticket.assignment_id, v_force_exit_at
  ) returning * into v_auth_session;

  update game_private.launch_tickets lt
  set used_at = pg_catalog.now(), exchange_request_id = p_exchange_request_id
  where lt.id = v_ticket.id;

  return query select
    v_raw_session_token,
    v_ticket.user_id,
    v_ticket.assignment_id,
    v_force_exit_at,
    game_private.build_launch_context(v_ticket.user_id, v_ticket.assignment_id);
end;
$$;

create function game.validate_game_session_v1(p_game_session_token text)
returns table (
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
    v_identity.authenticated_user_id,
    v_identity.bound_assignment_id,
    v_identity.force_exit_at,
    game_private.build_launch_context(
      v_identity.authenticated_user_id,
      v_identity.bound_assignment_id
    );
end;
$$;

create function game.authorize_game_join_v1(
  p_game_session_token text,
  p_request_id uuid,
  p_room_id text,
  p_mode text,
  p_map_key text,
  p_requested_side text,
  p_protocol_version text,
  p_simulation_version text,
  p_ruleset_version text,
  p_content_release_id text,
  p_region text
)
returns table (
  game_session_id uuid,
  session_player_id uuid,
  game_attempt_id uuid,
  user_id uuid,
  assignment_id uuid,
  force_exit_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_existing_request game_private.join_requests;
  v_game_session game.game_sessions;
  v_session_player game.session_players;
  v_game_attempt game.game_attempts;
  v_config public.game_assignment_configs;
  v_retention_until timestamptz;
  v_player_side text;
  v_queue text;
  v_rank_eligible boolean;
  v_active_game_session_id uuid;
  v_input_hash bytea;
begin
  if p_request_id is null then
    raise exception 'p_request_id is required' using errcode = '22023';
  end if;

  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);

  -- resolve_game_auth_session() locks this row. The lock is retained until
  -- this RPC commits, making the one-credential/one-active-room transition
  -- atomic even across different join request ids.
  select gas.active_game_session_id into v_active_game_session_id
  from game_private.game_auth_sessions gas
  where gas.id = v_identity.auth_session_id;

  v_player_side := case
    when p_mode in ('pve', 'coop') then 'survivor'
    when p_mode = 'asymmetric' and p_requested_side in ('survivor', 'zombie')
      then p_requested_side
    else null
  end;
  v_queue := case
    when p_mode = 'pve' then 'solo_survivor'
    when p_mode = 'coop' then 'coop_survivor'
    when p_mode = 'asymmetric' and v_player_side = 'survivor' then 'coop_survivor'
    when p_mode = 'asymmetric' and v_player_side = 'zombie' then 'zombie'
    else null
  end;
  v_rank_eligible := v_queue is not null;

  if v_player_side is null or v_queue is null then
    raise exception 'requested side is not valid for the authoritative room mode' using errcode = '22023';
  end if;

  v_input_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'roomId', p_room_id, 'mode', p_mode, 'map', p_map_key,
    'requestedSide', p_requested_side, 'derivedSide', v_player_side,
    'derivedQueue', v_queue, 'protocolVersion', p_protocol_version,
    'simulationVersion', p_simulation_version,
    'rulesetVersion', p_ruleset_version,
    'contentReleaseId', p_content_release_id, 'region', p_region
  )::text);

  select jr.* into v_existing_request
  from game_private.join_requests jr
  where jr.request_id = p_request_id;

  if found then
    if v_existing_request.game_auth_session_id <> v_identity.auth_session_id
       or v_existing_request.input_hash <> v_input_hash then
      raise exception 'join request id was reused with different input' using errcode = '22000';
    end if;

    return query select
      v_existing_request.game_session_id,
      v_existing_request.session_player_id,
      v_existing_request.game_attempt_id,
      v_identity.authenticated_user_id,
      v_identity.bound_assignment_id,
      v_identity.force_exit_at;
    return;
  end if;

  if v_identity.bound_assignment_id is not null then
    select c.* into v_config
    from public.game_assignment_configs c
    where c.assignment_id = v_identity.bound_assignment_id;

    if not found
       or not (p_mode = any(v_config.allowed_modes))
       or p_map_key <> v_config.map_key
       or p_ruleset_version <> v_config.ruleset_version
       or p_content_release_id <> v_config.content_release_id then
      raise exception 'room settings do not satisfy the bound game assignment' using errcode = '42501';
    end if;
    v_retention_until := v_config.retention_until;
  else
    v_retention_until := pg_catalog.now() + interval '180 days';
  end if;

  insert into game.game_sessions (
    room_id, host_user_id, mode, map_key, protocol_version,
    simulation_version, ruleset_version, content_release_id, region,
    retention_until
  ) values (
    p_room_id, v_identity.authenticated_user_id, p_mode, p_map_key,
    p_protocol_version, p_simulation_version, p_ruleset_version,
    p_content_release_id, p_region, v_retention_until
  )
  on conflict (room_id) do nothing;

  select gs.* into v_game_session
  from game.game_sessions gs
  where gs.room_id = p_room_id
  for update;

  if v_game_session.status <> 'active'
     or v_game_session.mode <> p_mode
     or v_game_session.map_key <> p_map_key
     or v_game_session.protocol_version <> p_protocol_version
     or v_game_session.simulation_version <> p_simulation_version
     or v_game_session.ruleset_version <> p_ruleset_version
     or v_game_session.content_release_id <> p_content_release_id
     or v_game_session.region <> p_region then
    raise exception 'room is unavailable or version handshake failed' using errcode = '22000';
  end if;

  if v_active_game_session_id is not null
     and v_active_game_session_id <> v_game_session.id then
    raise exception 'game session credential is already active in another room' using errcode = '55000';
  end if;

  update game_private.game_auth_sessions gas
  set active_game_session_id = v_game_session.id
  where gas.id = v_identity.auth_session_id
    and (gas.active_game_session_id is null or gas.active_game_session_id = v_game_session.id);

  if not found then
    raise exception 'game session credential room binding changed concurrently' using errcode = '40001';
  end if;

  insert into game.session_players (
    game_session_id, user_id, game_auth_session_id, player_side
  ) values (
    v_game_session.id, v_identity.authenticated_user_id,
    v_identity.auth_session_id, v_player_side
  )
  on conflict (game_session_id, user_id) where user_id is not null
  do update set
    game_auth_session_id = excluded.game_auth_session_id,
    player_side = excluded.player_side,
    left_at = null,
    disconnect_reason = null
  returning * into v_session_player;

  insert into game.game_attempts (
    game_session_id, session_player_id, user_id, assignment_id,
    queue, rank_eligible, retention_until
  ) values (
    v_game_session.id, v_session_player.id, v_identity.authenticated_user_id,
    v_identity.bound_assignment_id, v_queue, v_rank_eligible, v_retention_until
  )
  on conflict (session_player_id) do update
    set session_player_id = excluded.session_player_id
  returning * into v_game_attempt;

  if v_game_attempt.queue <> v_queue
     or v_game_attempt.assignment_id is distinct from v_identity.bound_assignment_id
     or v_game_attempt.status <> 'in_progress' then
    raise exception 'existing player attempt is terminal or bound to a different derived queue/assignment' using errcode = '22000';
  end if;

  insert into game_private.join_requests (
    request_id, game_auth_session_id, room_id, input_hash, game_session_id,
    session_player_id, game_attempt_id
  ) values (
    p_request_id, v_identity.auth_session_id, p_room_id, v_input_hash, v_game_session.id,
    v_session_player.id, v_game_attempt.id
  );

  return query select
    v_game_session.id,
    v_session_player.id,
    v_game_attempt.id,
    v_identity.authenticated_user_id,
    v_identity.bound_assignment_id,
    v_identity.force_exit_at;
end;
$$;

-- ============================================================================
-- Personal rank: transparent gates, rolling accuracy, never a leaderboard
-- ============================================================================

create function game_private.recompute_personal_rank(
  p_user_id uuid,
  p_queue text,
  p_source_game_attempt_id uuid,
  p_reason text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_sample_size integer;
  v_correct_count integer;
  v_accuracy numeric(5,2);
  v_highest_day integer;
  v_verified_wins integer;
  v_placement_status text;
  v_tier text;
  v_ruleset_version text;
  v_retention_until timestamptz;
  v_old game.personal_rank_snapshots;
  v_had_old boolean;
begin
  if p_queue not in ('solo_survivor', 'coop_survivor', 'zombie') then
    raise exception 'unsupported personal rank queue' using errcode = '22023';
  end if;

  with recent as (
    select la.is_correct
    from game.learning_attempts la
    join game.game_attempts ga on ga.id = la.game_attempt_id
    where ga.user_id = p_user_id
      and ga.queue = p_queue
      and ga.rank_eligible
      and la.counts_for_rank
      and not la.causally_voided
    order by la.answered_at desc, la.id desc
    limit 70
  )
  select count(*)::integer, count(*) filter (where is_correct)::integer
  into v_sample_size, v_correct_count
  from recent;

  v_accuracy := case when v_sample_size = 0 then null
    else pg_catalog.round(100.0 * v_correct_count::numeric / v_sample_size::numeric, 2)
  end;

  select
    coalesce(max(ga.equivalent_day) filter (
      where ga.status = 'completed' and ga.queue in ('solo_survivor', 'coop_survivor')
    ), 0)::integer,
    count(*) filter (
      where ga.status = 'completed' and ga.queue = 'zombie' and ga.verified_win
    )::integer
  into v_highest_day, v_verified_wins
  from game.game_attempts ga
  where ga.user_id = p_user_id
    and ga.queue = p_queue
    and ga.rank_eligible;

  select gs.ruleset_version, ga.retention_until
  into v_ruleset_version, v_retention_until
  from game.game_attempts ga
  join game.game_sessions gs on gs.id = ga.game_session_id
  where ga.id = p_source_game_attempt_id
    and ga.user_id = p_user_id;

  if not found then
    select gs.ruleset_version, ga.retention_until
    into v_ruleset_version, v_retention_until
    from game.game_attempts ga
    join game.game_sessions gs on gs.id = ga.game_session_id
    where ga.user_id = p_user_id and ga.queue = p_queue
    order by ga.created_at desc
    limit 1;
  end if;

  v_ruleset_version := coalesce(v_ruleset_version, 'rank-v1');
  v_retention_until := coalesce(v_retention_until, pg_catalog.now() + interval '180 days');
  v_placement_status := case when v_sample_size >= 35 then 'placed' else 'calibrating' end;
  v_tier := 'bronze';

  if v_placement_status = 'placed' then
    if p_queue = 'zombie' then
      v_tier := case
        when v_verified_wins >= 50 and v_accuracy >= 95 then 'mythic'
        when v_verified_wins >= 30 and v_accuracy >= 90 then 'master'
        when v_verified_wins >= 20 and v_accuracy >= 85 then 'diamond'
        when v_verified_wins >= 12 and v_accuracy >= 75 then 'platinum'
        when v_verified_wins >= 6 and v_accuracy >= 70 then 'gold'
        when v_verified_wins >= 3 and v_accuracy >= 65 then 'silver'
        else 'bronze'
      end;
    else
      v_tier := case
        when v_highest_day >= 50 and v_accuracy >= 95 then 'mythic'
        when v_highest_day >= 30 and v_accuracy >= 90 then 'master'
        when v_highest_day >= 25 and v_accuracy >= 85 then 'diamond'
        when v_highest_day >= 20 and v_accuracy >= 75 then 'platinum'
        when v_highest_day >= 12 and v_accuracy >= 70 then 'gold'
        when v_highest_day >= 6 and v_accuracy >= 65 then 'silver'
        else 'bronze'
      end;
    end if;
  end if;

  select prs.* into v_old
  from game.personal_rank_snapshots prs
  where prs.user_id = p_user_id and prs.queue = p_queue
  for update;
  v_had_old := found;

  insert into game.personal_rank_snapshots (
    user_id, queue, tier, placement_status, official_accuracy,
    sample_size, highest_equivalent_day, verified_wins, ruleset_version,
    retention_until, updated_at
  ) values (
    p_user_id, p_queue, v_tier, v_placement_status, v_accuracy,
    v_sample_size, v_highest_day, v_verified_wins, v_ruleset_version,
    v_retention_until, pg_catalog.now()
  )
  on conflict (user_id, queue) do update set
    tier = excluded.tier,
    placement_status = excluded.placement_status,
    official_accuracy = excluded.official_accuracy,
    sample_size = excluded.sample_size,
    highest_equivalent_day = excluded.highest_equivalent_day,
    verified_wins = excluded.verified_wins,
    ruleset_version = excluded.ruleset_version,
    retention_until = excluded.retention_until,
    updated_at = excluded.updated_at;

  if not v_had_old
     or v_old.tier is distinct from v_tier
     or v_old.placement_status is distinct from v_placement_status then
    insert into game.personal_rank_history (
      user_id, queue, previous_tier, new_tier, placement_status,
      official_accuracy, sample_size, highest_equivalent_day, verified_wins,
      source_game_attempt_id, reason, ruleset_version, retention_until
    ) values (
      p_user_id, p_queue, case when v_had_old then v_old.tier else null end,
      v_tier, v_placement_status, v_accuracy, v_sample_size, v_highest_day,
      v_verified_wins, p_source_game_attempt_id, p_reason,
      v_ruleset_version, v_retention_until
    );
  end if;
end;
$$;

comment on function game_private.recompute_personal_rank(uuid, text, uuid, text) is
  'Private-only personal rank. Placement needs 35 recent official timed answers. Survivor gates use best equivalent Day + accuracy; zombie gates use verified wins + accuracy. The latest 70 official answers are rolling, so wrong answers can lower rank.';

-- ============================================================================
-- Real-time, idempotent learning-question write path
-- ============================================================================

create function game.freeze_question_v1(
  p_game_session_token text,
  p_game_attempt_id uuid,
  p_issue_request_id uuid,
  p_question_type text,
  p_question_purpose text,
  p_preferred_vocabulary_set_id uuid,
  p_base_timeout_ms integer
)
returns table (
  question_instance_id uuid,
  prompt_payload jsonb,
  timed boolean,
  timeout_ms integer,
  expires_at timestamptz,
  counts_for_rank boolean,
  counts_for_assignment boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_attempt game.game_attempts;
  v_existing game_private.question_instances;
  v_config public.game_assignment_configs;
  v_accommodation public.game_assignment_accommodations;
  v_source_set public.vocabulary_sets;
  v_pool game_private.question_pool_snapshots;
  v_item game_private.question_pool_items;
  v_timed boolean;
  v_timeout_ms integer;
  v_counts_for_assignment boolean;
  v_expires_at timestamptz;
  v_input_hash bytea;
  v_prompt jsonb;
  v_answers text[];
  v_source_kind text;
begin
  if p_issue_request_id is null then
    raise exception 'p_issue_request_id is required' using errcode = '22023';
  end if;

  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);

  select ga.* into v_attempt
  from game.game_attempts ga
  join game.session_players sp on sp.id = ga.session_player_id
  where ga.id = p_game_attempt_id
    and ga.user_id = v_identity.authenticated_user_id
    and sp.game_auth_session_id = v_identity.auth_session_id
  for update of ga;

  if not found or v_attempt.status <> 'in_progress' then
    raise exception 'active game attempt not found for session credential' using errcode = '42501';
  end if;

  if p_question_type not in ('en_to_zh', 'zh_to_en') then
    raise exception 'question type is unavailable: listening requires opaque server audio assets; math/official banks are not yet provisioned'
      using errcode = '0A000';
  end if;

  if p_question_purpose not in ('card', 'rescue', 'unlock', 'review') then
    raise exception 'unsupported game question purpose' using errcode = '22023';
  end if;

  v_input_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'gameAttemptId', p_game_attempt_id,
    'questionType', p_question_type,
    'questionPurpose', p_question_purpose,
    'preferredVocabularySetId', p_preferred_vocabulary_set_id,
    'baseTimeoutMs', p_base_timeout_ms
  )::text);

  select qi.* into v_existing
  from game_private.question_instances qi
  where qi.issue_request_id = p_issue_request_id;

  if found then
    if v_existing.game_attempt_id <> p_game_attempt_id
       or v_existing.issue_input_hash <> v_input_hash then
      raise exception 'question issue request id was reused for another attempt' using errcode = '22000';
    end if;

    return query select
      v_existing.id, v_existing.prompt_payload, v_existing.timed,
      v_existing.timeout_ms, v_existing.expires_at,
      v_existing.counts_for_rank, v_existing.counts_for_assignment;
    return;
  end if;

  if v_attempt.assignment_id is not null then
    select vs.* into v_source_set
    from public.game_assignment_vocabulary_sources gavs
    join public.vocabulary_sets vs on vs.id = gavs.vocabulary_set_id
    where gavs.assignment_id = v_attempt.assignment_id
      and vs.published_at is not null
      and vs.archived_at is null
      and (p_preferred_vocabulary_set_id is null or vs.id = p_preferred_vocabulary_set_id)
    order by pg_catalog.md5(p_issue_request_id::text || vs.id::text), vs.id
    limit 1;
    v_source_kind := 'assignment';
  else
    select vs.* into v_source_set
    from public.vocabulary_targets vt
    join public.vocabulary_sets vs on vs.id = vt.set_id
    join public.students s on s.id = v_attempt.user_id and s.teacher_id = vs.teacher_id
    where vt.student_id = v_attempt.user_id
      and vt.revoked_at is null
      and vs.published_at is not null
      and vs.archived_at is null
      and (p_preferred_vocabulary_set_id is null or vs.id = p_preferred_vocabulary_set_id)
    order by pg_catalog.md5(p_issue_request_id::text || vs.id::text), vs.id
    limit 1;
    v_source_kind := 'custom';
  end if;

  if not found then
    raise exception 'no eligible structured vocabulary source is available for this player/assignment'
      using errcode = '42501';
  end if;

  select qps.* into v_pool
  from game_private.question_pool_snapshots qps
  where qps.game_attempt_id = v_attempt.id
    and qps.source_set_id = v_source_set.id;

  if not found then
    insert into game_private.question_pool_snapshots (
      game_attempt_id, source_set_id, source_engine_version,
      content_hash, retention_until
    ) values (
      v_attempt.id, v_source_set.id,
      'v' || v_source_set.practice_engine_version::text,
      game_private.sha256_text('pending'), v_attempt.retention_until
    ) returning * into v_pool;

    insert into game_private.question_pool_items (
      pool_snapshot_id, source_word_id, term, meaning,
      accepted_terms, accepted_meanings, image_url, source_sort_order
    )
    select
      v_pool.id,
      w.id,
      pg_catalog.btrim(w.term),
      pg_catalog.btrim(w.meaning),
      array(
        select distinct pg_catalog.btrim(answer)
        from pg_catalog.unnest(
          array[w.term] || coalesce(array(
            select wat.alt_term
            from public.vocabulary_word_alt_terms wat
            where wat.word_id = w.id
            order by wat.sort_order, wat.id
          ), array[]::text[])
        ) answer
        where pg_catalog.btrim(answer) <> ''
        order by pg_catalog.btrim(answer)
      ),
      array(
        select distinct pg_catalog.btrim(answer)
        from pg_catalog.unnest(
          array[w.meaning] || coalesce(array(
            select wam.alt_meaning
            from public.vocabulary_word_alt_meanings wam
            where wam.word_id = w.id
            order by wam.sort_order, wam.id
          ), array[]::text[])
        ) answer
        where pg_catalog.btrim(answer) <> ''
        order by pg_catalog.btrim(answer)
      ),
      w.image_url,
      w.sort_order
    from public.vocabulary_words w
    where w.set_id = v_source_set.id
      and w.archived_at is null
      and pg_catalog.btrim(w.term) <> ''
      and pg_catalog.btrim(w.meaning) <> ''
    order by w.sort_order, w.id;

    if not exists (
      select 1 from game_private.question_pool_items qpi
      where qpi.pool_snapshot_id = v_pool.id
    ) then
      raise exception 'eligible vocabulary source contains no active structured words'
        using errcode = '22023';
    end if;

    update game_private.question_pool_snapshots qps
    set content_hash = game_private.sha256_text((
      select pg_catalog.string_agg(
        qpi.source_word_id::text || ':' || qpi.term || ':' || qpi.meaning
          || ':' || qpi.accepted_terms::text || ':' || qpi.accepted_meanings::text,
        '|' order by qpi.source_sort_order, qpi.source_word_id
      )
      from game_private.question_pool_items qpi
      where qpi.pool_snapshot_id = v_pool.id
    ))
    where qps.id = v_pool.id
    returning * into v_pool;
  end if;

  select qpi.* into v_item
  from game_private.question_pool_items qpi
  left join game_private.question_exposures qe
    on qe.user_id = v_attempt.user_id
    and qe.source_set_id = v_source_set.id
    and qe.source_word_id = qpi.source_word_id
    and qe.question_type = p_question_type
  where qpi.pool_snapshot_id = v_pool.id
    and coalesce(qe.next_eligible_at, '-infinity'::timestamptz) <= pg_catalog.now()
  order by coalesce(qe.exposure_count, 0),
    pg_catalog.md5(p_issue_request_id::text || qpi.id::text), qpi.id
  limit 1;

  if not found then
    raise exception 'all eligible questions are inside their same-question cooldown'
      using errcode = 'P0001';
  end if;

  v_prompt := case when p_question_type = 'zh_to_en'
    then pg_catalog.jsonb_build_object(
      'kind', 'zh_to_en', 'text', v_item.meaning, 'imageUrl', v_item.image_url
    )
    else pg_catalog.jsonb_build_object('kind', 'en_to_zh', 'text', v_item.term)
  end;
  v_answers := case when p_question_type = 'zh_to_en'
    then v_item.accepted_terms else v_item.accepted_meanings end;

  v_timed := p_question_purpose <> 'unlock';
  v_timeout_ms := case when v_timed then p_base_timeout_ms else null end;

  if v_timed and v_timeout_ms is null then
    raise exception 'in-game card/rescue/review questions require a base timeout'
      using errcode = '22023';
  end if;

  if v_attempt.assignment_id is not null then
    select c.* into v_config
    from public.game_assignment_configs c
    where c.assignment_id = v_attempt.assignment_id;

    select ac.* into v_accommodation
    from public.game_assignment_accommodations ac
    where ac.assignment_id = v_attempt.assignment_id
      and ac.student_id = v_attempt.user_id;

    if v_accommodation.timing_mode = 'untimed' then
      v_timed := false;
      v_timeout_ms := null;
    elsif v_timed then
      v_timeout_ms := pg_catalog.round(
        v_timeout_ms * case
          when v_accommodation.timing_mode = 'extended' then v_accommodation.timing_multiplier
          else v_config.timing_multiplier
        end
      )::integer;
    end if;
  end if;

  if v_timed and (v_timeout_ms < 1000 or v_timeout_ms > 300000) then
    raise exception 'effective question timeout must be 1000..300000 ms' using errcode = '22023';
  end if;

  -- Existing NingAcademy vocabulary sets are teacher material, not the
  -- calibrated official bank. They may complete the bound assignment but
  -- can never be mislabeled as official rank evidence.
  v_counts_for_assignment := v_attempt.assignment_id is not null
    and p_question_purpose = 'card';
  v_expires_at := case when v_timed
    then pg_catalog.now() + pg_catalog.make_interval(secs => v_timeout_ms::double precision / 1000.0)
    else null
  end;

  insert into game_private.question_instances (
    issue_request_id, issue_input_hash, game_attempt_id, user_id, question_type,
    question_purpose, source_kind, difficulty, question_tier, answer_mode,
    prompt_payload, grading_mode, correct_answers, explanation, timed,
    timeout_ms, counts_for_rank, counts_for_assignment, expires_at,
    pool_item_id, source_set_id, source_word_id
  ) values (
    p_issue_request_id, v_input_hash, p_game_attempt_id, v_attempt.user_id,
    p_question_type, p_question_purpose, v_source_kind, 'unscored', 0,
    'standard', v_prompt, 'normalized_text', v_answers,
    'Answer accepted using the teacher-selected frozen vocabulary source.',
    v_timed, v_timeout_ms, false, v_counts_for_assignment, v_expires_at,
    v_item.id, v_source_set.id, v_item.source_word_id
  ) returning * into v_existing;

  insert into game_private.question_exposures (
    user_id, source_set_id, source_word_id, question_type,
    exposure_count, last_exposed_at, next_eligible_at, retention_until
  ) values (
    v_attempt.user_id, v_source_set.id, v_item.source_word_id,
    p_question_type, 1, pg_catalog.now(), pg_catalog.now() + interval '10 minutes',
    v_attempt.retention_until
  )
  on conflict (user_id, source_set_id, source_word_id, question_type)
  do update set
    exposure_count = game_private.question_exposures.exposure_count + 1,
    last_exposed_at = excluded.last_exposed_at,
    next_eligible_at = excluded.next_eligible_at,
    retention_until = pg_catalog.greatest(
      game_private.question_exposures.retention_until, excluded.retention_until
    );

  return query select
    v_existing.id, v_existing.prompt_payload, v_existing.timed,
    v_existing.timeout_ms, v_existing.expires_at,
    v_existing.counts_for_rank, v_existing.counts_for_assignment;
end;
$$;

create function game.submit_game_answer_v1(
  p_game_session_token text,
  p_request_id uuid,
  p_question_instance_id uuid,
  p_submitted_answer text
)
returns table (
  learning_attempt_id uuid,
  is_correct boolean,
  timed_out boolean,
  correct_answers text[],
  explanation text,
  counts_for_rank boolean,
  counts_for_assignment boolean,
  wrong_answer_true_damage integer,
  damage_cannot_kill boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_question game_private.question_instances;
  v_answer_request game_private.answer_requests;
  v_learning_attempt game.learning_attempts;
  v_existing_payload game_private.learning_answer_payloads;
  v_answer_hash bytea;
  v_is_correct boolean;
  v_timed_out boolean;
  v_response_ms integer;
begin
  if p_request_id is null then
    raise exception 'p_request_id is required' using errcode = '22023';
  end if;

  if p_submitted_answer is not null and pg_catalog.char_length(p_submitted_answer) > 1000 then
    raise exception 'submitted answer exceeds 1000 characters' using errcode = '22023';
  end if;

  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);

  select qi.* into v_question
  from game_private.question_instances qi
  join game.game_attempts ga on ga.id = qi.game_attempt_id
  join game.session_players sp on sp.id = ga.session_player_id
  where qi.id = p_question_instance_id
    and qi.user_id = v_identity.authenticated_user_id
    and sp.game_auth_session_id = v_identity.auth_session_id
    and ga.status = 'in_progress';

  if not found then
    raise exception 'active game attempt/question not found for session credential' using errcode = '42501';
  end if;

  -- Global mutation lock order is always game_attempts -> question_instances.
  perform 1
  from game.game_attempts ga
  where ga.id = v_question.game_attempt_id
    and ga.status = 'in_progress'
  for update;
  if not found then
    raise exception 'game attempt is no longer in progress' using errcode = '55000';
  end if;

  perform 1
  from game_private.question_instances qi
  where qi.id = v_question.id
  for update;

  v_answer_hash := game_private.sha256_text(coalesce(p_submitted_answer, '<NULL>'));

  select ar.* into v_answer_request
  from game_private.answer_requests ar
  where ar.request_id = p_request_id;

  if found then
    if v_answer_request.question_instance_id <> p_question_instance_id
       or v_answer_request.submitted_answer_hash <> v_answer_hash then
      raise exception 'answer request id was reused with different input' using errcode = '22000';
    end if;

    select la.* into v_learning_attempt
    from game.learning_attempts la
    where la.id = v_answer_request.learning_attempt_id;

    return query select
      v_learning_attempt.id, v_learning_attempt.is_correct,
      v_learning_attempt.timed_out, v_question.correct_answers,
      v_question.explanation, v_learning_attempt.counts_for_rank,
      v_learning_attempt.counts_for_assignment,
      case when v_learning_attempt.is_correct then 0 else 10 end,
      true;
    return;
  end if;

  select la.* into v_learning_attempt
  from game.learning_attempts la
  where la.question_instance_id = p_question_instance_id;

  if found then
    select lap.* into v_existing_payload
    from game_private.learning_answer_payloads lap
    where lap.learning_attempt_id = v_learning_attempt.id;

    if v_existing_payload.submitted_answer_hash <> v_answer_hash then
      raise exception 'question was already answered with different input' using errcode = '22000';
    end if;

    insert into game_private.answer_requests (
      request_id, question_instance_id, learning_attempt_id, submitted_answer_hash
    ) values (
      p_request_id, p_question_instance_id, v_learning_attempt.id, v_answer_hash
    );

    return query select
      v_learning_attempt.id, v_learning_attempt.is_correct,
      v_learning_attempt.timed_out, v_question.correct_answers,
      v_question.explanation, v_learning_attempt.counts_for_rank,
      v_learning_attempt.counts_for_assignment,
      case when v_learning_attempt.is_correct then 0 else 10 end,
      true;
    return;
  end if;

  v_timed_out := v_question.timed and pg_catalog.now() > v_question.expires_at;
  v_is_correct := not v_timed_out and exists (
    select 1
    from pg_catalog.unnest(v_question.correct_answers) accepted(answer)
    where game_private.normalize_answer(v_question.grading_mode, accepted.answer)
      = game_private.normalize_answer(v_question.grading_mode, p_submitted_answer)
  );
  v_response_ms := pg_catalog.greatest(
    0,
    pg_catalog.floor(
      pg_catalog.extract(epoch from (pg_catalog.now() - v_question.issued_at)) * 1000
    )::integer
  );

  insert into game.learning_attempts (
    game_attempt_id, question_instance_id, question_type, question_purpose,
    source_kind, difficulty, question_tier, answer_mode,
    source_set_id, source_word_id, is_correct,
    timed_out, response_ms, counts_for_rank, counts_for_assignment
  ) values (
    v_question.game_attempt_id, v_question.id, v_question.question_type,
    v_question.question_purpose, v_question.source_kind, v_question.difficulty,
    v_question.question_tier, v_question.answer_mode,
    v_question.source_set_id, v_question.source_word_id, v_is_correct,
    v_timed_out, v_response_ms, v_question.counts_for_rank,
    v_question.counts_for_assignment
  ) returning * into v_learning_attempt;

  insert into game_private.learning_answer_payloads (
    learning_attempt_id, submitted_answer, submitted_answer_hash
  ) values (
    v_learning_attempt.id, p_submitted_answer, v_answer_hash
  );

  insert into game_private.answer_requests (
    request_id, question_instance_id, learning_attempt_id, submitted_answer_hash
  ) values (
    p_request_id, p_question_instance_id, v_learning_attempt.id, v_answer_hash
  );

  update game.game_attempts ga
  set
    official_question_count = ga.official_question_count
      + case when v_question.counts_for_rank then 1 else 0 end,
    official_correct_count = ga.official_correct_count
      + case when v_question.counts_for_rank and v_is_correct then 1 else 0 end,
    assignment_question_count = ga.assignment_question_count
      + case when v_question.counts_for_assignment then 1 else 0 end,
    assignment_correct_count = ga.assignment_correct_count
      + case when v_question.counts_for_assignment and v_is_correct then 1 else 0 end
  where ga.id = v_question.game_attempt_id
    and ga.status = 'in_progress';

  if not found then
    raise exception 'game attempt ended before answer settlement' using errcode = '55000';
  end if;

  update game_private.question_exposures qe
  set
    last_correct_at = case when v_is_correct then pg_catalog.now() else qe.last_correct_at end,
    next_eligible_at = case when v_is_correct
      then pg_catalog.greatest(qe.next_eligible_at, pg_catalog.now() + interval '30 minutes')
      else pg_catalog.now() + interval '5 minutes'
    end
  where qe.user_id = v_identity.authenticated_user_id
    and qe.source_set_id = v_question.source_set_id
    and qe.source_word_id = v_question.source_word_id
    and qe.question_type = v_question.question_type;

  if v_question.counts_for_rank then
    perform game_private.recompute_personal_rank(
      v_identity.authenticated_user_id,
      (select ga.queue from game.game_attempts ga where ga.id = v_question.game_attempt_id),
      v_question.game_attempt_id,
      'official_answer'
    );
  end if;

  return query select
    v_learning_attempt.id, v_learning_attempt.is_correct,
    v_learning_attempt.timed_out, v_question.correct_answers,
    v_question.explanation, v_learning_attempt.counts_for_rank,
    v_learning_attempt.counts_for_assignment,
    case when v_learning_attempt.is_correct then 0 else 10 end,
    true;
end;
$$;

create function game.void_learning_attempt_v1(
  p_game_session_token text,
  p_learning_attempt_id uuid,
  p_reason text,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_learning_attempt game.learning_attempts;
  v_game_attempt game.game_attempts;
  v_input_hash bytea;
  v_correction game_private.correction_requests;
begin
  if p_reason not in ('interrupted', 'server_rollback', 'question_invalid') then
    raise exception 'unsupported causal void reason' using errcode = '22023';
  end if;

  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);

  select la.* into v_learning_attempt
  from game.learning_attempts la
  join game.game_attempts ga on ga.id = la.game_attempt_id
  join game.session_players sp on sp.id = ga.session_player_id
  where la.id = p_learning_attempt_id
    and ga.user_id = v_identity.authenticated_user_id
    and sp.game_auth_session_id = v_identity.auth_session_id
    and ga.status = 'in_progress';

  if not found then
    raise exception 'learning attempt is missing or its game attempt is terminal' using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id is required' using errcode = '22023';
  end if;

  v_input_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'learningAttemptId', p_learning_attempt_id, 'reason', p_reason
  )::text);

  select cr.* into v_correction
  from game_private.correction_requests cr
  where cr.game_attempt_id = v_learning_attempt.game_attempt_id
    and cr.request_id = p_request_id;

  if found then
    if v_correction.input_hash <> v_input_hash
       or v_correction.learning_attempt_id <> p_learning_attempt_id then
      raise exception 'correction request id was reused with different input' using errcode = '22000';
    end if;
    return;
  end if;

  perform 1 from game.game_attempts ga
  where ga.id = v_learning_attempt.game_attempt_id and ga.status = 'in_progress'
  for update;
  if not found then
    raise exception 'game attempt is no longer in progress' using errcode = '55000';
  end if;

  perform 1 from game_private.question_instances qi
  where qi.id = v_learning_attempt.question_instance_id
  for update;

  if v_learning_attempt.causally_voided then
    if v_learning_attempt.causal_void_reason <> p_reason then
      raise exception 'learning attempt was already voided for another reason' using errcode = '22000';
    end if;
    return;
  end if;

  update game.learning_attempts la
  set causally_voided = true, causal_void_reason = p_reason
  where la.id = v_learning_attempt.id and not la.causally_voided;

  update game.game_attempts ga
  set
    official_question_count = pg_catalog.greatest(
      0, ga.official_question_count - case when v_learning_attempt.counts_for_rank then 1 else 0 end
    ),
    official_correct_count = pg_catalog.greatest(
      0, ga.official_correct_count
        - case when v_learning_attempt.counts_for_rank and v_learning_attempt.is_correct then 1 else 0 end
    ),
    assignment_question_count = pg_catalog.greatest(
      0, ga.assignment_question_count
        - case when v_learning_attempt.counts_for_assignment then 1 else 0 end
    ),
    assignment_correct_count = pg_catalog.greatest(
      0, ga.assignment_correct_count
        - case when v_learning_attempt.counts_for_assignment and v_learning_attempt.is_correct then 1 else 0 end
    )
  where ga.id = v_learning_attempt.game_attempt_id
    and ga.status = 'in_progress'
  returning * into v_game_attempt;

  if not found then
    raise exception 'game attempt ended before correction settlement' using errcode = '55000';
  end if;

  insert into game_private.correction_requests (
    game_attempt_id, request_id, input_hash, learning_attempt_id
  ) values (
    v_game_attempt.id, p_request_id, v_input_hash, v_learning_attempt.id
  );

  if v_learning_attempt.counts_for_rank then
    perform game_private.recompute_personal_rank(
      v_identity.authenticated_user_id,
      v_game_attempt.queue,
      v_game_attempt.id,
      'answer_voided'
    );
  end if;
end;
$$;

create function game.record_domain_event_v1(
  p_game_session_token text,
  p_event_id uuid,
  p_game_session_id uuid,
  p_game_attempt_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_existing game.domain_events;
begin
  if p_event_id is null then
    raise exception 'p_event_id is required' using errcode = '22023';
  end if;

  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);

  if not exists (
    select 1
    from game.session_players sp
    where sp.game_session_id = p_game_session_id
      and sp.user_id = v_identity.authenticated_user_id
      and sp.game_auth_session_id = v_identity.auth_session_id
  ) then
    raise exception 'player is not bound to the game session' using errcode = '42501';
  end if;

  if p_game_attempt_id is not null and not exists (
    select 1
    from game.game_attempts ga
    where ga.id = p_game_attempt_id
      and ga.game_session_id = p_game_session_id
      and ga.user_id = v_identity.authenticated_user_id
  ) then
    raise exception 'game attempt is not bound to player/session' using errcode = '42501';
  end if;

  select de.* into v_existing
  from game.domain_events de
  where de.game_session_id = p_game_session_id and de.event_id = p_event_id;

  if found then
    if v_existing.game_attempt_id is distinct from p_game_attempt_id
       or v_existing.event_type <> p_event_type
       or v_existing.payload <> coalesce(p_payload, '{}'::jsonb)
       or v_existing.occurred_at <> p_occurred_at then
      raise exception 'domain event id was reused with different input' using errcode = '22000';
    end if;
    return v_existing.id;
  end if;

  insert into game.domain_events (
    event_id, game_session_id, game_attempt_id, actor_user_id,
    event_type, payload, occurred_at
  ) values (
    p_event_id, p_game_session_id, p_game_attempt_id,
    v_identity.authenticated_user_id, p_event_type,
    coalesce(p_payload, '{}'::jsonb), p_occurred_at
  ) returning id into v_existing.id;

  return v_existing.id;
end;
$$;

create function game.finalize_game_attempt_v1(
  p_game_session_token text,
  p_game_attempt_id uuid,
  p_finalization_request_id uuid,
  p_status text,
  p_outcome text,
  p_max_day integer,
  p_equivalent_day integer,
  p_verified_win boolean,
  p_result_detail jsonb
)
returns table (
  game_attempt_id uuid,
  assignment_completed boolean,
  official_question_count integer,
  official_correct_count integer,
  assignment_question_count integer,
  assignment_correct_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_attempt game.game_attempts;
  v_config public.game_assignment_configs;
  v_assignment_accuracy numeric;
  v_assignment_completed boolean;
  v_input_hash bytea;
begin
  if p_finalization_request_id is null
     or p_status not in ('completed', 'abandoned', 'no_contest', 'terminated')
     or p_outcome not in ('win', 'loss', 'no_contest', 'terminated') then
    raise exception 'invalid finalization input' using errcode = '22023';
  end if;

  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);

  v_input_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'gameAttemptId', p_game_attempt_id, 'status', p_status,
    'outcome', p_outcome, 'maxDay', p_max_day,
    'equivalentDay', p_equivalent_day, 'verifiedWin', p_verified_win,
    'resultDetail', p_result_detail
  )::text);

  select ga.* into v_attempt
  from game.game_attempts ga
  join game.session_players sp on sp.id = ga.session_player_id
  where ga.id = p_game_attempt_id
    and ga.user_id = v_identity.authenticated_user_id
    and sp.game_auth_session_id = v_identity.auth_session_id
  for update of ga;

  if not found then
    raise exception 'game attempt not found for session credential' using errcode = '42501';
  end if;

  if v_attempt.status <> 'in_progress' then
    if v_attempt.finalization_request_id is distinct from p_finalization_request_id
       or v_attempt.finalization_input_hash <> v_input_hash then
      raise exception 'game attempt was already finalized by another request' using errcode = '22000';
    end if;

    return query select
      v_attempt.id, v_attempt.assignment_completed,
      v_attempt.official_question_count, v_attempt.official_correct_count,
      v_attempt.assignment_question_count, v_attempt.assignment_correct_count;
    return;
  end if;

  -- Match answer/correction lock order before changing the terminal state.
  perform 1
  from game_private.question_instances qi
  where qi.game_attempt_id = v_attempt.id
  order by qi.id
  for update;

  if p_verified_win and not (v_attempt.queue = 'zombie' and p_outcome = 'win') then
    raise exception 'verified zombie win requires zombie queue and win outcome' using errcode = '22023';
  end if;

  v_assignment_completed := false;
  if v_attempt.assignment_id is not null then
    select c.* into v_config
    from public.game_assignment_configs c
    where c.assignment_id = v_attempt.assignment_id;

    v_assignment_accuracy := case when v_attempt.assignment_question_count = 0 then 0
      else 100.0 * v_attempt.assignment_correct_count::numeric
        / v_attempt.assignment_question_count::numeric
    end;

    v_assignment_completed :=
      p_max_day >= v_config.minimum_day
      and v_attempt.assignment_question_count >= v_config.minimum_learning_questions
      and v_assignment_accuracy >= v_config.minimum_accuracy;
  end if;

  update game.game_attempts ga
  set
    status = p_status,
    outcome = p_outcome,
    max_day = p_max_day,
    equivalent_day = p_equivalent_day,
    verified_win = coalesce(p_verified_win, false),
    assignment_completed = v_assignment_completed,
    finalization_request_id = p_finalization_request_id,
    finalization_input_hash = v_input_hash,
    result_detail = coalesce(p_result_detail, '{}'::jsonb),
    completed_at = pg_catalog.now()
  where ga.id = v_attempt.id and ga.status = 'in_progress'
  returning * into v_attempt;

  if not found then
    raise exception 'game attempt was finalized concurrently' using errcode = '40001';
  end if;

  perform game_private.recompute_personal_rank(
    v_attempt.user_id, v_attempt.queue, v_attempt.id, 'game_finalized'
  );

  return query select
    v_attempt.id, v_attempt.assignment_completed,
    v_attempt.official_question_count, v_attempt.official_correct_count,
    v_attempt.assignment_question_count, v_attempt.assignment_correct_count;
end;
$$;

create function game.save_session_checkpoint_v1(
  p_game_session_token text,
  p_request_id uuid,
  p_game_session_id uuid,
  p_day_number integer,
  p_phase text,
  p_state_payload jsonb,
  p_ruleset_version text
)
returns table (checkpoint_id uuid, checkpoint_sequence integer, saved_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_session game.game_sessions;
  v_existing game.session_checkpoints;
  v_hash bytea;
begin
  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);

  v_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'gameSessionId', p_game_session_id, 'day', p_day_number,
    'phase', p_phase, 'state', p_state_payload,
    'rulesetVersion', p_ruleset_version
  )::text);

  select gs.* into v_session from game.game_sessions gs
  where gs.id = p_game_session_id for update;

  if not found or v_session.status <> 'active'
     or v_session.ruleset_version <> p_ruleset_version
     or not exists (
       select 1 from game.session_players sp
       where sp.game_session_id = v_session.id
         and sp.game_auth_session_id = v_identity.auth_session_id
     ) then
    raise exception 'active/version-matched game session is not bound to credential'
      using errcode = '42501';
  end if;

  select sc.* into v_existing
  from game.session_checkpoints sc
  where sc.game_session_id = v_session.id and sc.request_id = p_request_id;

  if found then
    if v_existing.input_hash <> v_hash then
      raise exception 'checkpoint request id was reused with different input' using errcode = '22000';
    end if;
    return query select v_existing.id, v_existing.checkpoint_sequence, v_existing.created_at;
    return;
  end if;

  insert into game.session_checkpoints (
    game_session_id, request_id, input_hash, checkpoint_sequence,
    day_number, phase, state_payload, ruleset_version
  ) values (
    v_session.id, p_request_id, v_hash, v_session.checkpoint_sequence + 1,
    p_day_number, p_phase, p_state_payload, p_ruleset_version
  ) returning * into v_existing;

  update game.game_sessions gs
  set checkpoint_sequence = v_existing.checkpoint_sequence,
      last_checkpoint_at = v_existing.created_at
  where gs.id = v_session.id and gs.status = 'active';

  return query select v_existing.id, v_existing.checkpoint_sequence, v_existing.created_at;
end;
$$;

create function game.leave_game_session_v1(
  p_game_session_token text,
  p_request_id uuid,
  p_game_session_id uuid,
  p_reason text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_hash bytea;
  v_previous jsonb;
  v_left_at timestamptz;
begin
  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);

  v_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'gameSessionId', p_game_session_id, 'reason', p_reason
  )::text);
  v_previous := game_private.claim_rpc_request(
    v_identity.authenticated_user_id, 'game.leave_session_v1', p_request_id,
    v_hash, pg_catalog.now() + interval '30 days'
  );
  if v_previous is not null then
    return (v_previous ->> 'leftAt')::timestamptz;
  end if;

  perform 1 from game_private.game_auth_sessions gas
  where gas.id = v_identity.auth_session_id for update;

  v_left_at := pg_catalog.now();
  update game.session_players sp
  set left_at = v_left_at, disconnect_reason = p_reason
  where sp.game_session_id = p_game_session_id
    and sp.game_auth_session_id = v_identity.auth_session_id
    and sp.left_at is null;
  if not found then
    raise exception 'active session player binding not found' using errcode = '42501';
  end if;

  update game_private.game_auth_sessions gas
  set active_game_session_id = null
  where gas.id = v_identity.auth_session_id
    and gas.active_game_session_id = p_game_session_id;

  perform game_private.complete_rpc_request(
    v_identity.authenticated_user_id, 'game.leave_session_v1', p_request_id,
    pg_catalog.jsonb_build_object('leftAt', v_left_at)
  );
  return v_left_at;
end;
$$;

create function game.end_game_session_v1(
  p_game_session_token text,
  p_request_id uuid,
  p_game_session_id uuid,
  p_status text,
  p_reason text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_session game.game_sessions;
  v_hash bytea;
  v_previous jsonb;
  v_ended_at timestamptz;
begin
  if p_status not in ('completed', 'terminated', 'expired') then
    raise exception 'unsupported terminal room status' using errcode = '22023';
  end if;

  select * into v_identity
  from game_private.resolve_game_auth_session(p_game_session_token);
  v_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'gameSessionId', p_game_session_id, 'status', p_status, 'reason', p_reason
  )::text);
  v_previous := game_private.claim_rpc_request(
    v_identity.authenticated_user_id, 'game.end_session_v1', p_request_id,
    v_hash, pg_catalog.now() + interval '30 days'
  );
  if v_previous is not null then
    return (v_previous ->> 'endedAt')::timestamptz;
  end if;

  select gs.* into v_session from game.game_sessions gs
  where gs.id = p_game_session_id for update;

  if not found or not exists (
    select 1 from game.session_players sp
    where sp.game_session_id = v_session.id
      and sp.game_auth_session_id = v_identity.auth_session_id
  ) then
    raise exception 'game session is not bound to credential' using errcode = '42501';
  end if;

  if v_session.status <> 'active' then
    if v_session.status <> p_status or v_session.termination_reason is distinct from p_reason then
      raise exception 'game session already ended with different input' using errcode = '22000';
    end if;
    v_ended_at := v_session.ended_at;
  else
    if exists (
      select 1 from game.game_attempts ga
      where ga.game_session_id = v_session.id and ga.status = 'in_progress'
    ) then
      raise exception 'all player attempts must be finalized before ending the room'
        using errcode = '55000';
    end if;
    v_ended_at := pg_catalog.now();
    update game.game_sessions gs
    set status = p_status, ended_at = v_ended_at, termination_reason = p_reason
    where gs.id = v_session.id and gs.status = 'active';
  end if;

  update game.session_players sp
  set left_at = coalesce(sp.left_at, v_ended_at),
      disconnect_reason = coalesce(sp.disconnect_reason, 'room_' || p_status)
  where sp.game_session_id = v_session.id;

  update game_private.game_auth_sessions gas
  set active_game_session_id = null
  where gas.active_game_session_id = v_session.id;

  perform game_private.complete_rpc_request(
    v_identity.authenticated_user_id, 'game.end_session_v1', p_request_id,
    pg_catalog.jsonb_build_object('endedAt', v_ended_at)
  );
  return v_ended_at;
end;
$$;

-- ============================================================================
-- Browser reports: self or teacher-owned students only
-- ============================================================================

create function public.get_my_game_profile_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null or not game_private.user_is_ready(v_user_id) then
    raise exception 'account is not ready' using errcode = '28000';
  end if;

  return pg_catalog.jsonb_build_object(
    'rankPolicy', pg_catalog.jsonb_build_object(
      'placementQuestions', 35,
      'rollingOfficialQuestions', 70,
      'survivor', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('tier', 'silver', 'equivalentDay', 6, 'accuracy', 65),
        pg_catalog.jsonb_build_object('tier', 'gold', 'equivalentDay', 12, 'accuracy', 70),
        pg_catalog.jsonb_build_object('tier', 'platinum', 'equivalentDay', 20, 'accuracy', 75),
        pg_catalog.jsonb_build_object('tier', 'diamond', 'equivalentDay', 25, 'accuracy', 85),
        pg_catalog.jsonb_build_object('tier', 'master', 'equivalentDay', 30, 'accuracy', 90),
        pg_catalog.jsonb_build_object('tier', 'mythic', 'equivalentDay', 50, 'accuracy', 95)
      ),
      'zombie', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('tier', 'silver', 'verifiedWins', 3, 'accuracy', 65),
        pg_catalog.jsonb_build_object('tier', 'gold', 'verifiedWins', 6, 'accuracy', 70),
        pg_catalog.jsonb_build_object('tier', 'platinum', 'verifiedWins', 12, 'accuracy', 75),
        pg_catalog.jsonb_build_object('tier', 'diamond', 'verifiedWins', 20, 'accuracy', 85),
        pg_catalog.jsonb_build_object('tier', 'master', 'verifiedWins', 30, 'accuracy', 90),
        pg_catalog.jsonb_build_object('tier', 'mythic', 'verifiedWins', 50, 'accuracy', 95)
      )
    ),
    'ranks', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'queue', prs.queue,
          'tier', prs.tier,
          'placementStatus', prs.placement_status,
          'officialAccuracy', prs.official_accuracy,
          'sampleSize', prs.sample_size,
          'highestEquivalentDay', prs.highest_equivalent_day,
          'verifiedWins', prs.verified_wins,
          'updatedAt', prs.updated_at
        ) order by prs.queue
      )
      from game.personal_rank_snapshots prs
      where prs.user_id = v_user_id
    ), '[]'::jsonb),
    'learningBreakdown', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(stats) order by stats.question_type, stats.difficulty, stats.question_tier, stats.answer_mode)
      from (
        select
          la.question_type,
          la.difficulty,
          la.question_tier,
          la.answer_mode,
          count(*)::integer as attempt_count,
          count(*) filter (where la.is_correct)::integer as correct_count,
          pg_catalog.round(
            100.0 * count(*) filter (where la.is_correct)::numeric / count(*)::numeric,
            2
          ) as accuracy,
          max(la.answered_at) as last_answered_at
        from game.learning_attempts la
        join game.game_attempts ga on ga.id = la.game_attempt_id
        where ga.user_id = v_user_id and not la.causally_voided
        group by la.question_type, la.difficulty, la.question_tier, la.answer_mode
      ) stats
    ), '[]'::jsonb),
    'recentAttempts', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(recent) order by recent.completed_at desc)
      from (
        select
          ga.id,
          ga.assignment_id,
          ga.queue,
          ga.status,
          ga.outcome,
          ga.max_day,
          ga.equivalent_day,
          ga.assignment_completed,
          ga.completed_at
        from game.game_attempts ga
        where ga.user_id = v_user_id
        order by ga.completed_at desc nulls last, ga.created_at desc
        limit 20
      ) recent
    ), '[]'::jsonb)
  );
end;
$$;

create function public.get_teacher_game_report_v1(p_student_id uuid default null)
returns table (
  student_id uuid,
  student_name text,
  report jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'caller is not an active teacher' using errcode = '28000';
  end if;

  if p_student_id is not null and not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.teacher_id = v_teacher_id
  ) then
    raise exception 'student not found or not owned by caller' using errcode = '42501';
  end if;

  return query
  select
    s.id,
    p.full_name,
    pg_catalog.jsonb_build_object(
      'ranks', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'queue', prs.queue,
            'tier', prs.tier,
            'placementStatus', prs.placement_status,
            'officialAccuracy', prs.official_accuracy,
            'sampleSize', prs.sample_size,
            'highestEquivalentDay', prs.highest_equivalent_day,
            'verifiedWins', prs.verified_wins,
            'updatedAt', prs.updated_at
          ) order by prs.queue
        )
        from game.personal_rank_snapshots prs
        where prs.user_id = s.id
      ), '[]'::jsonb),
      'learningBreakdown', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(stats) order by stats.question_type, stats.difficulty, stats.question_tier, stats.answer_mode)
        from (
          select
            la.question_type,
            la.difficulty,
            la.question_tier,
            la.answer_mode,
            count(*)::integer as attempt_count,
            count(*) filter (where la.is_correct)::integer as correct_count,
            pg_catalog.round(
              100.0 * count(*) filter (where la.is_correct)::numeric / count(*)::numeric,
              2
            ) as accuracy,
            max(la.answered_at) as last_answered_at
          from game.learning_attempts la
          join game.game_attempts ga on ga.id = la.game_attempt_id
          where ga.user_id = s.id and not la.causally_voided
          group by la.question_type, la.difficulty, la.question_tier, la.answer_mode
        ) stats
      ), '[]'::jsonb),
      'assignmentAttempts', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(attempts) order by attempts.completed_at desc)
        from (
          select
            ga.id,
            ga.assignment_id,
            ga.queue,
            ga.status,
            ga.outcome,
            ga.max_day,
            ga.assignment_question_count,
            ga.assignment_correct_count,
            ga.assignment_completed,
            ga.completed_at
          from game.game_attempts ga
          join public.assignments a on a.id = ga.assignment_id
          where ga.user_id = s.id and a.teacher_id = v_teacher_id
          order by ga.completed_at desc nulls last, ga.created_at desc
          limit 50
        ) attempts
      ), '[]'::jsonb)
    )
  from public.students s
  join public.profiles p on p.id = s.id
  where s.teacher_id = v_teacher_id
    and (p_student_id is null or s.id = p_student_id)
  order by p.full_name, s.id;
end;
$$;

create function public.get_game_assignment_completion_v1(
  p_assignment_ids uuid[],
  p_student_id uuid default null
)
returns table (
  assignment_id uuid,
  student_id uuid,
  completed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_teacher_id uuid;
  v_student_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  if p_assignment_ids is null
     or pg_catalog.cardinality(p_assignment_ids) = 0
     or pg_catalog.cardinality(p_assignment_ids) > 200
     or pg_catalog.array_position(p_assignment_ids, null) is not null then
    raise exception 'p_assignment_ids must contain 1..200 non-null ids' using errcode = '22023';
  end if;

  v_caller_id := (select auth.uid());
  v_teacher_id := private.current_teacher_id();
  v_student_id := private.current_student_id();

  if v_student_id is not null then
    if p_student_id is not null and p_student_id <> v_student_id then
      raise exception 'student callers can request only their own completion state' using errcode = '42501';
    end if;

    return query
    select
      requested.assignment_id,
      v_student_id,
      exists (
        select 1 from game.game_attempts ga
        where ga.assignment_id = requested.assignment_id
          and ga.user_id = v_student_id
          and ga.assignment_completed
          and ga.status = 'completed'
      )
    from (
      select distinct requested_id as assignment_id
      from pg_catalog.unnest(p_assignment_ids) requested_id
    ) requested
    join public.assignments a on a.id = requested.assignment_id
    where a.assignment_kind = 'game'
      and private.can_view_assignment(a.id)
    order by requested.assignment_id;
    return;
  end if;

  if v_teacher_id is null then
    raise exception 'caller is neither an active student nor teacher' using errcode = '28000';
  end if;

  if p_student_id is not null and not private.teacher_owns_student(p_student_id) then
    raise exception 'student not found or not owned by caller' using errcode = '42501';
  end if;

  return query
  select
    requested.assignment_id,
    s.id,
    exists (
      select 1 from game.game_attempts ga
      where ga.assignment_id = requested.assignment_id
        and ga.user_id = s.id
        and ga.assignment_completed
        and ga.status = 'completed'
    )
  from (
    select distinct requested_id as assignment_id
    from pg_catalog.unnest(p_assignment_ids) requested_id
  ) requested
  join public.assignments a
    on a.id = requested.assignment_id
    and a.assignment_kind = 'game'
    and a.teacher_id = v_teacher_id
  join public.students s
    on s.teacher_id = v_teacher_id
    and (p_student_id is null or s.id = p_student_id)
  where game_private.user_can_access_game_assignment(s.id, a.id)
  order by requested.assignment_id, s.id;
end;
$$;

comment on function public.get_game_assignment_completion_v1(uuid[], uuid) is
  'Typed main-site adapter: students see self only; teachers see only owned, currently eligible students for requested visible game assignments. Never returns a leaderboard.';

-- ============================================================================
-- Retention: private payload deletion plus explicit aggregate anonymization
-- ============================================================================

create function public.purge_expired_game_private_data_v1(
  p_before timestamptz,
  p_limit integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_count integer := 0;
  v_attempt_count integer := 0;
  v_history_count integer := 0;
  v_snapshot_count integer := 0;
  v_session_count integer := 0;
  v_auth_count integer := 0;
  v_ticket_count integer := 0;
begin
  if p_request_id is null
     or p_before is null
     or p_before > pg_catalog.now()
     or p_limit not between 1 and 10000 then
    raise exception 'invalid retention request' using errcode = '22023';
  end if;

  with expired_attempts as (
    select ga.id
    from game.game_attempts ga
    where ga.retention_until <= p_before
      and ga.personal_data_deleted_at is null
    order by ga.retention_until, ga.id
    limit p_limit
    for update skip locked
  ), deleted_questions as (
    delete from game_private.question_instances qi
    using expired_attempts ea
    where qi.game_attempt_id = ea.id
    returning qi.id
  )
  select count(*)::integer into v_question_count from deleted_questions;

  with expired_attempts as (
    select ga.id
    from game.game_attempts ga
    where ga.retention_until <= p_before
      and ga.personal_data_deleted_at is null
    order by ga.retention_until, ga.id
    limit p_limit
    for update skip locked
  ), anonymized_attempts as (
    update game.game_attempts ga
    set user_id = null, personal_data_deleted_at = pg_catalog.now()
    from expired_attempts ea
    where ga.id = ea.id
    returning ga.id
  )
  select count(*)::integer into v_attempt_count from anonymized_attempts;

  update game.session_players sp
  set user_id = null, game_auth_session_id = null
  where sp.user_id is not null
    and exists (
      select 1 from game.game_attempts ga
      where ga.session_player_id = sp.id and ga.personal_data_deleted_at is not null
    );

  update game.domain_events de
  set actor_user_id = null
  where de.actor_user_id is not null
    and exists (
      select 1 from game.game_sessions gs
      where gs.id = de.game_session_id and gs.retention_until <= p_before
    );

  with expired_history as (
    select prh.id
    from game.personal_rank_history prh
    where prh.retention_until <= p_before
      and prh.personal_data_deleted_at is null
    order by prh.retention_until, prh.id
    limit p_limit
    for update skip locked
  ), anonymized_history as (
    update game.personal_rank_history prh
    set user_id = null, personal_data_deleted_at = pg_catalog.now()
    from expired_history eh
    where prh.id = eh.id
    returning prh.id
  )
  select count(*)::integer into v_history_count from anonymized_history;

  with deleted_snapshots as (
    delete from game.personal_rank_snapshots prs
    where prs.ctid in (
      select selected.ctid
      from game.personal_rank_snapshots selected
      where selected.retention_until <= p_before
      order by selected.retention_until
      limit p_limit
      for update skip locked
    )
    returning prs.user_id
  )
  select count(*)::integer into v_snapshot_count from deleted_snapshots;

  with expired_sessions as (
    select gs.id
    from game.game_sessions gs
    where gs.retention_until <= p_before
      and gs.personal_data_deleted_at is null
    order by gs.retention_until, gs.id
    limit p_limit
    for update skip locked
  ), anonymized_sessions as (
    update game.game_sessions gs
    set host_user_id = null, personal_data_deleted_at = pg_catalog.now()
    from expired_sessions es
    where gs.id = es.id
    returning gs.id
  )
  select count(*)::integer into v_session_count from anonymized_sessions;

  with deleted_auth as (
    delete from game_private.game_auth_sessions gas
    where gas.ctid in (
      select selected.ctid
      from game_private.game_auth_sessions selected
      where selected.expires_at <= p_before
      order by selected.expires_at
      limit p_limit
      for update skip locked
    )
    returning gas.id
  )
  select count(*)::integer into v_auth_count from deleted_auth;

  with deleted_tickets as (
    delete from game_private.launch_tickets lt
    where lt.ctid in (
      select selected.ctid
      from game_private.launch_tickets selected
      where selected.expires_at <= p_before
        and not exists (
          select 1 from game_private.game_auth_sessions gas
          where gas.launch_ticket_id = selected.id
        )
      order by selected.expires_at
      limit p_limit
      for update skip locked
    )
    returning lt.id
  )
  select count(*)::integer into v_ticket_count from deleted_tickets;

  insert into public.audit_log (
    actor_user_id, actor_type, action, target_table, request_id, outcome, detail
  ) values (
    null, 'system', 'game.retention.purge', 'game_private', p_request_id,
    'succeeded', pg_catalog.jsonb_build_object(
      'questionsDeleted', v_question_count,
      'attemptsAnonymized', v_attempt_count,
      'rankHistoryAnonymized', v_history_count,
      'rankSnapshotsDeleted', v_snapshot_count,
      'sessionsAnonymized', v_session_count,
      'authSessionsDeleted', v_auth_count,
      'launchTicketsDeleted', v_ticket_count
    )
  );

  return pg_catalog.jsonb_build_object(
    'questionsDeleted', v_question_count,
    'attemptsAnonymized', v_attempt_count,
    'rankHistoryAnonymized', v_history_count,
    'rankSnapshotsDeleted', v_snapshot_count,
    'sessionsAnonymized', v_session_count,
    'authSessionsDeleted', v_auth_count,
    'launchTicketsDeleted', v_ticket_count
  );
end;
$$;

-- ============================================================================
-- Final ownership and least-privilege execution matrix
-- ============================================================================

grant usage on schema auth, private to game_api_owner;
grant execute on function private.current_teacher_id() to game_api_owner;
grant execute on function private.current_student_id() to game_api_owner;
grant execute on function private.is_ready_profile() to game_api_owner;
grant execute on function private.teacher_owns_student(uuid) to game_api_owner;

do $ownership$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('game', 'game_private')
  loop
    execute pg_catalog.format('alter function %s owner to game_api_owner', v_function);
  end loop;

  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_and_publish_game_assignment_v1',
        'set_game_assignment_accommodation_v1',
        'issue_game_launch_ticket_v1',
        'revoke_game_sessions_v1',
        'get_my_game_profile_v1',
        'get_teacher_game_report_v1',
        'get_game_assignment_completion_v1',
        'purge_expired_game_private_data_v1'
      )
  loop
    execute pg_catalog.format('alter function %s owner to game_api_owner', v_function);
  end loop;
end
$ownership$;

revoke create on schema public from game_api_owner;

revoke execute on all functions in schema game, game_private
  from public, anon, authenticated, service_role, game_server;

-- Revoke every P0 public RPC from every API/runtime role first, then grant
-- by an explicit name whitelist. Catalog-derived regprocedure identities
-- keep this matrix correct when a signature intentionally evolves while
-- still refusing any unlisted function.
do $rpc_grants$
declare
  v_function regprocedure;
  v_name text;
begin
  for v_function, v_name in
    select p.oid::regprocedure, p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_and_publish_game_assignment_v1',
        'set_game_assignment_accommodation_v1',
        'issue_game_launch_ticket_v1',
        'revoke_game_sessions_v1',
        'get_my_game_profile_v1',
        'get_teacher_game_report_v1',
        'get_game_assignment_completion_v1',
        'purge_expired_game_private_data_v1'
      )
  loop
    execute pg_catalog.format(
      'revoke execute on function %s from public, anon, authenticated, service_role, game_server',
      v_function
    );

    if v_name in (
      'create_and_publish_game_assignment_v1',
      'set_game_assignment_accommodation_v1',
      'issue_game_launch_ticket_v1',
      'get_my_game_profile_v1',
      'get_teacher_game_report_v1',
      'get_game_assignment_completion_v1'
    ) then
      execute pg_catalog.format('grant execute on function %s to authenticated', v_function);
    elsif v_name in ('revoke_game_sessions_v1', 'purge_expired_game_private_data_v1') then
      execute pg_catalog.format('grant execute on function %s to service_role', v_function);
    end if;
  end loop;

  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'game'
      and p.proname in (
        'redeem_game_launch_ticket_v1',
        'validate_game_session_v1',
        'authorize_game_join_v1',
        'freeze_question_v1',
        'submit_game_answer_v1',
        'void_learning_attempt_v1',
        'record_domain_event_v1',
        'finalize_game_attempt_v1',
        'save_session_checkpoint_v1',
        'leave_game_session_v1',
        'end_game_session_v1'
      )
  loop
    execute pg_catalog.format('grant execute on function %s to game_server', v_function);
  end loop;
end
$rpc_grants$;

alter default privileges for role game_api_owner in schema game
  revoke execute on functions from public;
alter default privileges for role game_api_owner in schema game_private
  revoke execute on functions from public;
alter default privileges for role game_api_owner in schema game
  revoke all on tables from public, anon, authenticated, service_role, game_server;
alter default privileges for role game_api_owner in schema game_private
  revoke all on tables from public, anon, authenticated, service_role, game_server;

do $drop_temporary_membership$
begin
  execute pg_catalog.format('revoke game_api_owner from %I', current_user);
end
$drop_temporary_membership$;
