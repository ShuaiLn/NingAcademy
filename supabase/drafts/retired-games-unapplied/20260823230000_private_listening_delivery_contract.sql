-- Private Question-listening delivery and trusted accessibility reporting.
--
-- This is a forward-only convergence migration after the tracked, undeployed
-- migrations 31-33. It deliberately does not expose game_private metadata or
-- raw R2 object keys to either browser role.

alter table public.game_assignment_configs
  add column question_types text[] not null
  default array['en_to_zh', 'zh_to_en']::text[];

alter table public.game_assignment_configs
  add constraint game_assignment_configs_question_types_valid check (
    cardinality(question_types) between 1 and 3
    and array_ndims(question_types) = 1
    and array_lower(question_types, 1) = 1
    and question_types <@ array['en_to_zh', 'zh_to_en', 'listening_spelling']::text[]
    and array_position(question_types, null) is null
    and (cardinality(question_types) = 1
      or (cardinality(question_types) = 2 and question_types[1] <> question_types[2])
      or (cardinality(question_types) = 3
        and question_types[1] <> question_types[2]
        and question_types[1] <> question_types[3]
        and question_types[2] <> question_types[3]))
  );

alter table public.game_assignment_accommodations
  add column listening_mode text not null default 'audio',
  add column world_audio_effects_enabled boolean not null default true,
  add constraint game_assignment_accommodations_listening_mode_valid check (
    listening_mode in ('audio', 'text_alternative')
  );

comment on column public.game_assignment_configs.question_types is
  'Question types frozen into each immutable assignment version. Listening is opt-in and fails closed without provisioned private audio.';
comment on column public.game_assignment_accommodations.listening_mode is
  'Teacher-selected accessibility decision. Browsers cannot self-enable text_alternative.';
comment on column public.game_assignment_accommodations.world_audio_effects_enabled is
  'Frozen per-student choice controlling only the owner browser world-audio effects during listening playback.';

alter table game_private.listening_audio_assets
  add column logical_asset_id text not null,
  add column asset_version integer not null,
  add column language_tag text not null,
  add column duration_ms integer not null,
  add column content_sha256 bytea not null,
  add column byte_length integer not null,
  add column text_alternative_available boolean not null default false,
  add column provisioned_at timestamptz not null,
  add constraint listening_audio_logical_id_format check (
    logical_asset_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
  ),
  add constraint listening_audio_asset_version_range check (asset_version between 1 and 2147483647),
  add constraint listening_audio_language_tag_format check (
    language_tag ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'
  ),
  add constraint listening_audio_duration_range check (duration_ms between 100 and 300000),
  add constraint listening_audio_sha256_length check (octet_length(content_sha256) = 32),
  add constraint listening_audio_byte_length_range check (byte_length between 1 and 5242880),
  add constraint listening_audio_provisioned_after_creation check (provisioned_at >= created_at),
  add constraint listening_audio_logical_version_unique unique (logical_asset_id, asset_version);

comment on table game_private.listening_audio_assets is
  'Formal private listening asset registry. logical_asset_id/version may enter an owner-only prompt; object_key and integrity/storage metadata remain server-only.';

alter table game_private.question_instances
  add column listening_audio_asset_id uuid
    references game_private.listening_audio_assets (id) on delete restrict,
  add column accessibility_mode text not null default 'standard';

alter table game_private.question_instances
  drop constraint question_instances_assignment_scope,
  drop constraint question_instances_text_alternative_scope;

alter table game_private.question_instances
  add constraint question_instances_assignment_scope check (
    not counts_for_assignment
    or (question_purpose = 'card' and source_kind in ('official', 'assignment'))
  ),
  add constraint question_instances_text_alternative_scope check (
    answer_mode <> 'text_alternative'
    or (question_type = 'listening_spelling' and not counts_for_rank)
  ),
  add constraint question_instances_listening_asset_scope check (
    (question_type = 'listening_spelling' and listening_audio_asset_id is not null)
    or (question_type <> 'listening_spelling' and listening_audio_asset_id is null)
  ),
  add constraint question_instances_accessibility_mode_valid check (
    accessibility_mode in ('standard', 'text_alternative', 'effects_disabled')
    and (accessibility_mode <> 'text_alternative' or answer_mode = 'text_alternative')
    and (answer_mode <> 'text_alternative' or accessibility_mode = 'text_alternative')
    and (accessibility_mode = 'standard' or question_type = 'listening_spelling')
  );

alter table game.learning_attempts
  add column accessibility_mode text not null default 'standard',
  add constraint learning_attempts_accessibility_mode_valid check (
    accessibility_mode in ('standard', 'text_alternative', 'effects_disabled')
  );

create function game_private.bind_learning_attempt_accessibility_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select qi.accessibility_mode into new.accessibility_mode
  from game_private.question_instances qi
  where qi.id = new.question_instance_id
    and qi.game_attempt_id = new.game_attempt_id;
  if not found then
    raise exception 'learning attempt question binding is invalid' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger learning_attempts_bind_accessibility_mode
before insert on game.learning_attempts
for each row execute function game_private.bind_learning_attempt_accessibility_mode();

alter table game_private.listening_audio_accesses
  add column fetched_at timestamptz,
  add constraint listening_audio_access_fetch_scope check (
    fetched_at is null or (allowed and delivery_id is not null and fetched_at >= requested_at)
  );

alter table game_private.p2p_attempt_requirements
  add column question_types text[],
  add column listening_mode text,
  add column world_audio_effects_enabled boolean;

alter table game_private.p2p_attempt_requirements
  add constraint p2p_attempt_requirements_question_types check (
    question_types is null or (
      cardinality(question_types) between 1 and 3
      and question_types <@ array['en_to_zh', 'zh_to_en', 'listening_spelling']::text[]
      and array_position(question_types, null) is null
      and (cardinality(question_types) = 1
        or (cardinality(question_types) = 2 and question_types[1] <> question_types[2])
        or (cardinality(question_types) = 3
          and question_types[1] <> question_types[2]
          and question_types[1] <> question_types[3]
          and question_types[2] <> question_types[3]))
    )
  ),
  add constraint p2p_attempt_requirements_listening_mode check (
    listening_mode is null or listening_mode in ('audio', 'text_alternative')
  );

-- Adds the new immutable/frozen fields after the historical v1 helper has
-- created or restored the durable attempt. Reconnects never re-read changed
-- teacher configuration once these fields are set.
create function game_private.ensure_p2p_game_attempt_v2(
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
  v_attempt record;
  v_req game_private.p2p_attempt_requirements;
  v_version public.game_assignment_versions;
  v_accommodation public.game_assignment_accommodations;
  v_question_types text[];
  v_listening_mode text;
  v_world_audio_effects_enabled boolean;
begin
  select * into v_attempt
  from game_private.ensure_p2p_game_attempt(p_room_id, p_member_id);

  select req.* into v_req
  from game_private.p2p_attempt_requirements req
  where req.game_attempt_id = v_attempt.game_attempt_id
  for update;

  if v_req.question_types is null then
    select v.* into v_version
    from public.game_assignment_versions v
    where v.id = v_req.assignment_version_id
      and v.game_assignment_id = v_req.assignment_id;

    v_question_types := case
      when pg_catalog.jsonb_typeof(v_version.config_snapshot -> 'question_types') = 'array'
        then array(select pg_catalog.jsonb_array_elements_text(v_version.config_snapshot -> 'question_types'))
      else array['en_to_zh', 'zh_to_en']::text[]
    end;
    if cardinality(v_question_types) not between 1 and 3
       or not (v_question_types <@ array['en_to_zh', 'zh_to_en', 'listening_spelling']::text[])
       or array_position(v_question_types, null) is not null
       or (cardinality(v_question_types) = 2 and v_question_types[1] = v_question_types[2])
       or (cardinality(v_question_types) = 3 and (
         v_question_types[1] = v_question_types[2]
         or v_question_types[1] = v_question_types[3]
         or v_question_types[2] = v_question_types[3]
       )) then
      raise exception 'immutable assignment version has invalid Question type configuration'
        using errcode = '22023';
    end if;

    select ac.* into v_accommodation
    from public.game_assignment_accommodations ac
    join game_private.p2p_members m on m.user_id = ac.student_id
    where m.id = v_req.member_id
      and ac.assignment_id = v_req.assignment_id;

    v_listening_mode := coalesce(v_accommodation.listening_mode, 'audio');
    v_world_audio_effects_enabled := coalesce(
      v_accommodation.world_audio_effects_enabled,
      true
    );

    if v_listening_mode = 'text_alternative'
       and 'listening_spelling' = any(v_question_types)
       and exists (
         select 1
         from public.game_assignment_vocabulary_sources gavs
         join public.vocabulary_words w
           on w.set_id = gavs.vocabulary_set_id and w.archived_at is null
         where gavs.assignment_id = v_req.assignment_id
           and not exists (
             select 1
             from game_private.listening_audio_assets laa
             where laa.content_release_id = v_version.config_snapshot ->> 'content_release_id'
               and laa.source_word_id = w.id
               and laa.text_alternative_available
               and laa.retired_at is null
           )
       ) then
      raise exception 'text-alternative listening assets are not provisioned for this immutable version'
        using errcode = '42501';
    end if;

    update game_private.p2p_attempt_requirements req
    set question_types = v_question_types,
        listening_mode = v_listening_mode,
        world_audio_effects_enabled = v_world_audio_effects_enabled,
        requirements_hash = game_private.sha256_text(pg_catalog.jsonb_build_object(
          'previousRequirementsHash', pg_catalog.encode(v_req.requirements_hash, 'hex'),
          'questionTypes', v_question_types,
          'listeningMode', v_listening_mode,
          'worldAudioEffectsEnabled', v_world_audio_effects_enabled
        )::text)
    where req.game_attempt_id = v_req.game_attempt_id;
  end if;

  return query select
    v_attempt.game_attempt_id,
    v_attempt.assignment_version_id,
    v_attempt.requirements_revision;
end;
$$;

create function game.get_p2p_assignment_requirements_v2(
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
  question_types text[],
  learning_difficulty text,
  timing_mode text,
  timing_multiplier numeric,
  listening_mode text,
  world_audio_effects_enabled boolean,
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
  select r.* into v_room from game_private.p2p_rooms r where r.id = p_room_id;
  v_target := coalesce(p_target_member_id, v_caller.member_id);
  if v_target <> v_caller.member_id
     and v_room.host_member_id is distinct from v_caller.member_id then
    raise exception 'only the current Host may inspect a peer requirement contract'
      using errcode = '42501';
  end if;
  select * into v_attempt
  from game_private.ensure_p2p_game_attempt_v2(p_room_id, v_target);
  select req.* into v_req
  from game_private.p2p_attempt_requirements req
  where req.game_attempt_id = v_attempt.game_attempt_id;
  return query select
    v_req.assignment_id, v_req.assignment_version_id, v_req.game_attempt_id,
    v_req.member_id, v_req.minimum_day, v_req.minimum_question_count,
    v_req.minimum_accuracy, v_req.enabled_question_nodes, v_req.question_types,
    v_req.learning_difficulty, v_req.timing_mode, v_req.timing_multiplier,
    v_req.listening_mode, v_req.world_audio_effects_enabled,
    v_req.assignment_version_no,
    least(v_req.authorization_expires_at, v_room.expires_at);
end;
$$;

-- v1 remains live for historical callers. v2 preserves its freeze/idempotency
-- path, then converts only a configured listening selection to the formal
-- asset-bound owner prompt. The Host still receives metadata only.
create function game.freeze_p2p_question_v2(
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
  v_frozen record;
  v_question game_private.question_instances;
  v_item game_private.question_pool_items;
  v_game_session game.game_sessions;
  v_asset game_private.listening_audio_assets;
  v_desired_type text;
  v_accessibility_mode text;
  v_definition_clue text;
begin
  select * into v_member
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  select * into v_attempt
  from game_private.ensure_p2p_game_attempt_v2(p_room_id, v_member.member_id);
  select req.* into v_req
  from game_private.p2p_attempt_requirements req
  where req.game_attempt_id = v_attempt.game_attempt_id;

  v_desired_type := v_req.question_types[
    1 + (p_node_sequence % cardinality(v_req.question_types))
  ];

  select * into v_frozen
  from game.freeze_p2p_question_v1(
    p_game_session_token, p_room_id, p_assignment_version_id,
    p_requirements_revision, p_issue_request_id, p_node_id, p_node_kind,
    p_day_number, p_node_sequence, p_question_revision
  );

  select qi.* into v_question
  from game_private.question_instances qi
  where qi.id = v_frozen.question_instance_id
  for update;

  select qpi.* into v_item
  from game_private.question_pool_items qpi
  where qpi.id = v_question.pool_item_id;
  if not found then
    raise exception 'frozen Question pool item is unavailable' using errcode = '55000';
  end if;

  if v_desired_type <> 'listening_spelling' then
    if v_question.question_type <> v_desired_type then
      update game_private.question_instances qi
      set question_type = v_desired_type,
          prompt_payload = case when v_desired_type = 'zh_to_en'
            then pg_catalog.jsonb_build_object(
              'kind', 'zh_to_en', 'text', v_item.meaning, 'imageUrl', v_item.image_url
            ) else pg_catalog.jsonb_build_object('kind', 'en_to_zh', 'text', v_item.term) end,
          correct_answers = case when v_desired_type = 'zh_to_en'
            then v_item.accepted_terms else v_item.accepted_meanings end
      where qi.id = v_question.id
      returning * into v_question;
    end if;
  elsif v_question.question_type <> 'listening_spelling' then
    select gs.* into v_game_session
    from game.game_attempts ga
    join game.game_sessions gs on gs.id = ga.game_session_id
    where ga.id = v_req.game_attempt_id;

    select a.* into v_asset
    from game_private.listening_audio_assets a
    join game_private.listening_content_releases r
      on r.content_release_id = a.content_release_id and r.retired_at is null
    where a.content_release_id = v_game_session.content_release_id
      and a.source_word_id = v_question.source_word_id
      and a.retired_at is null
      and a.provisioned_at is not null
    order by pg_catalog.md5(v_question.id::text || a.id::text), a.variant, a.id
    limit 1;

    if not found then
      raise exception 'formal private listening asset is unavailable' using errcode = '42501';
    end if;

    v_accessibility_mode := case
      when v_req.listening_mode = 'text_alternative' then 'text_alternative'
      when not v_req.world_audio_effects_enabled then 'effects_disabled'
      else 'standard'
    end;
    v_definition_clue := v_item.meaning;

    if v_accessibility_mode = 'text_alternative' then
      if not v_asset.text_alternative_available
         or v_definition_clue is null
         or pg_catalog.btrim(v_definition_clue) = ''
         or exists (
           select 1 from pg_catalog.unnest(v_item.accepted_terms) answer
           where game_private.normalize_answer(v_question.grading_mode, answer)
             = game_private.normalize_answer(
               v_question.grading_mode,
               v_definition_clue
             )
         ) then
        raise exception 'safe text alternative is unavailable' using errcode = '42501';
      end if;
    end if;

    update game_private.question_instances qi
    set question_type = 'listening_spelling',
        answer_mode = case when v_accessibility_mode = 'text_alternative'
          then 'text_alternative' else 'standard' end,
        accessibility_mode = v_accessibility_mode,
        listening_audio_asset_id = v_asset.id,
        counts_for_rank = false,
        correct_answers = v_item.accepted_terms,
        prompt_payload = pg_catalog.jsonb_build_object(
          'kind', 'listening_spelling',
          'audioAssetId', v_asset.logical_asset_id,
          'deliveryMode', case when v_accessibility_mode = 'text_alternative'
            then 'text_alternative' else 'audio' end,
          'textAlternativeAvailable', v_asset.text_alternative_available,
          'textAlternative', case when v_accessibility_mode = 'text_alternative'
            then pg_catalog.jsonb_build_object(
              'kind', 'definition_clue',
              'sourceLanguage', 'zh',
              'text', v_definition_clue
            ) else 'null'::jsonb end
        )
    where qi.id = v_question.id
    returning * into v_question;
  end if;

  return query select
    v_question.id, v_question.prompt_payload, v_question.question_type,
    v_question.timed, v_question.timeout_ms, v_question.expires_at,
    v_question.counts_for_assignment;
end;
$$;

create function game.authorize_p2p_listening_audio_v2(
  p_game_session_token text,
  p_room_id uuid,
  p_question_instance_id uuid,
  p_question_revision integer,
  p_request_id uuid
)
returns table (
  authorized boolean,
  denial_reason text,
  delivery_id uuid,
  session_binding text,
  member_binding text,
  attempt_binding text,
  expires_at timestamptz,
  request_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
  v_binding game_private.p2p_question_bindings;
  v_question game_private.question_instances;
  v_result record;
  v_delivery game_private.listening_audio_deliveries;
begin
  select * into v_member
  from game_private.require_p2p_member(p_game_session_token, p_room_id);
  select b, qi into v_binding, v_question
  from game_private.p2p_question_bindings b
  join game_private.question_instances qi on qi.id = b.question_instance_id
  where b.room_id = p_room_id
    and b.member_id = v_member.member_id
    and b.question_instance_id = p_question_instance_id
    and b.question_revision = p_question_revision
  for update of qi;
  if not found
     or v_question.question_type <> 'listening_spelling'
     or v_question.answer_mode <> 'standard'
     or v_question.listening_audio_asset_id is null then
    raise exception 'audio delivery is not authorized for this owner Question'
      using errcode = '42501';
  end if;

  select * into v_result
  from game.authorize_p2p_listening_audio_v1(
    p_game_session_token, p_room_id, p_question_instance_id,
    p_question_revision, p_request_id
  );

  if v_result.authorized then
    select d.* into v_delivery
    from game_private.listening_audio_deliveries d
    where d.id = v_result.delivery_id;
    if not found or v_delivery.audio_asset_id <> v_question.listening_audio_asset_id then
      raise exception 'listening delivery asset binding changed' using errcode = '55000';
    end if;
  end if;

  return query select
    v_result.authorized,
    v_result.denial_reason,
    v_result.delivery_id,
    v_result.session_binding,
    case when v_result.authorized then game_private.base64url(
      game_private.sha256_text(v_member.member_id::text || v_result.delivery_id::text)
    ) else null end,
    case when v_result.authorized then game_private.base64url(
      game_private.sha256_text(v_binding.game_attempt_id::text || v_result.delivery_id::text)
    ) else null end,
    v_result.expires_at,
    v_result.request_count;
end;
$$;

-- Worker-only one-use resolution. The same owner cookie, every signed claim,
-- the frozen question revision, and the exact grant row are revalidated under
-- row locks before the server-only R2 key is returned.
create function game.consume_p2p_listening_delivery_v1(
  p_game_session_token text,
  p_room_id uuid,
  p_delivery_id uuid,
  p_question_instance_id uuid,
  p_grant_request_id uuid,
  p_question_revision integer,
  p_session_binding text,
  p_member_binding text,
  p_attempt_binding text
)
returns table (
  object_key text,
  mime_type text,
  content_sha256 text,
  byte_length integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
  v_access game_private.listening_audio_accesses;
  v_delivery game_private.listening_audio_deliveries;
  v_binding game_private.p2p_question_bindings;
  v_question game_private.question_instances;
  v_asset game_private.listening_audio_assets;
begin
  if p_game_session_token is null
     or p_room_id is null
     or p_delivery_id is null
     or p_question_instance_id is null
     or p_grant_request_id is null
     or p_question_revision is null or p_question_revision < 1
     or p_session_binding is null or p_session_binding !~ '^[A-Za-z0-9_-]{43}$'
     or p_member_binding is null or p_member_binding !~ '^[A-Za-z0-9_-]{43}$'
     or p_attempt_binding is null or p_attempt_binding !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'malformed listening delivery claim' using errcode = '22023';
  end if;
  select * into v_member
  from game_private.require_p2p_member(p_game_session_token, p_room_id);

  select a.* into v_access
  from game_private.listening_audio_accesses a
  where a.question_instance_id = p_question_instance_id
    and a.request_id = p_grant_request_id
  for update;
  select d.* into v_delivery
  from game_private.listening_audio_deliveries d
  where d.id = p_delivery_id
  for update;
  select b.* into v_binding
  from game_private.p2p_question_bindings b
  where b.room_id = p_room_id
    and b.member_id = v_member.member_id
    and b.question_instance_id = p_question_instance_id
    and b.question_revision = p_question_revision;
  select qi.* into v_question
  from game_private.question_instances qi
  where qi.id = p_question_instance_id
  for update;

  if v_access.id is null
     or not v_access.allowed
     or v_access.delivery_id is distinct from p_delivery_id
     or v_access.game_auth_session_id <> v_member.game_auth_session_id
     or v_access.fetched_at is not null
     or v_delivery.id is null
     or v_delivery.room_id <> p_room_id
     or v_delivery.member_id <> v_member.member_id
     or v_delivery.game_auth_session_id <> v_member.game_auth_session_id
     or v_delivery.question_instance_id <> p_question_instance_id
     or v_delivery.expires_at <= pg_catalog.now()
     or v_binding.question_instance_id is null
     or v_question.question_type <> 'listening_spelling'
     or v_question.answer_mode <> 'standard'
     or v_question.listening_audio_asset_id <> v_delivery.audio_asset_id
     or exists (
       select 1 from game.learning_attempts la
       where la.question_instance_id = p_question_instance_id
     )
     or p_session_binding <> game_private.base64url(game_private.sha256_text(
       v_member.game_auth_session_id::text || p_delivery_id::text
     ))
     or p_member_binding <> game_private.base64url(game_private.sha256_text(
       v_member.member_id::text || p_delivery_id::text
     ))
     or p_attempt_binding <> game_private.base64url(game_private.sha256_text(
       v_binding.game_attempt_id::text || p_delivery_id::text
     )) then
    raise exception 'listening delivery claim is invalid, consumed, expired, or not owner-bound'
      using errcode = '42501';
  end if;

  select a.* into v_asset
  from game_private.listening_audio_assets a
  where a.id = v_delivery.audio_asset_id
    and a.retired_at is null
    and a.provisioned_at is not null;
  if not found then
    raise exception 'listening asset is unavailable' using errcode = '42501';
  end if;

  update game_private.listening_audio_accesses a
  set fetched_at = pg_catalog.now()
  where a.id = v_access.id;

  return query select
    v_asset.object_key,
    v_asset.mime_type,
    pg_catalog.encode(v_asset.content_sha256, 'hex'),
    v_asset.byte_length;
end;
$$;

-- Atomic main-site sibling: configuration is updated before the immutable
-- version snapshot is minted. Reusing a request id with different listening
-- policy fails through the v3 request hash.
create function public.create_and_publish_game_assignment_v3(
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
  p_requirement_assignable_ids uuid[],
  p_question_types text[],
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
  v_previous jsonb;
  v_hash bytea;
begin
  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null or p_request_id is null then
    raise exception 'active teacher and request id are required' using errcode = '28000';
  end if;
  if p_question_types is null
     or cardinality(p_question_types) not between 1 and 3
     or not (p_question_types <@ array['en_to_zh', 'zh_to_en', 'listening_spelling']::text[])
     or array_position(p_question_types, null) is not null
     or (cardinality(p_question_types) = 2 and p_question_types[1] = p_question_types[2])
     or (cardinality(p_question_types) = 3 and (
       p_question_types[1] = p_question_types[2]
       or p_question_types[1] = p_question_types[3]
       or p_question_types[2] = p_question_types[3]
     )) then
    raise exception 'invalid Question type selection' using errcode = '22023';
  end if;
  v_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'title', p_title, 'description', p_description, 'dueAt', p_due_at,
    'classIds', p_class_ids, 'studentIds', p_student_ids,
    'vocabularySetIds', p_vocabulary_set_ids, 'allowedModes', p_allowed_modes,
    'map', p_map_key, 'learningDifficulty', p_learning_difficulty,
    'minimumDay', p_minimum_day, 'minimumLearningQuestions', p_minimum_learning_questions,
    'minimumAccuracy', p_minimum_accuracy, 'screenShakeMax', p_screen_shake_max,
    'hitStopAllowed', p_hit_stop_allowed, 'flashIntensity', p_flash_intensity,
    'shardIntensity', p_shard_intensity,
    'screamerDistortionAllowed', p_screamer_distortion_allowed,
    'slowMotionAllowed', p_slow_motion_allowed, 'cameraBobAllowed', p_camera_bob_allowed,
    'motionBlurAllowed', p_motion_blur_allowed, 'timingMultiplier', p_timing_multiplier,
    'rulesetVersion', p_ruleset_version, 'contentReleaseId', p_content_release_id,
    'retentionUntil', p_retention_until,
    'requirementAssignableIds', p_requirement_assignable_ids,
    'questionTypes', p_question_types
  )::text);
  v_previous := game_private.claim_rpc_request(
    v_teacher_id, 'public.create_game_assignment_v3', p_request_id,
    v_hash, p_retention_until
  );
  if v_previous is not null then
    return (v_previous ->> 'assignmentId')::uuid;
  end if;

  v_assignment_id := public.create_and_publish_game_assignment_v1(
    p_title, p_description, p_due_at, p_class_ids, p_student_ids,
    p_vocabulary_set_ids, p_allowed_modes, p_map_key, p_learning_difficulty,
    p_minimum_day, p_minimum_learning_questions, p_minimum_accuracy,
    p_screen_shake_max, p_hit_stop_allowed, p_flash_intensity,
    p_shard_intensity, p_screamer_distortion_allowed, p_slow_motion_allowed,
    p_camera_bob_allowed, p_motion_blur_allowed, p_timing_multiplier,
    p_ruleset_version, p_content_release_id, p_retention_until, p_request_id
  );
  update public.game_assignment_configs c
  set question_types = p_question_types
  where c.assignment_id = v_assignment_id;

  if 'listening_spelling' = any(p_question_types)
     and exists (
       select 1
       from public.game_assignment_vocabulary_sources gavs
       join public.vocabulary_words w
         on w.set_id = gavs.vocabulary_set_id and w.archived_at is null
       where gavs.assignment_id = v_assignment_id
         and not exists (
           select 1 from game_private.listening_audio_assets a
           where a.content_release_id = p_content_release_id
             and a.source_word_id = w.id
             and a.retired_at is null
             and a.provisioned_at is not null
         )
     ) then
    raise exception 'formal listening assets are not provisioned for every active source word'
      using errcode = '42501';
  end if;

  perform public.set_game_unlock_requirements_v1(
    v_assignment_id, p_requirement_assignable_ids, p_request_id
  );
  perform game_private.complete_rpc_request(
    v_teacher_id, 'public.create_game_assignment_v3', p_request_id,
    pg_catalog.jsonb_build_object('assignmentId', v_assignment_id)
  );
  return v_assignment_id;
end;
$$;

create function public.get_my_game_profile_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_profile jsonb;
begin
  v_user_id := private.current_game_user_id();
  v_profile := public.get_my_game_profile_v1();
  return v_profile || pg_catalog.jsonb_build_object(
    'listeningAccessibilityBreakdown', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(stats) order by stats.accessibility_mode)
      from (
        select
          la.accessibility_mode,
          count(*)::integer as attempt_count,
          count(*) filter (where la.is_correct)::integer as correct_count,
          pg_catalog.round(
            100.0 * count(*) filter (where la.is_correct)::numeric / count(*)::numeric,
            2
          ) as accuracy,
          max(la.answered_at) as last_answered_at
        from game.learning_attempts la
        join game.game_attempts ga on ga.id = la.game_attempt_id
        where ga.user_id = v_user_id
          and la.question_type = 'listening_spelling'
          and not la.causally_voided
        group by la.accessibility_mode
      ) stats
    ), '[]'::jsonb)
  );
end;
$$;

create function public.get_teacher_game_report_v2(p_student_id uuid default null)
returns table (
  student_id uuid,
  student_name text,
  report jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    base.student_id,
    base.student_name,
    base.report || pg_catalog.jsonb_build_object(
      'listeningAccessibilityBreakdown', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(stats) order by stats.accessibility_mode)
        from (
          select
            la.accessibility_mode,
            count(*)::integer as attempt_count,
            count(*) filter (where la.is_correct)::integer as correct_count,
            pg_catalog.round(
              100.0 * count(*) filter (where la.is_correct)::numeric / count(*)::numeric,
              2
            ) as accuracy,
            max(la.answered_at) as last_answered_at
          from game.learning_attempts la
          join game.game_attempts ga on ga.id = la.game_attempt_id
          where ga.user_id = base.student_id
            and la.question_type = 'listening_spelling'
            and not la.causally_voided
          group by la.accessibility_mode
        ) stats
      ), '[]'::jsonb)
    )
  from public.get_teacher_game_report_v1(p_student_id) base;
$$;

create function public.set_game_assignment_accommodation_v2(
  p_assignment_id uuid,
  p_student_id uuid,
  p_timing_mode text,
  p_timing_multiplier numeric,
  p_flash_intensity text,
  p_screen_shake_max smallint,
  p_screamer_distortion_allowed boolean,
  p_listening_mode text,
  p_world_audio_effects_enabled boolean,
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
  v_previous jsonb;
  v_hash bytea;
begin
  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null or p_request_id is null then
    raise exception 'active teacher and request id are required' using errcode = '28000';
  end if;
  if p_listening_mode not in ('audio', 'text_alternative')
     or p_world_audio_effects_enabled is null then
    raise exception 'invalid listening accommodation' using errcode = '22023';
  end if;
  v_hash := game_private.sha256_text(pg_catalog.jsonb_build_object(
    'assignmentId', p_assignment_id, 'studentId', p_student_id,
    'timingMode', p_timing_mode, 'timingMultiplier', p_timing_multiplier,
    'flashIntensity', p_flash_intensity, 'screenShakeMax', p_screen_shake_max,
    'screamerDistortionAllowed', p_screamer_distortion_allowed,
    'listeningMode', p_listening_mode,
    'worldAudioEffectsEnabled', p_world_audio_effects_enabled
  )::text);
  v_previous := game_private.claim_rpc_request(
    v_teacher_id, 'public.set_game_accommodation_v2', p_request_id,
    v_hash, pg_catalog.now() + interval '30 days'
  );
  if v_previous is not null then return; end if;

  perform public.set_game_assignment_accommodation_v1(
    p_assignment_id, p_student_id, p_timing_mode, p_timing_multiplier,
    p_flash_intensity, p_screen_shake_max, p_screamer_distortion_allowed,
    p_request_id
  );
  select c.* into v_config
  from public.game_assignment_configs c
  join public.assignments a on a.id = c.assignment_id
  where c.assignment_id = p_assignment_id and a.teacher_id = v_teacher_id
  for update of c;
  if not found then
    raise exception 'game assignment not found or not owned by caller' using errcode = '42501';
  end if;
  if p_listening_mode = 'text_alternative'
     and 'listening_spelling' = any(v_config.question_types)
     and exists (
       select 1
       from public.game_assignment_vocabulary_sources gavs
       join public.vocabulary_words w
         on w.set_id = gavs.vocabulary_set_id and w.archived_at is null
       where gavs.assignment_id = p_assignment_id
         and not exists (
           select 1 from game_private.listening_audio_assets a
           where a.content_release_id = v_config.content_release_id
             and a.source_word_id = w.id
             and a.text_alternative_available
             and a.retired_at is null
             and a.provisioned_at is not null
         )
     ) then
    raise exception 'safe text alternatives are not provisioned for every active source word'
      using errcode = '42501';
  end if;
  update public.game_assignment_accommodations ac
  set listening_mode = p_listening_mode,
      world_audio_effects_enabled = p_world_audio_effects_enabled
  where ac.assignment_id = p_assignment_id and ac.student_id = p_student_id;
  perform game_private.complete_rpc_request(
    v_teacher_id, 'public.set_game_accommodation_v2', p_request_id,
    pg_catalog.jsonb_build_object('ok', true)
  );
end;
$$;

comment on function game.consume_p2p_listening_delivery_v1(text, uuid, uuid, uuid, uuid, integer, text, text, text) is
  'Worker resolver only. Atomically consumes one exact owner/grant binding and returns private R2 metadata; never grant to a browser role.';
comment on function public.set_game_assignment_accommodation_v2(uuid, uuid, text, numeric, text, smallint, boolean, text, boolean, uuid) is
  'Teacher-only trusted listening/text-alternative and world-audio-effects accommodation sibling.';

do $listening_v2_ownership_and_grants$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('game', 'game_private', 'public')
      and p.proname in (
        'bind_learning_attempt_accessibility_mode',
        'ensure_p2p_game_attempt_v2',
        'get_p2p_assignment_requirements_v2',
        'freeze_p2p_question_v2',
        'authorize_p2p_listening_audio_v2',
        'consume_p2p_listening_delivery_v1',
        'create_and_publish_game_assignment_v3',
        'set_game_assignment_accommodation_v2',
        'get_my_game_profile_v2',
        'get_teacher_game_report_v2'
      )
  loop
    execute pg_catalog.format('alter function %s owner to game_api_owner', v_function);
    execute pg_catalog.format(
      'revoke execute on function %s from public, anon, authenticated, service_role, game_server, games_api',
      v_function
    );
  end loop;

  execute 'grant execute on function public.create_and_publish_game_assignment_v3(text,text,timestamptz,uuid[],uuid[],uuid[],text[],text,text,integer,integer,numeric,smallint,boolean,text,text,boolean,boolean,boolean,boolean,numeric,text,text,timestamptz,uuid[],text[],uuid) to authenticated';
  execute 'grant execute on function public.set_game_assignment_accommodation_v2(uuid,uuid,text,numeric,text,smallint,boolean,text,boolean,uuid) to authenticated';
  execute 'grant execute on function public.get_my_game_profile_v2() to authenticated';
  execute 'grant execute on function public.get_teacher_game_report_v2(uuid) to authenticated';
  execute 'grant execute on function game.get_p2p_assignment_requirements_v2(text,uuid,uuid) to games_api';
  execute 'grant execute on function game.freeze_p2p_question_v2(text,uuid,uuid,integer,uuid,text,text,integer,integer,integer) to games_api';
  execute 'grant execute on function game.authorize_p2p_listening_audio_v2(text,uuid,uuid,integer,uuid) to games_api';
  execute 'grant execute on function game.consume_p2p_listening_delivery_v1(text,uuid,uuid,uuid,uuid,integer,text,text,text) to games_api';
end
$listening_v2_ownership_and_grants$;

revoke all privileges on table game_private.listening_audio_assets,
  game_private.listening_audio_deliveries,
  game_private.listening_audio_accesses,
  game_private.p2p_attempt_requirements,
  game_private.question_instances
  from public, anon, authenticated, service_role, game_server, games_api;
