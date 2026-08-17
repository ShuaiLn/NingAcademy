# NingAcademy

A one-on-one tutoring platform. A teacher manages students and classes and
assigns homework; students complete it and the teacher reviews/grades the
results. Chinese-language UI throughout.

## Stack

- **Next.js** (App Router, Server Actions) + React + TypeScript
- **Supabase**: Postgres (RLS-first schema, `SECURITY DEFINER` RPCs for
  every write path), Auth, Storage (direct-to-Storage two-phase uploads),
  Edge Functions (expired-upload cleanup, on a `pg_cron` schedule)
- **Tailwind CSS**

See `AGENTS.md` for the schema/backend conventions this codebase follows —
read it before writing a new migration.

## Environment variables

Copy into `.env.local` (never commit real values):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
# Server-only. NEVER prefix with NEXT_PUBLIC_. From the Supabase dashboard's
# API settings (secret / service_role key).
SUPABASE_SECRET_KEY=
# One-time /setup teacher-bootstrap token, generated locally -- not derived
# from any Supabase secret.
SETUP_TOKEN=
# Server-only exact Games Vercel exchange endpoint. Production value:
# https://game.ningacademy.org/redeem
GAME_LAUNCH_EXCHANGE_URL=
```

## Development

```
npm install
npm run dev          # start the dev server
npm run build         # production build
npm run typecheck     # tsc --noEmit
npm run lint           # eslint
```

Database schema lives entirely in `supabase/migrations/*.sql`, applied in
filename-timestamp order against the linked Supabase project (there is no
local Postgres instance in this setup — `supabase/config.toml` documents
local-dev ports for reference, but development targets the hosted
project directly). After a schema change, regenerate `supabase/database.
types.ts` from the Supabase CLI (`supabase gen types typescript`) so the
client stays type-safe.

Every change under `supabase/migrations/`, `supabase/config.toml`,
`docs/p1/`, or `scripts/p1/` is replayed into an empty database from
scratch in CI (`.github/workflows/p1-database-audit.yml`) and checked
against a committed hash inventory (`npm run audit:p1:git-migrations`) —
see `docs/p1/README.md` and `AGENTS.md` before writing a new migration.

`npm run lint` currently fails at startup: the installed `typescript-eslint`
doesn't yet support TypeScript 7 (tracked upstream). This is a toolchain
mismatch, not a code issue, and predates it. There is no `test` script.

## Features

- **Auth**: username/password (no email signup); a teacher bootstraps via
  a one-time `/setup` token, then creates student accounts directly.
- **Vocabulary homework**: teacher-authored word sets. Two coexisting
  practice engines (see `AGENTS.md`) — the original one-shot spelling
  drill, and a newer retry-until-correct engine supporting multiple input
  modes (spell the English term, type a Chinese translation with
  multi-answer matching, or record pronunciation audio), per-word display/
  input overrides, teacher-set or randomized word order, and full
  per-question review for both engines.
- **Plain assignments**: teacher attaches files/instructions; students
  upload a submission; teacher grades it.
- **Pronunciation ("跟读") tasks**: legacy standalone reading-aloud
  homework — students record audio per prompt line; teacher grades.
  Still fully functional, no longer a new-creation entry point (see
  `AGENTS.md`).
- **Exams**: teacher records who sat an exam and grades each paper
  (optionally attaching photos of the graded paper).
- **Lesson summaries**: a shared free-text note from a session, sent to
  one or more students.
- **Teacher dashboard**: due/overdue items across all homework types,
  recent activity, per-student stats.
- **Game homework (Scheme B + WebRTC Host-P2P)**: a fourth homework kind
  (`assignments.assignment_kind = 'game'`) launched into the independent
  Games Vercel app through a one-time ticket. The Host browser runs the
  authoritative simulation and 2–8 players exchange game traffic over a
  star of RTCDataChannels; the shared NingAcademy Production Supabase stores
  the Games session and short-lived signaling only. Teachers can create a game
  assignment and version its unlock requirements across plain, vocabulary,
  and pronunciation work; students see database-authoritative lock details.
  The earlier staging audit remains historical evidence in
  `docs/p1/STAGING_GAME_UNLOCK_REPORT.md`; as of 2026-08-16 the game schema
  and P2P signaling migrations are deployed to the Production Supabase (see
  `docs/p1/MIGRATION_DRIFT_REPORT.md`). Every future Production migration —
  including the currently-drafted `rls_auto_enable()` EXECUTE-grant fix —
  still requires a fresh read-only preflight plus explicit approval before
  any Production DDL/DML.
