-- Rev2.1 Scheme B: the three existing assignment families remain independent,
-- while this registry gives game unlocks one FK-backed identity surface.
-- Completion, version snapshots, access decisions and launch-ticket binding
-- are database-authoritative. No function accepts a caller-supplied user id.

do $membership$
begin
  execute pg_catalog.format('grant game_api_owner to %I', current_user);
end
$membership$;

-- ALTER ... OWNER requires the destination role to have CREATE on the target
-- schema. This is temporary and is revoked again before the migration ends.
grant create on schema public, private to game_api_owner;

-- ============================================================================
-- Unified assignable registry (plain, vocabulary, pronunciation only)
-- ============================================================================

create table public.assignables (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete restrict,
  assignable_kind text not null
    check (assignable_kind in ('plain', 'vocabulary', 'pronunciation')),
  assignment_id uuid unique references public.assignments (id) on delete restrict,
  vocabulary_set_id uuid unique references public.vocabulary_sets (id) on delete restrict,
  pronunciation_task_id uuid unique references public.pronunciation_tasks (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint assignables_kind_matches_source check (
    (assignable_kind = 'plain'
      and assignment_id is not null
      and vocabulary_set_id is null
      and pronunciation_task_id is null)
    or (assignable_kind = 'vocabulary'
      and assignment_id is null
      and vocabulary_set_id is not null
      and pronunciation_task_id is null)
    or (assignable_kind = 'pronunciation'
      and assignment_id is null
      and vocabulary_set_id is null
      and pronunciation_task_id is not null)
  )
);

comment on table public.assignables is
  'Scheme B identity registry for unlock-eligible work. It never contains assignments.assignment_kind=game, so a game cannot unlock itself or another game.';

create index assignables_teacher_kind_idx
  on public.assignables (teacher_id, assignable_kind, created_at);

alter table public.assignables enable row level security;
revoke all on public.assignables from public, anon, authenticated, service_role;

create function private.register_plain_assignable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignment_kind = 'plain' then
    insert into public.assignables (teacher_id, assignable_kind, assignment_id)
    values (new.teacher_id, 'plain', new.id)
    on conflict (assignment_id) do nothing;
  end if;
  return new;
end;
$$;

create function private.register_vocabulary_assignable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.assignables (teacher_id, assignable_kind, vocabulary_set_id)
  values (new.teacher_id, 'vocabulary', new.id)
  on conflict (vocabulary_set_id) do nothing;
  return new;
end;
$$;

create function private.register_pronunciation_assignable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.assignables (teacher_id, assignable_kind, pronunciation_task_id)
  values (new.teacher_id, 'pronunciation', new.id)
  on conflict (pronunciation_task_id) do nothing;
  return new;
end;
$$;

create trigger assignments_register_plain_assignable
after insert on public.assignments
for each row execute function private.register_plain_assignable();

create trigger vocabulary_sets_register_assignable
after insert on public.vocabulary_sets
for each row execute function private.register_vocabulary_assignable();

create trigger pronunciation_tasks_register_assignable
after insert on public.pronunciation_tasks
for each row execute function private.register_pronunciation_assignable();

insert into public.assignables (teacher_id, assignable_kind, assignment_id)
select a.teacher_id, 'plain', a.id
from public.assignments a
where a.assignment_kind = 'plain'
on conflict (assignment_id) do nothing;

insert into public.assignables (teacher_id, assignable_kind, vocabulary_set_id)
select s.teacher_id, 'vocabulary', s.id
from public.vocabulary_sets s
on conflict (vocabulary_set_id) do nothing;

insert into public.assignables (teacher_id, assignable_kind, pronunciation_task_id)
select t.teacher_id, 'pronunciation', t.id
from public.pronunciation_tasks t
on conflict (pronunciation_task_id) do nothing;

-- ============================================================================
-- Immutable unlock versions, requirements and server-evaluated status
-- ============================================================================

create table public.game_assignment_versions (
  id uuid primary key default gen_random_uuid(),
  game_assignment_id uuid not null
    references public.game_assignment_configs (assignment_id) on delete restrict,
  version_no integer not null check (version_no > 0),
  created_by_teacher_id uuid not null references public.teachers (id) on delete restrict,
  request_id uuid not null,
  requirements_hash bytea not null check (octet_length(requirements_hash) = 32),
  config_snapshot jsonb not null check (jsonb_typeof(config_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (game_assignment_id, version_no),
  unique (game_assignment_id, request_id),
  unique (id, game_assignment_id)
);

create table public.game_unlock_requirements (
  id uuid primary key default gen_random_uuid(),
  game_assignment_version_id uuid not null
    references public.game_assignment_versions (id) on delete restrict,
  assignable_id uuid not null references public.assignables (id) on delete restrict,
  assignable_kind_snapshot text not null
    check (assignable_kind_snapshot in ('plain', 'vocabulary', 'pronunciation')),
  title_snapshot text not null
    check (btrim(title_snapshot) <> '' and char_length(title_snapshot) <= 200),
  due_at_snapshot timestamptz,
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (game_assignment_version_id, assignable_id),
  unique (id, game_assignment_version_id)
);

alter table public.game_assignment_configs
  add column current_unlock_version_id uuid;

alter table public.game_assignment_configs
  add constraint game_assignment_configs_current_unlock_version_fk
  foreign key (current_unlock_version_id, assignment_id)
  references public.game_assignment_versions (id, game_assignment_id)
  on delete restrict;

create table public.game_assignment_completion_status (
  game_assignment_id uuid not null,
  game_assignment_version_id uuid not null,
  requirement_id uuid not null,
  student_id uuid not null references public.students (id) on delete restrict,
  completed boolean not null,
  completed_at timestamptz,
  evaluated_at timestamptz not null default now(),
  primary key (game_assignment_version_id, requirement_id, student_id),
  constraint game_assignment_completion_version_fk
    foreign key (game_assignment_version_id, game_assignment_id)
    references public.game_assignment_versions (id, game_assignment_id)
    on delete restrict,
  constraint game_assignment_completion_requirement_fk
    foreign key (requirement_id, game_assignment_version_id)
    references public.game_unlock_requirements (id, game_assignment_version_id)
    on delete restrict,
  constraint game_assignment_completion_timestamp check (
    (completed and completed_at is not null)
    or (not completed and completed_at is null)
  )
);

comment on table public.game_assignment_versions is
  'Immutable snapshots. Editing requirements creates a new version and atomically moves game_assignment_configs.current_unlock_version_id.';
comment on table public.game_unlock_requirements is
  'Immutable, FK-backed requirements for one game-assignment version. Snapshot labels keep historical reviews intelligible after source edits.';
comment on table public.game_assignment_completion_status is
  'Server-evaluated evidence cache keyed by student, immutable version and requirement. get_game_access_status recomputes from source-of-truth work before every response.';

alter table public.game_assignment_versions enable row level security;
alter table public.game_unlock_requirements enable row level security;
alter table public.game_assignment_completion_status enable row level security;

revoke all on public.game_assignment_versions from public, anon, authenticated, service_role;
revoke all on public.game_unlock_requirements from public, anon, authenticated, service_role;
revoke all on public.game_assignment_completion_status from public, anon, authenticated, service_role;

create function private.reject_game_unlock_snapshot_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'game unlock versions and requirements are immutable; create a new version'
    using errcode = 'P0001';
end;
$$;

create trigger game_assignment_versions_immutable
before update or delete on public.game_assignment_versions
for each row execute function private.reject_game_unlock_snapshot_mutation();

create trigger game_unlock_requirements_immutable
before update or delete on public.game_unlock_requirements
for each row execute function private.reject_game_unlock_snapshot_mutation();

-- Exactly mirrors app/_lib/vocabulary-completion.ts: at least one completed
-- session must have every typed word eventually correct, >=60% first-attempt
-- accuracy, and one recording for every audio-input word.
create function private.get_assignable_completion(
  p_assignable_id uuid,
  p_student_id uuid
)
returns table (completed boolean, completed_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_assignable public.assignables;
  v_completed_at timestamptz;
begin
  select a.* into v_assignable
  from public.assignables a
  where a.id = p_assignable_id;

  if not found or p_student_id is null then
    return query select false, null::timestamptz;
    return;
  end if;

  if v_assignable.assignable_kind = 'plain' then
    select min(s.submitted_at) into v_completed_at
    from public.submissions s
    where s.assignment_id = v_assignable.assignment_id
      and s.student_id = p_student_id
      and s.submitted_at is not null;
  elsif v_assignable.assignable_kind = 'pronunciation' then
    select min(s.submitted_at) into v_completed_at
    from public.audio_submissions s
    where s.task_id = v_assignable.pronunciation_task_id
      and s.student_id = p_student_id
      and s.submitted_at is not null;
  else
    select min(ps.completed_at) into v_completed_at
    from public.practice_sessions ps
    where ps.set_id = v_assignable.vocabulary_set_id
      and ps.student_id = p_student_id
      and ps.completed_at is not null
      and (
        ps.total_words - ps.audio_word_count = 0
        or (
          (
            select count(distinct va.word_id)
            from public.vocabulary_attempts va
            join public.practice_session_words psw
              on psw.session_id = va.session_id and psw.word_id = va.word_id
            where va.session_id = ps.id
              and psw.input_mode <> 'audio'
              and va.is_correct
          ) = ps.total_words - ps.audio_word_count
          and (
            select count(distinct va.word_id)
            from public.vocabulary_attempts va
            join public.practice_session_words psw
              on psw.session_id = va.session_id and psw.word_id = va.word_id
            where va.session_id = ps.id
              and psw.input_mode <> 'audio'
              and va.attempt_no = 1
              and va.is_correct
          ) * 10 >= (ps.total_words - ps.audio_word_count) * 6
        )
      )
      and (
        ps.audio_word_count = 0
        or (
          select count(distinct f.word_id)
          from public.vocabulary_audio_submission_files f
          join public.vocabulary_audio_submissions s
            on s.id = f.vocabulary_audio_submission_id
          where s.session_id = ps.id
        ) = ps.audio_word_count
      );
  end if;

  return query select v_completed_at is not null, v_completed_at;
end;
$$;

create function private.game_access_allowed(
  p_student_id uuid,
  p_game_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.students s where s.id = p_student_id)
    and game_private.user_can_access_game_assignment(p_student_id, p_game_assignment_id)
    and c.current_unlock_version_id is not null
    and coalesce((
      select bool_and(e.completed)
      from public.game_unlock_requirements r
      cross join lateral private.get_assignable_completion(r.assignable_id, p_student_id) e
      where r.game_assignment_version_id = c.current_unlock_version_id
    ), true)
  from public.game_assignment_configs c
  where c.assignment_id = p_game_assignment_id
$$;

-- ============================================================================
-- Teacher configuration and student access RPCs
-- ============================================================================

create function public.list_my_assignables_v1()
returns table (
  assignable_id uuid,
  assignable_kind text,
  source_id uuid,
  title text,
  due_at timestamptz
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
    raise exception 'account is not ready' using errcode = '28000';
  end if;
  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'caller is not a teacher' using errcode = '42501';
  end if;

  return query
  select
    ar.id,
    ar.assignable_kind,
    coalesce(ar.assignment_id, ar.vocabulary_set_id, ar.pronunciation_task_id),
    coalesce(pa.title, vs.title, pt.title),
    coalesce(pa.due_at, vs.due_at, pt.due_at)
  from public.assignables ar
  left join public.assignments pa on pa.id = ar.assignment_id
  left join public.vocabulary_sets vs on vs.id = ar.vocabulary_set_id
  left join public.pronunciation_tasks pt on pt.id = ar.pronunciation_task_id
  where ar.teacher_id = v_teacher_id
    and (
      (ar.assignable_kind = 'plain' and pa.assignment_kind = 'plain'
        and pa.published_at is not null and pa.archived_at is null)
      or (ar.assignable_kind = 'vocabulary'
        and vs.published_at is not null and vs.archived_at is null)
      or (ar.assignable_kind = 'pronunciation'
        and pt.published_at is not null and pt.archived_at is null)
    )
  order by ar.assignable_kind, coalesce(pa.title, vs.title, pt.title), ar.id;
end;
$$;

create function public.list_game_unlock_candidates_v1(p_game_assignment_id uuid)
returns table (
  assignable_id uuid,
  assignable_kind text,
  source_id uuid,
  title text,
  due_at timestamptz,
  selected boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_current_version_id uuid;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not ready' using errcode = '28000';
  end if;

  v_teacher_id := private.current_teacher_id();
  select c.current_unlock_version_id into v_current_version_id
  from public.game_assignment_configs c
  join public.assignments a on a.id = c.assignment_id
  where c.assignment_id = p_game_assignment_id
    and a.teacher_id = v_teacher_id
    and a.assignment_kind = 'game';

  if not found then
    raise exception 'game assignment not found or not owned by caller' using errcode = '42501';
  end if;

  return query
  select
    ar.id,
    ar.assignable_kind,
    coalesce(ar.assignment_id, ar.vocabulary_set_id, ar.pronunciation_task_id),
    coalesce(pa.title, vs.title, pt.title),
    coalesce(pa.due_at, vs.due_at, pt.due_at),
    exists (
      select 1 from public.game_unlock_requirements r
      where r.game_assignment_version_id = v_current_version_id
        and r.assignable_id = ar.id
    )
  from public.assignables ar
  left join public.assignments pa on pa.id = ar.assignment_id
  left join public.vocabulary_sets vs on vs.id = ar.vocabulary_set_id
  left join public.pronunciation_tasks pt on pt.id = ar.pronunciation_task_id
  where ar.teacher_id = v_teacher_id
    and (
      (ar.assignable_kind = 'plain'
        and pa.assignment_kind = 'plain'
        and pa.published_at is not null and pa.archived_at is null)
      or (ar.assignable_kind = 'vocabulary'
        and vs.published_at is not null and vs.archived_at is null)
      or (ar.assignable_kind = 'pronunciation'
        and pt.published_at is not null and pt.archived_at is null)
      or exists (
        select 1 from public.game_unlock_requirements r
        where r.game_assignment_version_id = v_current_version_id
          and r.assignable_id = ar.id
      )
    )
  order by ar.assignable_kind, coalesce(pa.title, vs.title, pt.title), ar.id;
end;
$$;

create function public.set_game_unlock_requirements_v1(
  p_game_assignment_id uuid,
  p_assignable_ids uuid[],
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_config public.game_assignment_configs;
  v_version_id uuid;
  v_existing public.game_assignment_versions;
  v_version_no integer;
  v_requirements_hash bytea;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not ready' using errcode = '28000';
  end if;
  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null or p_request_id is null then
    raise exception 'teacher identity and request id are required' using errcode = '28000';
  end if;

  select c.* into v_config
  from public.game_assignment_configs c
  join public.assignments a on a.id = c.assignment_id
  where c.assignment_id = p_game_assignment_id
    and a.teacher_id = v_teacher_id
    and a.assignment_kind = 'game'
  for update of c;

  if not found then
    raise exception 'game assignment not found or not owned by caller' using errcode = '42501';
  end if;

  if exists (
    select 1 from pg_catalog.unnest(coalesce(p_assignable_ids, array[]::uuid[])) x(id)
    where x.id is null
  ) or (
    select count(*) from pg_catalog.unnest(coalesce(p_assignable_ids, array[]::uuid[]))
  ) <> (
    select count(distinct id) from pg_catalog.unnest(coalesce(p_assignable_ids, array[]::uuid[])) x(id)
  ) then
    raise exception 'p_assignable_ids must contain unique non-null ids' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_assignable_ids, array[]::uuid[])) requested(id)
    left join public.assignables ar on ar.id = requested.id
    left join public.assignments pa on pa.id = ar.assignment_id
    left join public.vocabulary_sets vs on vs.id = ar.vocabulary_set_id
    left join public.pronunciation_tasks pt on pt.id = ar.pronunciation_task_id
    where ar.id is null
      or ar.teacher_id <> v_teacher_id
      or not (
        (ar.assignable_kind = 'plain' and pa.assignment_kind = 'plain'
          and pa.published_at is not null and pa.archived_at is null)
        or (ar.assignable_kind = 'vocabulary'
          and vs.published_at is not null and vs.archived_at is null)
        or (ar.assignable_kind = 'pronunciation'
          and pt.published_at is not null and pt.archived_at is null)
      )
  ) then
    raise exception 'an unlock requirement is missing, inactive, game-typed, or not owned by caller'
      using errcode = '42501';
  end if;

  v_requirements_hash := pg_catalog.sha256(pg_catalog.convert_to(coalesce((
    select pg_catalog.string_agg(id::text, ',' order by id)
    from pg_catalog.unnest(coalesce(p_assignable_ids, array[]::uuid[])) x(id)
  ), ''), 'UTF8'));

  select v.* into v_existing
  from public.game_assignment_versions v
  where v.game_assignment_id = p_game_assignment_id
    and v.request_id = p_request_id;

  if found then
    if v_existing.requirements_hash <> v_requirements_hash then
      raise exception 'request id was already used with different requirements' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  if v_config.current_unlock_version_id is not null then
    select v.* into v_existing
    from public.game_assignment_versions v
    where v.id = v_config.current_unlock_version_id;
    if v_existing.requirements_hash = v_requirements_hash then
      return v_existing.id;
    end if;
  end if;

  select coalesce(max(v.version_no), 0) + 1 into v_version_no
  from public.game_assignment_versions v
  where v.game_assignment_id = p_game_assignment_id;

  insert into public.game_assignment_versions (
    game_assignment_id, version_no, created_by_teacher_id, request_id,
    requirements_hash, config_snapshot
  ) values (
    p_game_assignment_id, v_version_no, v_teacher_id, p_request_id,
    v_requirements_hash, to_jsonb(v_config) - 'current_unlock_version_id'
  ) returning id into v_version_id;

  insert into public.game_unlock_requirements (
    game_assignment_version_id, assignable_id, assignable_kind_snapshot,
    title_snapshot, due_at_snapshot, sort_order
  )
  select
    v_version_id,
    ar.id,
    ar.assignable_kind,
    coalesce(pa.title, vs.title, pt.title),
    coalesce(pa.due_at, vs.due_at, pt.due_at),
    row_number() over (order by ar.assignable_kind, coalesce(pa.title, vs.title, pt.title), ar.id)::integer - 1
  from public.assignables ar
  left join public.assignments pa on pa.id = ar.assignment_id
  left join public.vocabulary_sets vs on vs.id = ar.vocabulary_set_id
  left join public.pronunciation_tasks pt on pt.id = ar.pronunciation_task_id
  where ar.id = any (coalesce(p_assignable_ids, array[]::uuid[]));

  update public.game_assignment_configs c
  set current_unlock_version_id = v_version_id
  where c.assignment_id = p_game_assignment_id;

  insert into public.audit_log (
    actor_user_id, actor_type, action, target_table, target_id,
    request_id, outcome, detail
  ) values (
    v_teacher_id, 'teacher', 'game.unlock_requirements.set',
    'game_assignment_versions', v_version_id, p_request_id, 'succeeded',
    pg_catalog.jsonb_build_object(
      'gameAssignmentId', p_game_assignment_id,
      'versionNo', v_version_no,
      'requirementCount', coalesce(pg_catalog.cardinality(p_assignable_ids), 0)
    )
  );

  return v_version_id;
end;
$$;

create function public.get_game_access_status(p_assignment_id uuid)
returns table (
  allowed boolean,
  assignment_id uuid,
  assignment_version_id uuid,
  version_no integer,
  requirements jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_version public.game_assignment_versions;
  v_requirement public.game_unlock_requirements;
  v_evaluation record;
  v_allowed boolean;
  v_requirements jsonb;
begin
  v_student_id := private.current_student_id();

  if v_student_id is null
     or not game_private.user_can_access_game_assignment(v_student_id, p_assignment_id) then
    return query select false, p_assignment_id, null::uuid, null::integer, '[]'::jsonb;
    return;
  end if;

  select v.* into v_version
  from public.game_assignment_configs c
  join public.game_assignment_versions v on v.id = c.current_unlock_version_id
  where c.assignment_id = p_assignment_id;

  if not found then
    return query select false, p_assignment_id, null::uuid, null::integer, '[]'::jsonb;
    return;
  end if;

  for v_requirement in
    select r.* from public.game_unlock_requirements r
    where r.game_assignment_version_id = v_version.id
    order by r.sort_order, r.id
  loop
    select * into v_evaluation
    from private.get_assignable_completion(v_requirement.assignable_id, v_student_id);

    insert into public.game_assignment_completion_status (
      game_assignment_id, game_assignment_version_id, requirement_id,
      student_id, completed, completed_at, evaluated_at
    ) values (
      p_assignment_id, v_version.id, v_requirement.id,
      v_student_id, v_evaluation.completed, v_evaluation.completed_at, pg_catalog.now()
    )
    on conflict (game_assignment_version_id, requirement_id, student_id)
    do update set
      completed = excluded.completed,
      completed_at = excluded.completed_at,
      evaluated_at = excluded.evaluated_at;
  end loop;

  select
    coalesce(bool_and(s.completed), true),
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'requirement_id', r.id,
        'assignable_id', r.assignable_id,
        'kind', r.assignable_kind_snapshot,
        'source_id', coalesce(ar.assignment_id, ar.vocabulary_set_id, ar.pronunciation_task_id),
        'title', r.title_snapshot,
        'due_at', r.due_at_snapshot,
        'completed', s.completed,
        'completed_at', s.completed_at
      ) order by r.sort_order, r.id
    ) filter (where r.id is not null), '[]'::jsonb)
  into v_allowed, v_requirements
  from public.game_unlock_requirements r
  left join public.assignables ar on ar.id = r.assignable_id
  left join public.game_assignment_completion_status s
    on s.game_assignment_version_id = r.game_assignment_version_id
   and s.requirement_id = r.id
   and s.student_id = v_student_id
  where r.game_assignment_version_id = v_version.id;

  return query select v_allowed, p_assignment_id, v_version.id, v_version.version_no, v_requirements;
end;
$$;

-- Atomic sibling for the teacher UI: the existing P0 v1 RPC creates the game
-- assignment/config/targets, then this same transaction creates version 1.
create function public.create_and_publish_game_assignment_v2(
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
  p_request_id uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_assignment_id uuid;
begin
  v_assignment_id := public.create_and_publish_game_assignment_v1(
    p_title, p_description, p_due_at, p_class_ids, p_student_ids,
    p_vocabulary_set_ids, p_allowed_modes, p_map_key, p_learning_difficulty,
    p_minimum_day, p_minimum_learning_questions, p_minimum_accuracy,
    p_screen_shake_max, p_hit_stop_allowed, p_flash_intensity,
    p_shard_intensity, p_screamer_distortion_allowed, p_slow_motion_allowed,
    p_camera_bob_allowed, p_motion_blur_allowed, p_timing_multiplier,
    p_ruleset_version, p_content_release_id, p_retention_until, p_request_id
  );

  perform public.set_game_unlock_requirements_v1(
    v_assignment_id, p_requirement_assignable_ids, p_request_id
  );
  return v_assignment_id;
end;
$$;

-- ============================================================================
-- Ticket/version binding and fail-closed launch gate
-- ============================================================================

alter table game_private.launch_tickets
  add column assignment_version_id uuid;

alter table game_private.launch_tickets
  add constraint launch_tickets_assignment_version_fk
  foreign key (assignment_version_id, assignment_id)
  references public.game_assignment_versions (id, game_assignment_id)
  on delete restrict;

alter table game_private.launch_tickets
  add constraint launch_tickets_assignment_version_required check (
    assignment_id is not null and assignment_version_id is not null
  );

alter table game_private.game_auth_sessions
  add column assignment_version_id uuid;

alter table game_private.game_auth_sessions
  add constraint game_auth_sessions_assignment_version_fk
  foreign key (assignment_version_id, assignment_id)
  references public.game_assignment_versions (id, game_assignment_id)
  on delete restrict;

alter table game_private.game_auth_sessions
  add constraint game_auth_sessions_assignment_version_required check (
    assignment_id is not null and assignment_version_id is not null
  );

create function private.enforce_launch_ticket_game_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignment_id is null
     or not exists (select 1 from public.students s where s.id = new.user_id)
     or not private.game_access_allowed(new.user_id, new.assignment_id) then
    raise exception 'game unlock requirements are not complete' using errcode = '42501';
  end if;

  select c.current_unlock_version_id into new.assignment_version_id
  from public.game_assignment_configs c
  where c.assignment_id = new.assignment_id;

  if new.assignment_version_id is null then
    raise exception 'game assignment has no active unlock version' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger launch_tickets_enforce_game_access
before insert on game_private.launch_tickets
for each row execute function private.enforce_launch_ticket_game_access();

create function private.bind_game_auth_session_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select lt.assignment_version_id into new.assignment_version_id
  from game_private.launch_tickets lt
  where lt.id = new.launch_ticket_id
    and lt.assignment_id = new.assignment_id;

  if new.assignment_version_id is null then
    raise exception 'launch ticket version binding is invalid' using errcode = '28000';
  end if;
  return new;
end;
$$;

create trigger game_auth_sessions_bind_assignment_version
before insert on game_private.game_auth_sessions
for each row execute function private.bind_game_auth_session_version();

-- HTTP exchanges are deliberately not idempotent. The Games server creates a
-- fresh exchange id for every POST, and any ticket whose used_at is set is a
-- replay even when a caller repeats the same exchange id. The row lock keeps
-- concurrent exchanges atomic: exactly one transaction can consume a ticket.
create or replace function game.redeem_game_launch_ticket_v1(
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

  if v_ticket.used_at is not null then
    raise exception 'launch ticket has already been consumed' using errcode = '28000';
  end if;

  if v_ticket.expires_at <= pg_catalog.now() then
    raise exception 'launch ticket expired' using errcode = '28000';
  end if;

  if not game_private.user_is_ready(v_ticket.user_id)
     or not private.game_access_allowed(v_ticket.user_id, v_ticket.assignment_id) then
    raise exception 'launch eligibility changed before exchange' using errcode = '28000';
  end if;

  v_raw_session_token := game_private.base64url(
    game_private.sha256_text(
      p_launch_ticket || ':' || p_exchange_request_id::text || ':game-session-v1'
    )
  );
  v_force_exit_at := pg_catalog.now() + interval '5 hours';

  insert into game_private.game_auth_sessions (
    launch_ticket_id, session_token_hash, user_id, assignment_id, expires_at
  ) values (
    v_ticket.id, game_private.sha256_text(v_raw_session_token),
    v_ticket.user_id, v_ticket.assignment_id, v_force_exit_at
  );

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

-- Requirement-version switches update game_assignment_configs, so the P0
-- revoke-on-config trigger immediately revokes outstanding tickets/sessions.

-- Scheme B's SECURITY DEFINER surface shares the deliberately constrained
-- game_api_owner used by Phase 0. Existing completion tables need explicit
-- SELECT + RLS visibility for that owner; browser/runtime roles still receive
-- no direct table privilege. New snapshot/cache tables are owner-bypassed only
-- inside this controlled function surface.
grant select on public.pronunciation_tasks, public.submissions,
  public.audio_submissions, public.practice_sessions,
  public.practice_session_words, public.vocabulary_attempts,
  public.vocabulary_audio_submissions, public.vocabulary_audio_submission_files
  to game_api_owner;

create policy "pronunciation_tasks_game_api_owner_select"
on public.pronunciation_tasks for select to game_api_owner using (true);
create policy "submissions_game_api_owner_select"
on public.submissions for select to game_api_owner using (true);
create policy "audio_submissions_game_api_owner_select"
on public.audio_submissions for select to game_api_owner using (true);
create policy "practice_sessions_game_api_owner_select"
on public.practice_sessions for select to game_api_owner using (true);
create policy "practice_session_words_game_api_owner_select"
on public.practice_session_words for select to game_api_owner using (true);
create policy "vocabulary_attempts_game_api_owner_select"
on public.vocabulary_attempts for select to game_api_owner using (true);
create policy "vocabulary_audio_submissions_game_api_owner_select"
on public.vocabulary_audio_submissions for select to game_api_owner using (true);
create policy "vocabulary_audio_submission_files_game_api_owner_select"
on public.vocabulary_audio_submission_files for select to game_api_owner using (true);

alter table public.assignables owner to game_api_owner;
alter table public.game_assignment_versions owner to game_api_owner;
alter table public.game_unlock_requirements owner to game_api_owner;
alter table public.game_assignment_completion_status owner to game_api_owner;

alter function private.register_plain_assignable() owner to game_api_owner;
alter function private.register_vocabulary_assignable() owner to game_api_owner;
alter function private.register_pronunciation_assignable() owner to game_api_owner;
alter function private.reject_game_unlock_snapshot_mutation() owner to game_api_owner;
alter function private.get_assignable_completion(uuid, uuid) owner to game_api_owner;
alter function private.game_access_allowed(uuid, uuid) owner to game_api_owner;
alter function private.enforce_launch_ticket_game_access() owner to game_api_owner;
alter function private.bind_game_auth_session_version() owner to game_api_owner;
alter function public.list_my_assignables_v1() owner to game_api_owner;
alter function public.list_game_unlock_candidates_v1(uuid) owner to game_api_owner;
alter function public.set_game_unlock_requirements_v1(uuid, uuid[], uuid) owner to game_api_owner;
alter function public.get_game_access_status(uuid) owner to game_api_owner;
alter function public.create_and_publish_game_assignment_v2(
  text, text, timestamptz, uuid[], uuid[], uuid[], text[], text, text,
  integer, integer, numeric, smallint, boolean, text, text, boolean, boolean,
  boolean, boolean, numeric, text, text, timestamptz, uuid[], uuid
) owner to game_api_owner;

revoke execute on function private.register_plain_assignable() from public, anon, authenticated, service_role;
revoke execute on function private.register_vocabulary_assignable() from public, anon, authenticated, service_role;
revoke execute on function private.register_pronunciation_assignable() from public, anon, authenticated, service_role;
revoke execute on function private.reject_game_unlock_snapshot_mutation() from public, anon, authenticated, service_role;
revoke execute on function private.get_assignable_completion(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.game_access_allowed(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.enforce_launch_ticket_game_access() from public, anon, authenticated, service_role;
revoke execute on function private.bind_game_auth_session_version() from public, anon, authenticated, service_role;

do $rpc_grants$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'list_my_assignables_v1',
        'list_game_unlock_candidates_v1',
        'set_game_unlock_requirements_v1',
        'get_game_access_status',
        'create_and_publish_game_assignment_v2'
      )
  loop
    execute pg_catalog.format(
      'revoke execute on function %s from public, anon, authenticated, service_role',
      v_function
    );
    execute pg_catalog.format('grant execute on function %s to authenticated', v_function);
  end loop;
end
$rpc_grants$;

do $membership$
begin
  revoke create on schema public, private from game_api_owner;
  execute pg_catalog.format('revoke game_api_owner from %I', current_user);
end
$membership$;
