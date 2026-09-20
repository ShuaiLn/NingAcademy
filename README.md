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
# Emergency release kill switch. Omit/true enables the learner OCR import;
# false hides its entry point, returns 404 for the route, and blocks its action.
NEXT_PUBLIC_PERSONAL_WORD_OCR_ENABLED=true
```

## Development

```
npm install
npm run dev          # start the dev server
npm run build         # production build
npm run typecheck     # tsc --noEmit
npm run lint           # eslint
npm test              # authorization + Personal English pgTAP suites (requires local Supabase/Docker)
npm run test:phase2-db # Phase 2 OCR pgTAP/security/order suites (same requirement)
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

`npm run lint` runs the configured ESLint checks. `npm test` runs the
authorization and Personal English pgTAP suites against a running local
Supabase stack, so it is not a Docker-free developer check; the P-1 GitHub
workflow provisions that stack for its clean replay and database tests.

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
- **Personal-word photo import (Phase 2)**: a learner can process one
  JPEG/PNG/WebP worksheet photo entirely in the browser, review privacy-filtered
  word candidates, and atomically save only confirmed fields. No photo, raw
  OCR/NER evidence, rejected line, or unconfirmed edit is uploaded or stored.

Phase 2 local checks are documented in
`docs/personalized-english/phase2/README.md`. Database replay/pgTAP and the
two-session concurrency harness require the Supabase/Postgres environment used
by the P-1 workflow; the Docker-free PGlite check is supplemental.
# Phase 0 local-model diagnostics

The unlinked route `/student/personal-english/local-runtime-diagnostics` is
available only when the server-only environment variable
`LOCAL_AI_DIAGNOSTICS_ENABLED=true`. It exercises real OCR, NER, and
KittenTTS Nano INT8 runtimes for architecture validation; it is not a
learner-facing feature.

Model binaries live under versioned `/local-ai-assets/` paths. Approved public
assets are inventoried in `app/_lib/local-ai/asset-catalog.ts`, immutable
responses use Cache Storage, and IndexedDB contains only small non-personal
inventory metadata. These browser caches are not Supabase Storage and never
contain OCR inputs/results, NER input/entities, generated audio, identifiers,
or learning records. The diagnostic page can clear each model or all local
model bytes and export content-free timing evidence.

Run `npm run test:unit` for the local-runtime policy, cache, lifecycle, and NER
correction regression suite. Device measurement procedure and results are in
`docs/personalized-english/PHASE0_LOCAL_RUNTIME_EVIDENCE.md`.
