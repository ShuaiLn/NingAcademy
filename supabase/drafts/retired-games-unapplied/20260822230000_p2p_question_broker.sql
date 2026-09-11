-- Production P2P question broker and immutable assignment-requirement handoff.
--
-- Each browser keeps its own opaque HttpOnly Games session. A member may
-- freeze/answer/finalize only the attempt owned by that session. The elected
-- Host may verify opaque question/settlement/finalization proof ids for room
-- members, and may settle an already-expired timeout, but never submits a
-- peer's answer or receives an expected answer.

do $roles$
begin
  execute pg_catalog.format(
    'grant game_api_owner to %I granted by %I',
    current_user,
    current_user
  );
end
$roles$;

-- The new private requirement table references the main assignment row. Keep
-- this privilege only for DDL and remove it before the migration finishes.
grant references (id) on public.assignments to game_api_owner;

set role game_api_owner;

alter table public.game_assignment_configs
  add column enabled_question_nodes text[] not null
  default array['DAY_START', 'ZOMBIE_CARD']::text[];

alter table public.game_assignment_configs
  add constraint game_assignment_configs_question_nodes_valid check (
    cardinality(enabled_question_nodes) between 1 and 2
    and array_ndims(enabled_question_nodes) = 1
    and array_lower(enabled_question_nodes, 1) = 1
    and enabled_question_nodes <@ array['DAY_START', 'ZOMBIE_CARD']::text[]
    and array_position(enabled_question_nodes, null) is null
    and (cardinality(enabled_question_nodes) = 1
      or enabled_question_nodes[1] <> enabled_question_nodes[2])
  );

comment on column public.game_assignment_configs.enabled_question_nodes is
  'Formal Question Gameplay node kinds enabled for newly frozen assignment versions.';

alter table game_private.p2p_rooms
  add column academic_game_session_id uuid
  references game.game_sessions (id) on delete restrict;

create unique index p2p_rooms_academic_game_session_idx
  on game_private.p2p_rooms (academic_game_session_id)
  where academic_game_session_id is not null;

alter table game.game_attempts
  add column p2p_member_id uuid
  references game_private.p2p_members (id) on delete set null;

alter table game.game_attempts
  add column assignment_version_id uuid;

alter table game.game_attempts
  add constraint game_attempts_assignment_version_fk
  foreign key (assignment_version_id, assignment_id)
  references public.game_assignment_versions (id, game_assignment_id)
  on delete restrict;

alter table game.game_attempts
  add constraint game_attempts_assignment_version_pair check (
    assignment_version_id is null or assignment_id is not null
  );

create unique index game_attempts_p2p_member_idx
  on game.game_attempts (p2p_member_id)
  where p2p_member_id is not null;

create table game_private.p2p_attempt_requirements (
  game_attempt_id uuid primary key
    references game.game_attempts (id) on delete cascade,
  room_id uuid not null references game_private.p2p_rooms (id) on delete cascade,
  member_id uuid not null references game_private.p2p_members (id) on delete cascade,
  assignment_id uuid not null references public.assignments (id) on delete restrict,
  assignment_version_id uuid not null,
  assignment_version_no integer not null check (assignment_version_no > 0),
  minimum_day integer not null check (minimum_day between 1 and 200),
  minimum_question_count integer not null check (minimum_question_count between 1 and 500),
  minimum_accuracy numeric(5,2) not null check (minimum_accuracy between 0 and 100),
  enabled_question_nodes text[] not null,
  learning_difficulty text not null check (learning_difficulty in ('easy', 'standard', 'hard')),
  timing_mode text not null check (timing_mode in ('standard', 'extended', 'untimed')),
  timing_multiplier numeric(3,1) not null,
  requirements_hash bytea not null check (octet_length(requirements_hash) = 32),
  authorization_expires_at timestamptz not null,
  frozen_at timestamptz not null default now(),
  unique (room_id, member_id),
  foreign key (assignment_version_id, assignment_id)
    references public.game_assignment_versions (id, game_assignment_id)
    on delete restrict,
  constraint p2p_attempt_requirements_nodes check (
    cardinality(enabled_question_nodes) between 1 and 2
    and array_ndims(enabled_question_nodes) = 1
    and array_lower(enabled_question_nodes, 1) = 1
    and enabled_question_nodes <@ array['DAY_START', 'ZOMBIE_CARD']::text[]
    and array_position(enabled_question_nodes, null) is null
    and (cardinality(enabled_question_nodes) = 1
      or enabled_question_nodes[1] <> enabled_question_nodes[2])
  ),
  constraint p2p_attempt_requirements_timing check (
    (timing_mode = 'untimed' and timing_multiplier = 1.0)
    or (timing_mode <> 'untimed' and timing_multiplier in (1.0, 1.5, 2.0, 3.0))
  )
);

create table game_private.p2p_question_bindings (
  game_attempt_id uuid not null
    references game.game_attempts (id) on delete cascade,
  room_id uuid not null references game_private.p2p_rooms (id) on delete cascade,
  member_id uuid not null references game_private.p2p_members (id) on delete cascade,
  node_id text not null,
  node_kind text not null check (node_kind in ('DAY_START', 'ZOMBIE_CARD')),
  day_number integer not null check (day_number between 1 and 10000),
  node_sequence integer not null check (node_sequence >= 0),
  question_revision integer not null check (question_revision > 0),
  issue_request_id uuid not null unique,
  issue_input_hash bytea not null check (octet_length(issue_input_hash) = 32),
  question_instance_id uuid not null unique
    references game_private.question_instances (id) on delete cascade,
  frozen_at timestamptz not null default now(),
  primary key (game_attempt_id, node_id),
  unique (room_id, member_id, node_sequence),
  constraint p2p_question_bindings_node_id check (
    char_length(node_id) between 1 and 128
  )
);

create table game_private.p2p_run_results (
  room_id uuid primary key references game_private.p2p_rooms (id) on delete cascade,
  recorded_by_member_id uuid not null
    references game_private.p2p_members (id) on delete cascade,
  request_id uuid not null unique,
  input_hash bytea not null check (octet_length(input_hash) = 32),
  topology_epoch integer not null check (topology_epoch > 0),
  checkpoint_sequence bigint not null check (checkpoint_sequence > 0),
  run_status text not null check (run_status in ('completed', 'failed')),
  max_day integer not null check (max_day between 1 and 10000),
  equivalent_day integer not null check (equivalent_day between 0 and 10000),
  recorded_at timestamptz not null default now()
);

comment on table game_private.p2p_attempt_requirements is
  'Attempt-frozen academic requirements. Deleted by the existing P2P room purge; the durable game_attempt retains final aggregates/version.';
comment on table game_private.p2p_question_bindings is
  'Opaque P2P node-to-question proof bindings. Deleted by the existing P2P room purge; question/answer retention remains attempt-scoped.';
comment on table game_private.p2p_run_results is
  'Checkpoint-correlated terminal Run evidence. Deleted by the existing P2P room purge after finalization has copied durable aggregates.';

revoke all on game_private.p2p_attempt_requirements,
  game_private.p2p_question_bindings,
  game_private.p2p_run_results
  from public, anon, authenticated, service_role, game_server, games_api;

-- Peers poll the same gameplay checkpoint, but receive only their own
-- academic branch. The newly elected Host is selected inside v1 before this
-- projection decision, so Host migration still receives the complete state.
create function game.poll_p2p_room_v2(
  p_game_session_token text,
  p_room_id uuid,
  p_after_signal_id bigint default 0
)
returns table (
  room_id uuid,
  room_code text,
  member_id uuid,
  host_member_id uuid,
  room_status text,
  max_players smallint,
  topology_epoch integer,
  members jsonb,
  signals jsonb,
  checkpoint_sequence bigint,
  checkpoint_payload jsonb,
  force_exit_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poll record;
  v_checkpoint jsonb;
  v_own_learning jsonb;
begin
  select * into v_poll
  from game.poll_p2p_room_v1(
    p_game_session_token,
    p_room_id,
    p_after_signal_id
  );

  v_checkpoint := v_poll.checkpoint_payload;
  if v_checkpoint is not null
     and v_poll.member_id is distinct from v_poll.host_member_id
     and pg_catalog.jsonb_typeof(v_checkpoint #> '{learning,players}') = 'object' then
    v_own_learning := v_checkpoint #> array[
      'learning', 'players', v_poll.member_id::text
    ];
    v_checkpoint := pg_catalog.jsonb_set(
      v_checkpoint,
      '{learning,players}',
      case when v_own_learning is null then '{}'::jsonb
        else pg_catalog.jsonb_build_object(v_poll.member_id::text, v_own_learning)
      end,
      false
    );
    v_checkpoint := pg_catalog.jsonb_set(
      v_checkpoint,
      '{learning,configuration}',
      'null'::jsonb,
      true
    );
  end if;

  return query select
    v_poll.room_id,
    v_poll.room_code,
    v_poll.member_id,
    v_poll.host_member_id,
    v_poll.room_status,
    v_poll.max_players,
    v_poll.topology_epoch,
    v_poll.members,
    v_poll.signals,
    v_poll.checkpoint_sequence,
    v_checkpoint,
    v_poll.force_exit_at,
    v_poll.expires_at;
end;
$$;

create function game_private.ensure_p2p_game_attempt(
  p_room_id uuid,
  p_member_id uuid
)
returns table (
  game_attempt_id uuid,
  assignment_version_id uuid,
  requirements_revision integer
)
language plpgsql
set search_path = ''
as $$
declare
  v_room game_private.p2p_rooms;
  v_member game_private.p2p_members;
  v_auth game_private.game_auth_sessions;
  v_version public.game_assignment_versions;
  v_accommodation public.game_assignment_accommodations;
  v_game_session game.game_sessions;
  v_session_player game.session_players;
  v_attempt game.game_attempts;
  v_requirements game_private.p2p_attempt_requirements;
  v_enabled_nodes text[];
  v_timing_mode text;
  v_timing_multiplier numeric(3,1);
  v_retention_until timestamptz;
  v_hash bytea;
begin
  select r.* into v_room
  from game_private.p2p_rooms r
  where r.id = p_room_id
  for update;

  if not found or v_room.status = 'ended' or v_room.expires_at <= pg_catalog.now() then
    raise exception 'active P2P room is required' using errcode = '28000';
  end if;

  select m.* into v_member
  from game_private.p2p_members m
  where m.id = p_member_id
    and m.room_id = p_room_id
    and m.left_at is null
    and m.reconnect_until > pg_catalog.now()
  for update;

  if not found then
    raise exception 'active target P2P member is required' using errcode = '28000';
  end if;

  select gas.* into v_auth
  from game_private.game_auth_sessions gas
  where gas.id = v_member.game_auth_session_id
    and gas.user_id = v_member.user_id
    and gas.assignment_id = v_room.assignment_id
    and gas.revoked_at is null
    and gas.expires_at > pg_catalog.now()
  for update;

  if not found then
    raise exception 'target member academic authorization is invalid or expired'
      using errcode = '28000';
  end if;

  select req.* into v_requirements
  from game_private.p2p_attempt_requirements req
  where req.room_id = p_room_id and req.member_id = p_member_id;

  if found then
    if v_auth.assignment_version_id is distinct from
         v_requirements.assignment_version_id then
      raise exception 'reauthorized member is bound to a different assignment version'
        using errcode = '28000';
    end if;

    update game.session_players sp
    set game_auth_session_id = v_auth.id,
        left_at = null,
        disconnect_reason = null
    where sp.id = (
      select ga.session_player_id
      from game.game_attempts ga
      where ga.id = v_requirements.game_attempt_id
    );

    update game_private.p2p_attempt_requirements req
    set authorization_expires_at = v_auth.expires_at
    where req.game_attempt_id = v_requirements.game_attempt_id;

    return query select
      v_requirements.game_attempt_id,
      v_requirements.assignment_version_id,
      v_requirements.assignment_version_no;
    return;
  end if;

  select v.* into v_version
  from public.game_assignment_versions v
  where v.id = v_auth.assignment_version_id
    and v.game_assignment_id = v_room.assignment_id;

  if not found then
    raise exception 'authorized immutable assignment version is unavailable'
      using errcode = '28000';
  end if;

  v_enabled_nodes := case
    when pg_catalog.jsonb_typeof(v_version.config_snapshot -> 'enabled_question_nodes') = 'array'
      then array(
        select pg_catalog.jsonb_array_elements_text(
          v_version.config_snapshot -> 'enabled_question_nodes'
        )
      )
    else array['DAY_START', 'ZOMBIE_CARD']::text[]
  end;

  if cardinality(v_enabled_nodes) not between 1 and 2
     or not (v_enabled_nodes <@ array['DAY_START', 'ZOMBIE_CARD']::text[])
     or array_position(v_enabled_nodes, null) is not null
     or (cardinality(v_enabled_nodes) = 2
       and v_enabled_nodes[1] = v_enabled_nodes[2]) then
    raise exception 'immutable assignment version has invalid Question node configuration'
      using errcode = '22023';
  end if;

  select ac.* into v_accommodation
  from public.game_assignment_accommodations ac
  where ac.assignment_id = v_room.assignment_id
    and ac.student_id = v_member.user_id;

  v_timing_mode := coalesce(v_accommodation.timing_mode, 'standard');
  v_timing_multiplier := case
    when v_timing_mode = 'untimed' then 1.0
    when v_timing_mode = 'extended' then v_accommodation.timing_multiplier
    else (v_version.config_snapshot ->> 'timing_multiplier')::numeric
  end;
  v_retention_until := (v_version.config_snapshot ->> 'retention_until')::timestamptz;

  if v_retention_until is null
     or v_retention_until <= pg_catalog.now()
     or not coalesce((v_version.config_snapshot -> 'allowed_modes') ? 'coop', false)
     or v_room.ruleset_version <> v_version.config_snapshot ->> 'ruleset_version' then
    raise exception 'immutable assignment version is expired, not cooperative, or does not match room ruleset'
      using errcode = '28000';
  end if;

  if v_room.academic_game_session_id is null then
    insert into game.game_sessions (
      room_id, host_user_id, mode, map_key, protocol_version,
      simulation_version, ruleset_version, content_release_id, region,
      retention_until
    ) values (
      'p2p_' || pg_catalog.replace(v_room.id::text, '-', ''),
      (
        select host.user_id from game_private.p2p_members host
        where host.id = v_room.host_member_id
      ),
      'coop',
      v_version.config_snapshot ->> 'map_key',
      v_room.protocol_version::text,
      'host-p2p-v1',
      v_room.ruleset_version,
      v_version.config_snapshot ->> 'content_release_id',
      'global',
      v_retention_until
    ) returning * into v_game_session;

    update game_private.p2p_rooms r
    set academic_game_session_id = v_game_session.id,
        updated_at = pg_catalog.now()
    where r.id = v_room.id;
  else
    select gs.* into v_game_session
    from game.game_sessions gs
    where gs.id = v_room.academic_game_session_id
    for update;

    if not found
       or v_game_session.status <> 'active'
       or v_game_session.map_key <> v_version.config_snapshot ->> 'map_key'
       or v_game_session.ruleset_version <> v_version.config_snapshot ->> 'ruleset_version'
       or v_game_session.content_release_id
         <> v_version.config_snapshot ->> 'content_release_id' then
      raise exception 'P2P academic game session is unavailable or version-incompatible'
        using errcode = '55000';
    end if;
  end if;

  insert into game.session_players (
    game_session_id, user_id, game_auth_session_id, player_side
  ) values (
    v_game_session.id, v_member.user_id, v_auth.id, 'survivor'
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
    assignment_version_id, p2p_member_id, queue, rank_eligible,
    retention_until
  ) values (
    v_game_session.id, v_session_player.id, v_member.user_id,
    v_room.assignment_id, v_version.id, v_member.id,
    'coop_survivor', false, v_retention_until
  ) returning * into v_attempt;

  v_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'assignmentId', v_room.assignment_id,
    'assignmentVersionId', v_version.id,
    'assignmentVersionNo', v_version.version_no,
    'minimumDay', (v_version.config_snapshot ->> 'minimum_day')::integer,
    'minimumQuestionCount',
      (v_version.config_snapshot ->> 'minimum_learning_questions')::integer,
    'minimumAccuracy', (v_version.config_snapshot ->> 'minimum_accuracy')::numeric,
    'enabledQuestionNodes', v_enabled_nodes,
    'learningDifficulty', v_version.config_snapshot ->> 'learning_difficulty',
    'timingMode', v_timing_mode,
    'timingMultiplier', v_timing_multiplier
  )::text);

  insert into game_private.p2p_attempt_requirements (
    game_attempt_id, room_id, member_id, assignment_id,
    assignment_version_id, assignment_version_no, minimum_day,
    minimum_question_count, minimum_accuracy, enabled_question_nodes,
    learning_difficulty, timing_mode, timing_multiplier,
    requirements_hash, authorization_expires_at
  ) values (
    v_attempt.id, v_room.id, v_member.id, v_room.assignment_id,
    v_version.id, v_version.version_no,
    (v_version.config_snapshot ->> 'minimum_day')::integer,
    (v_version.config_snapshot ->> 'minimum_learning_questions')::integer,
    (v_version.config_snapshot ->> 'minimum_accuracy')::numeric,
    v_enabled_nodes,
    v_version.config_snapshot ->> 'learning_difficulty',
    v_timing_mode, v_timing_multiplier, v_hash, v_auth.expires_at
  );

  return query select v_attempt.id, v_version.id, v_version.version_no;
end;
$$;

create function game.get_p2p_assignment_requirements_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_target_member_id uuid default null
)
returns table (
  assignment_id uuid,
  assignment_version_id uuid,
  game_attempt_id uuid,
  member_id uuid,
  minimum_day integer,
  minimum_question_count integer,
  minimum_accuracy numeric,
  enabled_question_nodes text[],
  learning_difficulty text,
  timing_mode text,
  timing_multiplier numeric,
  requirements_revision integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_room game_private.p2p_rooms;
  v_target uuid;
  v_attempt record;
  v_req game_private.p2p_attempt_requirements;
begin
  select * into v_caller
  from game_private.require_p2p_member(p_game_session_token, p_room_id);

  select r.* into v_room
  from game_private.p2p_rooms r
  where r.id = p_room_id;

  v_target := coalesce(p_target_member_id, v_caller.member_id);
  if v_target <> v_caller.member_id
     and v_room.host_member_id is distinct from v_caller.member_id then
    raise exception 'only the current Host may inspect a peer requirement contract'
      using errcode = '42501';
  end if;

  select * into v_attempt
  from game_private.ensure_p2p_game_attempt(p_room_id, v_target);

  select req.* into v_req
  from game_private.p2p_attempt_requirements req
  where req.game_attempt_id = v_attempt.game_attempt_id;

  return query select
    v_req.assignment_id,
    v_req.assignment_version_id,
    v_req.game_attempt_id,
    v_req.member_id,
    v_req.minimum_day,
    v_req.minimum_question_count,
    v_req.minimum_accuracy,
    v_req.enabled_question_nodes,
    v_req.learning_difficulty,
    v_req.timing_mode,
    v_req.timing_multiplier,
    v_req.assignment_version_no,
    least(v_req.authorization_expires_at, v_room.expires_at);
end;
$$;

create function game.freeze_p2p_question_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_assignment_version_id uuid,
  p_requirements_revision integer,
  p_issue_request_id uuid,
  p_node_id text,
  p_node_kind text,
  p_day_number integer,
  p_node_sequence integer,
  p_question_revision integer
)
returns table (
  question_instance_id uuid,
  prompt_payload jsonb,
  question_type text,
  timed boolean,
  timeout_ms integer,
  expires_at timestamptz,
  counts_for_assignment boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
  v_attempt record;
  v_req game_private.p2p_attempt_requirements;
  v_binding game_private.p2p_question_bindings;
  v_existing_by_issue game_private.p2p_question_bindings;
  v_frozen record;
  v_question game_private.question_instances;
  v_question_type text;
  v_base_timeout integer;
  v_effective_timeout integer;
  v_hash bytea;
begin
  if p_issue_request_id is null
     or p_assignment_version_id is null
     or p_node_id is null
     or char_length(p_node_id) not between 1 and 128
     or p_node_kind is null
     or p_node_kind not in ('DAY_START', 'ZOMBIE_CARD')
     or p_day_number is null
     or p_day_number not between 1 and 10000
     or p_node_sequence is null
     or p_node_sequence < 0
     or p_requirements_revision is null
     or p_question_revision is null
     or p_question_revision <> 1 then
    raise exception 'invalid P2P question freeze request' using errcode = '22023';
  end if;

  select * into v_member
  from game_private.require_p2p_member(p_game_session_token, p_room_id);

  select * into v_attempt
  from game_private.ensure_p2p_game_attempt(p_room_id, v_member.member_id);

  select req.* into v_req
  from game_private.p2p_attempt_requirements req
  where req.game_attempt_id = v_attempt.game_attempt_id;

  if v_req.assignment_version_id <> p_assignment_version_id
     or v_req.assignment_version_no <> p_requirements_revision
     or not (p_node_kind = any(v_req.enabled_question_nodes)) then
    raise exception 'assignment version, revision, or Question node is not authorized'
      using errcode = '42501';
  end if;

  v_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'assignmentVersionId', p_assignment_version_id,
    'requirementsRevision', p_requirements_revision,
    'issueRequestId', p_issue_request_id,
    'nodeId', p_node_id,
    'nodeKind', p_node_kind,
    'dayNumber', p_day_number,
    'nodeSequence', p_node_sequence,
    'questionRevision', p_question_revision
  )::text);

  select b.* into v_binding
  from game_private.p2p_question_bindings b
  where b.game_attempt_id = v_req.game_attempt_id
    and b.node_id = p_node_id;

  if found then
    if v_binding.issue_request_id <> p_issue_request_id
       or v_binding.issue_input_hash <> v_hash then
      raise exception 'Question node was already frozen with different input'
        using errcode = '22000';
    end if;
    select qi.* into v_question
    from game_private.question_instances qi
    where qi.id = v_binding.question_instance_id;
    return query select
      v_question.id, v_question.prompt_payload, v_question.question_type,
      v_question.timed, v_question.timeout_ms, v_question.expires_at,
      v_question.counts_for_assignment;
    return;
  end if;

  select b.* into v_existing_by_issue
  from game_private.p2p_question_bindings b
  where b.issue_request_id = p_issue_request_id;
  if found then
    raise exception 'question issue request id belongs to another node'
      using errcode = '22000';
  end if;

  v_question_type := case when p_node_sequence % 2 = 0
    then 'en_to_zh' else 'zh_to_en' end;
  v_base_timeout := case v_req.learning_difficulty
    when 'easy' then 30000
    when 'hard' then 15000
    else 20000
  end;

  select * into v_frozen
  from game.freeze_question_v1(
    p_game_session_token,
    v_req.game_attempt_id,
    p_issue_request_id,
    v_question_type,
    'card',
    null,
    v_base_timeout
  );

  v_effective_timeout := case when v_req.timing_mode = 'untimed' then null
    else pg_catalog.round(v_base_timeout * v_req.timing_multiplier)::integer end;

  update game_private.question_instances qi
  set timed = v_effective_timeout is not null,
      timeout_ms = v_effective_timeout,
      expires_at = case when v_effective_timeout is null then null
        else qi.issued_at
          + pg_catalog.make_interval(secs => v_effective_timeout::double precision / 1000.0)
      end
  where qi.id = v_frozen.question_instance_id
  returning * into v_question;

  insert into game_private.p2p_question_bindings (
    game_attempt_id, room_id, member_id, node_id, node_kind,
    day_number, node_sequence, question_revision, issue_request_id,
    issue_input_hash, question_instance_id
  ) values (
    v_req.game_attempt_id, p_room_id, v_member.member_id, p_node_id,
    p_node_kind, p_day_number, p_node_sequence, p_question_revision,
    p_issue_request_id, v_hash, v_question.id
  );

  return query select
    v_question.id, v_question.prompt_payload, v_question.question_type,
    v_question.timed, v_question.timeout_ms, v_question.expires_at,
    v_question.counts_for_assignment;
end;
$$;

create function game.verify_p2p_frozen_question_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_target_member_id uuid,
  p_node_id text,
  p_question_instance_id uuid,
  p_issue_request_id uuid,
  p_question_revision integer
)
returns table (
  question_instance_id uuid,
  prompt_payload jsonb,
  question_type text,
  timed boolean,
  timeout_ms integer,
  expires_at timestamptz,
  counts_for_assignment boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_room game_private.p2p_rooms;
begin
  select * into v_caller
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  select r.* into v_room from game_private.p2p_rooms r where r.id = p_room_id;

  if p_target_member_id <> v_caller.member_id
     and v_room.host_member_id is distinct from v_caller.member_id then
    raise exception 'only the current Host may verify a peer frozen question'
      using errcode = '42501';
  end if;

  return query
  select qi.id, qi.prompt_payload, qi.question_type, qi.timed,
    qi.timeout_ms, qi.expires_at, qi.counts_for_assignment
  from game_private.p2p_question_bindings b
  join game_private.question_instances qi on qi.id = b.question_instance_id
  where b.room_id = p_room_id
    and b.member_id = p_target_member_id
    and b.node_id = p_node_id
    and b.question_instance_id = p_question_instance_id
    and b.issue_request_id = p_issue_request_id
    and b.question_revision = p_question_revision;

  if not found then
    raise exception 'frozen Question proof is invalid' using errcode = '42501';
  end if;
end;
$$;

create function game.submit_p2p_answer_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_assignment_version_id uuid,
  p_requirements_revision integer,
  p_node_id text,
  p_question_instance_id uuid,
  p_expected_question_revision integer,
  p_request_id uuid,
  p_submitted_answer text
)
returns table (
  learning_attempt_id uuid,
  question_instance_id uuid,
  request_id uuid,
  is_correct boolean,
  timed_out boolean,
  counts_for_assignment boolean,
  settled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
  v_attempt record;
  v_req game_private.p2p_attempt_requirements;
  v_binding game_private.p2p_question_bindings;
  v_settlement record;
  v_answered_at timestamptz;
begin
  if p_request_id is null or p_submitted_answer is null
     or pg_catalog.btrim(p_submitted_answer) = ''
     or char_length(p_submitted_answer) > 512 then
    raise exception 'invalid P2P answer submission' using errcode = '22023';
  end if;

  select * into v_member
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  select * into v_attempt
  from game_private.ensure_p2p_game_attempt(p_room_id, v_member.member_id);
  select req.* into v_req
  from game_private.p2p_attempt_requirements req
  where req.game_attempt_id = v_attempt.game_attempt_id;
  select b.* into v_binding
  from game_private.p2p_question_bindings b
  where b.game_attempt_id = v_req.game_attempt_id
    and b.member_id = v_member.member_id
    and b.node_id = p_node_id
    and b.question_instance_id = p_question_instance_id;

  if not found
     or v_req.assignment_version_id <> p_assignment_version_id
     or v_req.assignment_version_no <> p_requirements_revision
     or p_expected_question_revision <> v_binding.question_revision + 1 then
    raise exception 'answer does not match the frozen member/node/version revision'
      using errcode = '42501';
  end if;

  select * into v_settlement
  from game.submit_game_answer_v1(
    p_game_session_token,
    p_request_id,
    p_question_instance_id,
    p_submitted_answer
  );

  select la.answered_at into v_answered_at
  from game.learning_attempts la
  where la.id = v_settlement.learning_attempt_id;

  return query select
    v_settlement.learning_attempt_id,
    p_question_instance_id,
    p_request_id,
    v_settlement.is_correct,
    v_settlement.timed_out,
    v_settlement.counts_for_assignment,
    v_answered_at;
end;
$$;

create function game.verify_p2p_answer_settlement_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_target_member_id uuid,
  p_node_id text,
  p_question_instance_id uuid,
  p_expected_question_revision integer,
  p_request_id uuid,
  p_learning_attempt_id uuid
)
returns table (
  learning_attempt_id uuid,
  question_instance_id uuid,
  request_id uuid,
  is_correct boolean,
  timed_out boolean,
  counts_for_assignment boolean,
  settled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_room game_private.p2p_rooms;
begin
  select * into v_caller
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  select r.* into v_room from game_private.p2p_rooms r where r.id = p_room_id;

  if p_target_member_id <> v_caller.member_id
     and v_room.host_member_id is distinct from v_caller.member_id then
    raise exception 'only the current Host may verify a peer answer settlement'
      using errcode = '42501';
  end if;

  return query
  select la.id, la.question_instance_id, ar.request_id, la.is_correct,
    la.timed_out, la.counts_for_assignment, la.answered_at
  from game_private.p2p_question_bindings b
  join game.learning_attempts la on la.question_instance_id = b.question_instance_id
  join game_private.answer_requests ar
    on ar.learning_attempt_id = la.id and ar.question_instance_id = la.question_instance_id
  where b.room_id = p_room_id
    and b.member_id = p_target_member_id
    and b.node_id = p_node_id
    and b.question_instance_id = p_question_instance_id
    and p_expected_question_revision = b.question_revision + 1
    and ar.request_id = p_request_id
    and la.id = p_learning_attempt_id;

  if not found then
    raise exception 'answer settlement proof is invalid' using errcode = '42501';
  end if;
end;
$$;

create function game.expire_p2p_question_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_target_member_id uuid,
  p_node_id text,
  p_question_instance_id uuid,
  p_expected_question_revision integer,
  p_request_id uuid
)
returns table (
  learning_attempt_id uuid,
  question_instance_id uuid,
  request_id uuid,
  is_correct boolean,
  timed_out boolean,
  counts_for_assignment boolean,
  settled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_room game_private.p2p_rooms;
  v_binding game_private.p2p_question_bindings;
  v_question game_private.question_instances;
  v_attempt game.game_attempts;
  v_learning game.learning_attempts;
  v_answer_request game_private.answer_requests;
  v_null_hash bytea;
begin
  if p_request_id is null then
    raise exception 'timeout request id is required' using errcode = '22023';
  end if;

  select * into v_caller
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  select r.* into v_room from game_private.p2p_rooms r where r.id = p_room_id;

  if p_target_member_id <> v_caller.member_id
     and v_room.host_member_id is distinct from v_caller.member_id then
    raise exception 'only the current Host may expire a peer question'
      using errcode = '42501';
  end if;

  -- Timeout is an academic mutation. Even the Host may perform it only while
  -- the target member still has a valid, room/assignment-bound authorization.
  perform 1
  from game_private.ensure_p2p_game_attempt(p_room_id, p_target_member_id);

  select b.* into v_binding
  from game_private.p2p_question_bindings b
  where b.room_id = p_room_id
    and b.member_id = p_target_member_id
    and b.node_id = p_node_id
    and b.question_instance_id = p_question_instance_id
    and p_expected_question_revision = b.question_revision + 1;

  if not found then
    raise exception 'timeout does not match a frozen Question node'
      using errcode = '42501';
  end if;

  select ga.* into v_attempt
  from game.game_attempts ga
  where ga.id = v_binding.game_attempt_id
  for update;
  select qi.* into v_question
  from game_private.question_instances qi
  where qi.id = v_binding.question_instance_id
  for update;

  if v_attempt.status <> 'in_progress'
     or not v_question.timed
     or v_question.expires_at > pg_catalog.now() then
    raise exception 'Question is not eligible for server-authoritative timeout'
      using errcode = '55000';
  end if;

  v_null_hash := game_private.sha256_text('<NULL>');
  select ar.* into v_answer_request
  from game_private.answer_requests ar
  where ar.request_id = p_request_id;

  if found then
    if v_answer_request.question_instance_id <> p_question_instance_id
       or v_answer_request.submitted_answer_hash <> v_null_hash then
      raise exception 'timeout request id was reused with different input'
        using errcode = '22000';
    end if;
    select la.* into v_learning
    from game.learning_attempts la
    where la.id = v_answer_request.learning_attempt_id;
  else
    select la.* into v_learning
    from game.learning_attempts la
    where la.question_instance_id = p_question_instance_id;

    if found then
      if not v_learning.timed_out then
        raise exception 'Question already has a non-timeout settlement'
          using errcode = '22000';
      end if;
    else
      insert into game.learning_attempts (
        game_attempt_id, question_instance_id, question_type,
        question_purpose, source_kind, difficulty, question_tier,
        answer_mode, source_set_id, source_word_id, is_correct,
        timed_out, response_ms, counts_for_rank, counts_for_assignment
      ) values (
        v_question.game_attempt_id, v_question.id, v_question.question_type,
        v_question.question_purpose, v_question.source_kind,
        v_question.difficulty, v_question.question_tier,
        v_question.answer_mode, v_question.source_set_id,
        v_question.source_word_id, false, true,
        greatest(0, pg_catalog.floor(extract(epoch from
          (pg_catalog.now() - v_question.issued_at)) * 1000)::integer),
        v_question.counts_for_rank, v_question.counts_for_assignment
      ) returning * into v_learning;

      insert into game_private.learning_answer_payloads (
        learning_attempt_id, submitted_answer, submitted_answer_hash
      ) values (v_learning.id, null, v_null_hash);

      update game.game_attempts ga
      set official_question_count = ga.official_question_count
            + case when v_question.counts_for_rank then 1 else 0 end,
          assignment_question_count = ga.assignment_question_count
            + case when v_question.counts_for_assignment then 1 else 0 end
      where ga.id = v_question.game_attempt_id
        and ga.status = 'in_progress';
    end if;

    insert into game_private.answer_requests (
      request_id, question_instance_id, learning_attempt_id,
      submitted_answer_hash
    ) values (
      p_request_id, p_question_instance_id, v_learning.id, v_null_hash
    );
  end if;

  return query select
    v_learning.id, v_learning.question_instance_id, p_request_id,
    v_learning.is_correct, v_learning.timed_out,
    v_learning.counts_for_assignment, v_learning.answered_at;
end;
$$;

create function game.record_p2p_run_result_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_request_id uuid,
  p_topology_epoch integer,
  p_checkpoint_sequence bigint
)
returns table (
  room_id uuid,
  run_status text,
  max_day integer,
  equivalent_day integer,
  recorded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
  v_room game_private.p2p_rooms;
  v_existing game_private.p2p_run_results;
  v_status text;
  v_max_day integer;
  v_equivalent_day integer;
  v_hash bytea;
begin
  if p_request_id is null
     or p_topology_epoch is null or p_topology_epoch < 1
     or p_checkpoint_sequence is null or p_checkpoint_sequence < 1 then
    raise exception 'invalid P2P Run result request' using errcode = '22023';
  end if;

  select * into v_member
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  select r.* into v_room
  from game_private.p2p_rooms r
  where r.id = p_room_id
  for update;

  if v_room.host_member_id is distinct from v_member.member_id
     or v_room.topology_epoch <> p_topology_epoch
     or v_room.checkpoint_sequence <> p_checkpoint_sequence
     or v_room.checkpoint_payload is null then
    raise exception 'current Host and exact persisted checkpoint correlation are required'
      using errcode = '42501';
  end if;

  v_status := v_room.checkpoint_payload #>> '{combat,run,status}';
  begin
    v_max_day := coalesce(
      (v_room.checkpoint_payload #>> '{combat,run,summary,dayReached}')::integer,
      (v_room.checkpoint_payload #>> '{combat,day,dayNumber}')::integer
    );
    v_equivalent_day := coalesce(
      (v_room.checkpoint_payload #>> '{combat,day,equivalentDay}')::integer,
      v_max_day
    );
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'persisted checkpoint has invalid Run progression evidence'
      using errcode = '22023';
  end;

  if v_status is null
     or v_max_day is null
     or v_equivalent_day is null
     or v_status not in ('completed', 'failed')
     or v_max_day not between 1 and 10000
     or v_equivalent_day not between 0 and 10000 then
    raise exception 'persisted checkpoint does not contain a terminal Run result'
      using errcode = '55000';
  end if;

  v_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'roomId', p_room_id,
    'runStatus', v_status,
    'maxDay', v_max_day,
    'equivalentDay', v_equivalent_day,
    'checkpointSequence', p_checkpoint_sequence
  )::text);

  select rr.* into v_existing
  from game_private.p2p_run_results rr
  where rr.room_id = p_room_id or rr.request_id = p_request_id
  order by (rr.room_id = p_room_id) desc
  limit 1
  for update;

  if found then
    if v_existing.room_id <> p_room_id
       or v_existing.run_status <> v_status
       or v_existing.max_day <> v_max_day
       or v_existing.equivalent_day <> v_equivalent_day then
      raise exception 'Run result request conflicts with frozen evidence'
        using errcode = '22000';
    end if;
    return query select
      v_existing.room_id, v_existing.run_status, v_existing.max_day,
      v_existing.equivalent_day, v_existing.recorded_at;
    return;
  end if;

  insert into game_private.p2p_run_results (
    room_id, recorded_by_member_id, request_id, input_hash,
    topology_epoch, checkpoint_sequence, run_status, max_day, equivalent_day
  ) values (
    p_room_id, v_member.member_id, p_request_id, v_hash,
    p_topology_epoch, p_checkpoint_sequence, v_status,
    v_max_day, v_equivalent_day
  ) returning * into v_existing;

  return query select
    v_existing.room_id, v_existing.run_status, v_existing.max_day,
    v_existing.equivalent_day, v_existing.recorded_at;
end;
$$;

create function game.finalize_p2p_attempt_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_assignment_version_id uuid,
  p_requirements_revision integer,
  p_finalization_request_id uuid
)
returns table (
  game_attempt_id uuid,
  finalization_request_id uuid,
  assignment_completed boolean,
  run_completed boolean,
  day_reached integer,
  assignment_question_count integer,
  assignment_correct_count integer,
  required_day integer,
  required_question_count integer,
  required_accuracy numeric,
  finalized_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
  v_attempt_ref record;
  v_attempt game.game_attempts;
  v_req game_private.p2p_attempt_requirements;
  v_run game_private.p2p_run_results;
  v_question_count integer;
  v_correct_count integer;
  v_accuracy numeric;
  v_completed boolean;
  v_hash bytea;
begin
  if p_finalization_request_id is null
     or p_assignment_version_id is null
     or p_requirements_revision is null
     or p_requirements_revision < 1 then
    raise exception 'finalization request id is required' using errcode = '22023';
  end if;

  select * into v_member
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  select * into v_attempt_ref
  from game_private.ensure_p2p_game_attempt(p_room_id, v_member.member_id);
  select req.* into v_req
  from game_private.p2p_attempt_requirements req
  where req.game_attempt_id = v_attempt_ref.game_attempt_id;
  select rr.* into v_run
  from game_private.p2p_run_results rr
  where rr.room_id = p_room_id;

  if not found then
    raise exception 'trusted terminal Run evidence is not available'
      using errcode = '55000';
  end if;

  if v_req.assignment_version_id <> p_assignment_version_id
     or v_req.assignment_version_no <> p_requirements_revision then
    raise exception 'finalization assignment version or revision is stale'
      using errcode = '42501';
  end if;

  v_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'gameAttemptId', v_req.game_attempt_id,
    'assignmentVersionId', v_req.assignment_version_id,
    'requirementsRevision', v_req.assignment_version_no,
    'runRoomId', v_run.room_id,
    'runStatus', v_run.run_status,
    'maxDay', v_run.max_day,
    'equivalentDay', v_run.equivalent_day
  )::text);

  select ga.* into v_attempt
  from game.game_attempts ga
  where ga.id = v_req.game_attempt_id
  for update;

  if v_attempt.status <> 'in_progress' then
    if v_attempt.finalization_request_id is distinct from p_finalization_request_id
       or v_attempt.finalization_input_hash <> v_hash then
      raise exception 'P2P attempt was already finalized by another request'
        using errcode = '22000';
    end if;
    return query select
      v_attempt.id, v_attempt.finalization_request_id,
      v_attempt.assignment_completed, v_run.run_status = 'completed',
      v_attempt.max_day, v_attempt.assignment_question_count,
      v_attempt.assignment_correct_count, v_req.minimum_day,
      v_req.minimum_question_count, v_req.minimum_accuracy,
      v_attempt.completed_at;
    return;
  end if;

  perform 1 from game_private.question_instances qi
  where qi.game_attempt_id = v_attempt.id
  order by qi.id
  for update;

  select
    count(*) filter (where la.counts_for_assignment and not la.causally_voided)::integer,
    count(*) filter (
      where la.counts_for_assignment and not la.causally_voided and la.is_correct
    )::integer
  into v_question_count, v_correct_count
  from game.learning_attempts la
  where la.game_attempt_id = v_attempt.id;

  if v_question_count <> v_attempt.assignment_question_count
     or v_correct_count <> v_attempt.assignment_correct_count then
    raise exception 'trusted settlement aggregate is inconsistent'
      using errcode = '55000';
  end if;

  v_accuracy := case when v_question_count = 0 then 0
    else 100.0 * v_correct_count::numeric / v_question_count::numeric end;
  v_completed := v_run.run_status = 'completed'
    and v_run.max_day >= v_req.minimum_day
    and v_question_count >= v_req.minimum_question_count
    and v_accuracy >= v_req.minimum_accuracy;

  update game.game_attempts ga
  set status = case when v_run.run_status = 'completed' then 'completed' else 'terminated' end,
      outcome = case when v_run.run_status = 'completed' then 'win' else 'loss' end,
      max_day = v_run.max_day,
      equivalent_day = v_run.equivalent_day,
      verified_win = false,
      assignment_completed = v_completed,
      finalization_request_id = p_finalization_request_id,
      finalization_input_hash = v_hash,
      result_detail = pg_catalog.jsonb_build_object(
        'source', 'host_authoritative_p2p_broker',
        'version', 1,
        'assignmentVersionId', v_req.assignment_version_id,
        'runEvidenceRequestId', v_run.request_id
      ),
      completed_at = pg_catalog.now()
  where ga.id = v_attempt.id and ga.status = 'in_progress'
  returning * into v_attempt;

  if not found then
    raise exception 'P2P attempt was finalized concurrently' using errcode = '40001';
  end if;

  return query select
    v_attempt.id, v_attempt.finalization_request_id,
    v_attempt.assignment_completed, v_run.run_status = 'completed',
    v_attempt.max_day, v_attempt.assignment_question_count,
    v_attempt.assignment_correct_count, v_req.minimum_day,
    v_req.minimum_question_count, v_req.minimum_accuracy,
    v_attempt.completed_at;
end;
$$;

create function game.verify_p2p_attempt_finalization_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_target_member_id uuid,
  p_finalization_request_id uuid,
  p_game_attempt_id uuid
)
returns table (
  game_attempt_id uuid,
  finalization_request_id uuid,
  assignment_completed boolean,
  finalized_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_room game_private.p2p_rooms;
begin
  select * into v_caller
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  select r.* into v_room from game_private.p2p_rooms r where r.id = p_room_id;

  if p_target_member_id <> v_caller.member_id
     and v_room.host_member_id is distinct from v_caller.member_id then
    raise exception 'only the current Host may verify a peer finalization'
      using errcode = '42501';
  end if;

  return query
  select ga.id, ga.finalization_request_id, ga.assignment_completed, ga.completed_at
  from game.game_attempts ga
  join game_private.p2p_attempt_requirements req on req.game_attempt_id = ga.id
  where req.room_id = p_room_id
    and req.member_id = p_target_member_id
    and ga.id = p_game_attempt_id
    and ga.finalization_request_id = p_finalization_request_id
    and ga.status <> 'in_progress'
    and ga.completed_at is not null;

  if not found then
    raise exception 'attempt finalization proof is invalid' using errcode = '42501';
  end if;
end;
$$;

do $ownership$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('game', 'game_private')
      and p.proname in (
        'ensure_p2p_game_attempt',
        'poll_p2p_room_v2',
        'get_p2p_assignment_requirements_v1',
        'freeze_p2p_question_v1',
        'verify_p2p_frozen_question_v1',
        'submit_p2p_answer_v1',
        'verify_p2p_answer_settlement_v1',
        'expire_p2p_question_v1',
        'record_p2p_run_result_v1',
        'finalize_p2p_attempt_v1',
        'verify_p2p_attempt_finalization_v1'
      )
  loop
    execute pg_catalog.format('alter function %s owner to game_api_owner', v_function);
  end loop;
end
$ownership$;

do $revoke_new_functions$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('game', 'game_private')
      and p.proname in (
        'ensure_p2p_game_attempt',
        'poll_p2p_room_v2',
        'get_p2p_assignment_requirements_v1',
        'freeze_p2p_question_v1',
        'verify_p2p_frozen_question_v1',
        'submit_p2p_answer_v1',
        'verify_p2p_answer_settlement_v1',
        'expire_p2p_question_v1',
        'record_p2p_run_result_v1',
        'finalize_p2p_attempt_v1',
        'verify_p2p_attempt_finalization_v1'
      )
  loop
    execute pg_catalog.format(
      'revoke execute on function %s from public, anon, authenticated, service_role, game_server, games_api',
      v_function
    );
  end loop;
end
$revoke_new_functions$;

do $runtime_grants$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'game'
      and p.proname in (
        'poll_p2p_room_v2',
        'get_p2p_assignment_requirements_v1',
        'freeze_p2p_question_v1',
        'verify_p2p_frozen_question_v1',
        'submit_p2p_answer_v1',
        'verify_p2p_answer_settlement_v1',
        'expire_p2p_question_v1',
        'record_p2p_run_result_v1',
        'finalize_p2p_attempt_v1',
        'verify_p2p_attempt_finalization_v1'
      )
  loop
    execute pg_catalog.format('grant execute on function %s to games_api', v_function);
  end loop;
end
$runtime_grants$;

set role postgres;

revoke references (id) on public.assignments from game_api_owner;

do $drop_temporary_membership$
begin
  execute pg_catalog.format(
    'revoke game_api_owner from %I granted by %I',
    current_user,
    current_user
  );
end
$drop_temporary_membership$;
