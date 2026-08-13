-- Tab-switch/away visibility logging for vocabulary practice sessions (v1 +
-- v2 alike -- the client capture hook is attached in both practice-quiz-v1
-- and practice-quiz-v2). Teacher-visible as a timestamped list on the
-- per-session review page, for academic-integrity monitoring.

create table public.practice_session_tab_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.practice_sessions (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete restrict,
  event_type text not null check (event_type in ('hidden', 'visible')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.practice_session_tab_events is
  'One row per hidden/visible transition captured client-side during a practice session (both v1 and v2). Written only via log_practice_session_tab_event(), never directly -- authenticated has select only. Dedup against the immediately-preceding event for the same session happens inside that RPC.';

create index practice_session_tab_events_session_occurred_idx
  on public.practice_session_tab_events (session_id, occurred_at);

alter table public.practice_session_tab_events enable row level security;

create policy "practice_session_tab_events_select_own_or_own_students"
on public.practice_session_tab_events
for select
to authenticated
using (
  private.is_ready_profile()
  and (student_id = private.current_student_id() or private.teacher_owns_student(student_id))
);

grant select on public.practice_session_tab_events to authenticated;
grant select, insert, update, delete on public.practice_session_tab_events to service_role;
-- No insert grant to authenticated: writes only via the RPC below.

-- SECURITY DEFINER so the client (student) can log an event without a
-- direct insert grant on the table. `for update` locks the parent
-- practice_sessions row, serializing concurrent calls for the same session
-- (e.g. visibilitychange and the blur-fallback firing within milliseconds
-- of each other, or the pagehide beacon landing around the same time as an
-- in-flight visibilitychange call) -- without this lock, two concurrent
-- calls could both read the same "last event" before either has inserted,
-- turning the dedup check below into a race instead of a guarantee.
create function public.log_practice_session_tab_event(p_session_id uuid, p_event_type text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_student_id uuid;
  v_last_event_type text;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;
  if p_event_type not in ('hidden', 'visible') then
    raise exception 'invalid event_type %', p_event_type using errcode = '22023';
  end if;

  select student_id into v_student_id
  from public.practice_sessions
  where id = p_session_id and student_id = private.current_student_id()
  for update;

  if v_student_id is null then
    raise exception 'practice_session % not found or not owned by caller', p_session_id using errcode = '42501';
  end if;

  -- Dedup: a repeat of the same state (visibilitychange and the blur
  -- fallback both firing for one transition, or the unconditional pagehide
  -- beacon re-sending a "hidden" that a normal request already logged) is a
  -- silent no-op, not an error -- callers are fire-and-forget and must
  -- never see this as a failure.
  select event_type into v_last_event_type
  from public.practice_session_tab_events
  where session_id = p_session_id
  order by occurred_at desc
  limit 1;

  if v_last_event_type = p_event_type then
    return;
  end if;

  insert into public.practice_session_tab_events (session_id, student_id, event_type)
  values (p_session_id, v_student_id, p_event_type);
end;
$$;

revoke execute on function public.log_practice_session_tab_event(uuid, text) from public, anon;
grant execute on function public.log_practice_session_tab_event(uuid, text) to authenticated;
