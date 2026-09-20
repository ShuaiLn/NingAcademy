# Phase 2 local implementation and evidence

The [final Phase 2 plan](../../p1/PERSONAL_WORD_OCR_PHASE2_IMPLEMENTATION_PLAN.md)
is the sole authoritative specification and remains byte-for-byte unchanged.
The full local OCR import implementation is present. Release evidence that
requires owner review, hosted systems, legal approval, canonical Docker replay,
or physical devices remains pending and is never represented as PASS.

## Implemented surfaces

- `/student/personal-english/import`: one-photo JPEG/PNG/WebP selection,
  preflight and EXIF-aware resize, browser-local OCR, mandatory corrected NER,
  deterministic privacy policy, accessible review, and confirmed-only save.
- `app/_lib/ocr-import/`: normalization with reversible word/span mapping,
  geometry, dictionary/morphology, Stage 1, NER correction, policy precedence,
  candidate extraction, teardown, and input validation.
- `app/actions/personal-word-ocr.ts`: kill-switch/authentication checks,
  application validation, one bulk RPC call, and library revalidation.
- `supabase/migrations/20260919025607_personal_word_ocr_imports.sql`: ledger,
  source provenance, constraints, indexes, RLS, grants, comments, private
  helpers, and atomic idempotent bulk confirmation.
- Root telemetry isolation: Speed Insights is disabled globally for this
  release because transition unmounting cannot prove complete route silence.
- Versioned policy, model, wordlist, calibration, fixture, and holdout
  artifacts plus generators and registration checks.

The runtime never uploads a photo or stores captured plaintext. Before the
learner confirms rows, only reviewed same-origin application/model assets are
allowed. The database receives only confirmed fields, a browser-generated
import UUID, ordered payload digest, count, timestamps, and source ordinals.
There is no OCR “Send once” bypass and no Phase 2 Storage path.

## Local commands

```powershell
npm run check:phase2-preparation
npm run check:phase2-governance
npm run test:phase2-preparation
npm run test:unit
npm run test:phase2-db-local
npm run test:phase2-browser
npm run audit:p1:git-migrations
npm run typecheck
npm run lint
npm run build
```

`npm run test:phase2-db-local` uses PGlite with the actual Phase 1 and Phase 2
migration source and is supplemental. Canonical replay, pgTAP, generated types,
and the real two-session concurrency test require the clean Supabase/Postgres
environment provisioned by the P-1 workflow.

The synthetic thin-slice remains available with `npm run study:phase2`. Its
automated timing file is technical evidence only. The product-value gate needs
human capture-to-save and manual-entry measurements for all ten 5–10-word
worksheets, or explicit owner acceptance of convenience as the benefit.

## Evidence boundaries

- `privacy-evaluation-status.json` remains `PENDING_EXECUTION`. Unit tests run
  all 300 generated cases against deterministic policy signals, but that is not
  the untouched release holdout with observed OCR/NER evidence and owner review.
- `runtime-profile.v1.json`, `privacy-policy.v1.json`, and the institution
  patterns are implemented candidates with null approval fields.
- `local-db-evidence.json` records the supplemental 138-assertion PGlite run
  and the 15 Unicode assertions reserved for canonical Supabase PostgreSQL.
- `local-browser-evidence.json` records the real local OCR/NER browser suite;
  Preview/network traces and physical-device acceptance remain separate.
- `dependency-audit-status.json` records the unresolved exact-baseline audit
  findings without changing the plan-pinned dependency.
- [IMPLEMENTATION_CLOSURE.md](./IMPLEMENTATION_CLOSURE.md) maps local results
  and outstanding release evidence to the acceptance criteria.

## Governed artifact changes

Use `node scripts/phase2/governance.mjs --write` only for an intentional
governed artifact update. Ordinary verification uses the command without
`--write`. Never populate approval, observed, deployment, Preview, or
Production fields from synthetic/local-only results.
