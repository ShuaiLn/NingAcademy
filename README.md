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
