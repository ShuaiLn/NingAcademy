# Personal Word Library Phase 1 Closure Evidence

Status date: 2026-09-12 (America/Tijuana)

This manifest records only evidence that exists. `UNVERIFIED` means the
required evidence or owner decision has not yet been produced or reviewed. The
database/application core being present or deployed does not make Phase 1 pass.

## Scope and invariants

Phase 1.5 is a closure patch for the existing Personal Word Library. It adds no
database migration and does not change the Phase 1 tables, RPC contracts, RLS,
grants, normalization, provenance, archive/restoration semantics, migration
inventory, Games retirement, convergence, or CI architecture. It does not add
paragraph import, OCR, filters, mastery, scheduling, Today's Goal, AI Tutor,
TTS, or any other Phase 2+ behavior.

## Existing implementation evidence

| Evidence | Recorded result |
| --- | --- |
| Phase 1 merge | `6fa3f1820852af27852e63c815bbba17c070ae44` via PR #1 |
| Baseline workflow | [run 34682685882](https://github.com/ShuaiLn/NingAcademy/actions/runs/34682685882), `success`, exact merge SHA |
| Replay job | **PASS** — 33/33 replay, Games-retirement catalog assertion, authorization pgTAP, Personal English pgTAP, generated types, history, convergence, and prefix checks |
| Application job | **PASS** — generated/committed type match, `npm ci`, typecheck, lint, applicable non-database-test step, and production build |
| Aggregate job | **PASS** — every required replay/application status was explicit zero |
| Baseline artifacts | `p1-migration-replay-34682685882`; `p1-application-verification-34682685882` |
| Production job in baseline run | Skipped because `run_production_audit` was false |
| Non-database-test meaning | The workflow used `npm run test:unit --if-present`; no `test:unit` script exists, so this is a successful no-op and not browser evidence |

## Phase 1.5 candidate evidence

| Evidence | Status |
| --- | --- |
| Final Git SHA | **UNVERIFIED** — assigned only after the candidate is committed |
| Final P-1 workflow run URL/ID | **UNVERIFIED** — required after push on the exact candidate SHA |
| Final replay/application/aggregate jobs | **UNVERIFIED** |
| Final artifacts | **UNVERIFIED** — expected names are `p1-migration-replay-<run_id>` and `p1-application-verification-<run_id>` |
| Docker-free local inventory check | **PASS** — 33 tracked migrations verified against `git_migrations.csv` |
| Docker-free retired-Games evidence check | **PASS** — five frozen files verified outside the active/pending inventory |
| Docker-free local typecheck | **PASS** |
| Docker-free local lint | **PASS** — zero errors; three unrelated pre-existing warnings |
| Docker-free local production build | **PASS** — Next.js 16.3.0 optimized build completed and `/student/personal-english` was emitted as a dynamic route |
| `git diff --check` | **PASS** |
| Full scope review | **PASS** — only the two approved UI files and four approved documentation files changed; no migration, database contract, Games logic, CI, or Phase 2+ implementation changed |

## Hosted non-Production acceptance

| Required evidence | Status |
| --- | --- |
| Non-Production Supabase project/branch reference | **UNVERIFIED** |
| Proof the environment is isolated and contains no copied Production data | **UNVERIFIED** |
| Exact history through `20260911213841` | **UNVERIFIED** |
| Vercel preview deployment ID and exact candidate SHA | **UNVERIFIED** |
| Proof preview variables target only the non-Production Supabase reference | **UNVERIFIED** |
| Synthetic teacher, Student A, and Student B identifiers | **UNVERIFIED** |
| Add, phrase, normalized deduplication, meaning patch, archive, and restore checklist | **UNVERIFIED** |
| Successful empty-library state and generic query-failure state | **UNVERIFIED** |
| Desktop/mobile navigation and absence of Phase 2+ controls | **UNVERIFIED** |
| Student A/B isolation and cross-student RPC denial | **UNVERIFIED** |
| Six sanitized direct REST mutation denials and owner-only SELECT result | **UNVERIFIED** |
| Confirmation that evidence contains no credentials, cookies, tokens, or Production data | **UNVERIFIED** |

No hosted environment is selected or authorized by this patch. The historical
NingAcademy-staging project was observed at only 27 migrations and is not
assumed suitable.

## Production and deployment reconciliation

| Required evidence or decision | Status |
| --- | --- |
| Read-only observation of Production history | Observed 2026-09-12: all 33 versions, including migrations 31–33, ending at `20260911213841_personal_words_core.sql` |
| Meaning of that observation | Audit evidence only; not the protected Production convergence audit |
| Exact mechanism that deployed migrations 31–33 | **UNVERIFIED** |
| Whether merge-to-main database automation was enabled | **UNVERIFIED** |
| Whether Vercel automatically promotes `main` | **UNVERIFIED** |
| P-1 aggregate branch-protection requirement | **UNVERIFIED** |
| Observed Vercel deployment | READY deployment associated with `6fa3f182…`; exact deployment ID **UNVERIFIED** |
| Protected `production-read-only-audit` run ID and artifact | **UNVERIFIED** |
| Dedicated read-only proof | **UNVERIFIED** |
| Exact Git/Production history, schema, and ACL convergence from the protected run | **UNVERIFIED** |
| Migrations 31–33 owner disposition | **UNVERIFIED** |
| Pre-deployment sequencing deviation | Recorded: Production deployment preceded the required predecessor-precondition and hosted-acceptance evidence |
| Owner acceptance/rejection of the sequencing exception | **UNVERIFIED** |
| Owner approval and READY deployment of the final Phase 1.5 application SHA | **UNVERIFIED** |
| Read-only post-deployment verification | **UNVERIFIED** |

The predecessor precondition cannot now prove the former migration-32 state and
must not be weakened to manufacture a retroactive pass. No rollback, migration
repair, Production mutation, or forward fix is authorized by Phase 1.5.

## Current state labels

| State | Label |
| --- | --- |
| Phase 1 database/application core | Implemented, merged, baseline-CI-verified, and observed deployed |
| Phase 1.5 application/documentation patch | Candidate implementation; final candidate CI **UNVERIFIED** |
| Phase 1 verification | Incomplete — hosted non-Production and protected Production evidence **UNVERIFIED** |
| Phase 1 owner closure | Incomplete — migrations 31–33 disposition, sequencing exception, and deployment approval **UNVERIFIED** |
| Phase 1 final decision | **OPEN — NOT PASS** |

Phase 2 must not start until the owner-authorized Phase 1.5 closure is complete.
