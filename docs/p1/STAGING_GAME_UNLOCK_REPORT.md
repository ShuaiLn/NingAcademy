# Staging game-unlock and launch report

> Historical evidence only (2026-08-15): the checks below describe the former
> staging/server transport at the time they ran. The formal runtime was later
> replaced by Games Vercel + Host-authoritative WebRTC P2P + shared Production
> Supabase signaling. Keep the evidence intact; do not treat its deployment
> prerequisites as current rollout requirements.

Status: **MAIN-SITE STAGING GAME-UNLOCK READY**

Audit date: 2026-08-15

Target: `NingAcademy-staging` (`bopmtowjxjjjctoohhol`)

Production remained read-only throughout. No Production DDL, DML, migration
repair, deployment, secret change, or project relink was performed.

## Baseline disposition and result

The pre-write staging audit found no application users, storage objects, or
important data to preserve. The only non-migration application-schema object
was the already-reviewed Supabase Dashboard `public.rls_auto_enable()` helper
(IA-2); its exact normalized block matched the approved hash. No unknown or
high-risk object required deletion or reset.

The complete active queue was then established normally and the formal game
migrations were applied only to staging. Current result:

| Gate | Result |
| --- | --- |
| Git/staging migration history | **MATCH — 27/27** |
| Application schema drift | **0** after exact IA-2 disposition |
| ACL unresolved | **0** |
| UNKNOWN drift | **0** |
| PostgreSQL 17 clean replay | **PASS** |
| Scheme B fixture on clean replay | **PASS** |
| Scheme B fixture on staging | **PASS**, transaction rolled back |
| Convergence migrations, two additional passes | **PASS**, before/after drift 0 |

An intentional E2E teacher/student fixture remains in staging for repeatable
none/partial/all browser tests. It was created after the empty-staging
disposition and is test data, not pre-existing user data.

## Formal game migrations

- `20260815160000_game_phase0_contract.sql`
- `20260815170000_game_unlock_scheme_b.sql`
- `20260815180000_game_session_identity_v2.sql`
- `20260815190000_game_completion_acl_fix.sql`

The frozen pre-P-1 draft remains unchanged under `supabase/drafts/`; it was not
reactivated or entered into migration history.

## Scheme B contract

`public.assignables` is the single FK-backed identity surface for the three
independent existing work families:

- plain: `assignables.assignment_id -> assignments.id`, completion is the first
  non-null `submissions.submitted_at` for that student;
- vocabulary: `assignables.vocabulary_set_id -> vocabulary_sets.id`, completion
  requires a completed session with every typed word eventually correct,
  first-attempt typed accuracy at least 60%, and a file for every audio word;
- pronunciation: `assignables.pronunciation_task_id -> pronunciation_tasks.id`,
  completion is the first non-null `audio_submissions.submitted_at`.

The registry CHECK constraint and trigger logic exclude
`assignments.assignment_kind = 'game'`, preventing circular game requirements.
Teacher changes create a new immutable `game_assignment_versions` row and new
`game_unlock_requirements` snapshots. The configuration points to exactly one
current version; old versions remain audit history. Evaluation results are
server-maintained in `game_assignment_completion_status`.

## Access RPC

`public.get_game_access_status(p_assignment_id uuid)` accepts no user id. It
derives the student from the authenticated database session, verifies that the
student can currently access the game assignment, evaluates every requirement
from source-of-truth completion rows, refreshes the completion-status cache,
and returns one row:

- `allowed boolean`
- `assignment_id uuid`
- `assignment_version_id uuid | null`
- `version_no integer | null`
- `requirements jsonb[]` with requirement/assignable/source ids, kind, frozen
  title/due date, `completed`, and `completed_at`

The React UI only renders this result. It never accepts a client user id or
computes completion/access itself.

## Main-site UI and ticket issue

Teachers can create a game assignment from `/teacher/assignments/new/game` and
select published plain, vocabulary, and pronunciation requirements. They can
later replace the active requirement set from the game assignment detail page;
ownership and ready-profile checks are enforced by SECURITY DEFINER RPCs and
narrow grants/RLS.

Students see `🔒 尚未解锁` plus each complete/incomplete requirement when
`allowed=false`. The launch button remains disabled. When `allowed=true`, the
server action rechecks the RPC before issuing a 60-second, hash-stored,
version-bound launch ticket. The raw ticket is carried only in an HttpOnly
transition cookie and POST form body—never in a URL, client storage, or React
props. The transition CSP pins both the exact exchange origin and its configured
303 Games Web origin.

The database rechecks eligibility at issue and redemption, consumes the ticket
under a row lock, and rejects the second exchange even if the request id is
repeated. Requirement-version changes revoke outstanding tickets and sessions.

## Staging-backed Games E2E evidence

A real browser test used the staging Supabase/Auth/database and local builds of
the two application repositories:

1. none complete -> locked and no ticket;
2. one of three complete -> still locked and no ticket;
3. all complete -> ticket issued without a second login;
4. `POST /redeem` -> atomic staging RPC consumption;
5. Games server set an opaque host-only session cookie and returned 303;
6. Games Web validated the cookie against the server and joined a real
   Colyseus WSS room;
7. the room snapshot used only the database-authoritative student identity.

Negative coverage rejects an ordinary Supabase JWT, client `userId`, query
token, localStorage/fallback token, forged ticket, expired ticket, replayed
ticket, missing cookie, invalid cookie, foreign/missing Origin, and client
authoritative identity fields. Unit/integration tests also verify the production
cookie contract: `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`,
and no `Domain`.

## External staging deployment boundary

The code and staging database path pass end to end, but an externally hosted
Games staging deployment is not yet live. Staging currently has only the
NOLOGIN `game_server` group role, and this workspace has no restricted LOGIN
credential, Colyseus Cloud project/permission, Vercel Games project binding, or
staging domain configuration. Owner/service credentials are explicitly rejected
as production fallbacks. Provisioning those items is a STOP-condition external
operation; it does not change the completed main-site staging database result.
