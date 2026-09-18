# Personal Word Library Phase 1 Closure Evidence

Status date: 2026-09-18 (America/Tijuana)

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
| Final Phase 1.5 application SHA | `83f679ad73d308a1fc3cfd7bfece9cf3a004c686` |
| Final application-candidate P-1 workflow | [run 34686453567](https://github.com/ShuaiLn/NingAcademy/actions/runs/34686453567), `success`, pull request #2, exact candidate SHA |
| Final replay/application/aggregate jobs | **PASS** — job IDs `103534156695`, `103534476821`, and `103534580696` |
| Production job in candidate run | Skipped as required because no protected Production audit was authorized |
| Final artifacts | `p1-migration-replay-34686453567` (404,116 bytes); `p1-application-verification-34686453567` (13,814 bytes); both recorded unexpired with 2026-09-26 expiry |
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
assumed suitable. A replacement must be a fresh isolated Supabase project in
the same organization and `ca-central-1` region as Production, created only
after the owner reviews and approves the quoted cost. It must start from all 33
Git migrations, contain no Production learner data, use isolated Preview-only
credentials, and contain only owner-controlled synthetic teacher, Student A,
and Student B data. Do not reconcile the stale staging project.

## Protected Production audit of existing state

| Evidence | Recorded result |
| --- | --- |
| Audited application | Exact `main` SHA `b7dbeb1986f37b3724d15f0ab45a95f71dd797aa` |
| Protected workflow | [run 34716278632](https://github.com/ShuaiLn/NingAcademy/actions/runs/34716278632), `workflow_dispatch`, **success** |
| Jobs | Replay `103613996290`, application `103614391927`, aggregate `103614517985`, Production read-only `103614531109`; all **PASS** |
| Production role | `p1_readonly_audit_v2`; only `pg_read_all_data`, no elevated attributes, database/schema `CREATE`, table mutation, sequence write, or executable application `SECURITY DEFINER` function |
| Histories | Git-to-Production 33/33 **MATCH**; Git-to-replay 33/33 **MATCH** |
| Raw comparisons | Full schema, project schema, and ACL-aware project schema were nonzero and retained |
| Gated comparisons | Existing hash-pinned approved-drift filtering left zero unresolved project-schema, schema-with-ACL, and ACL drift |
| Replay artifact | `p1-migration-replay-34716278632`; digest `sha256:64544c1206776094372f21439ec8c00e0cb78971653fcfaf124324d5a5bec792` |
| Application artifact | `p1-application-verification-34716278632`; digest `sha256:8c152f0127ff59d8124e80cf37d1b702b9c1deca31abff7620e72090179cae14` |
| Production artifact | `p1-production-read-only-audit-34716278632`; digest `sha256:9db5a0aa1d4c1f7d24fe251ef348369b3da03ffe3411cca90fef64292bc2d4a5` |
| Preconditions | Migration 30 and Personal Word Library predecessor checks skipped because nothing was pending; former states are non-reconstructable and no retroactive PASS is claimed |
| Scope of proof | Existing `b7dbeb` state only; not the intended deployment sequence and not the later Next.js patch |

The workflow and its called scripts remain unchanged because review found no
repository defect. The deployment sequencing exception and owner decision stay
open. Branch-protection and required-reviewer configuration also remains
**UNVERIFIED** because the available integration could not inspect legacy
protection settings.

## Security and hosted-environment findings

- Next.js `16.3.0` is the definite application security issue. Next.js names
  `16.3.3` as the first fixed 16.3 release for two critical unauthenticated RCE
  issues; the isolated patch advances only Next.js and its ESLint configuration
  to the superseding `16.3.5` patch. See the
  [security advisory](https://nextjs.org/blog/august-2026-security-release) and
  [16.3.5 release](https://github.com/vercel/next.js/releases/tag/v16.3.5).
- The Personal English `SECURITY DEFINER` RPC warnings are expected by design:
  the functions use authenticated/readiness and ownership/state guards, empty
  `search_path`, qualified identifiers, and restricted grants.
- Four RLS-without-policy notices are expected for current RPC/internal tables
  based on their grants and usage. No schema or RLS change is warranted.
- Supabase leaked-password protection is disabled. Owner review and hardening
  are recommended, but this patch makes no Auth configuration change.
- Vercel Speed Insights is mounted globally. This is not evidence of OCR
  leakage because Phase 2 is absent; any later OCR pre-confirmation design must
  account explicitly for its network allowlist.
- The current Production Vercel deployment
  `dpl_GtZS87ptziTZpxGf8Cojz7VjjB9x` is READY at exact `b7dbeb` with no grouped
  runtime errors observed over seven days. It is existing-state evidence, not
  acceptance of the patch branch.

## Production and deployment reconciliation

| Required evidence or decision | Status |
| --- | --- |
| Read-only observation of Production history | Protected run `34716278632`: all 33 versions, ending at `20260911213841_personal_words_core.sql` |
| Meaning of that observation | Protected convergence evidence for exact `b7dbeb`; not retroactive sequencing evidence |
| Exact mechanism that deployed migrations 31–33 | **UNVERIFIED** |
| Whether merge-to-main database automation was enabled | **UNVERIFIED** |
| Whether Vercel automatically promotes `main` | **UNVERIFIED** |
| P-1 aggregate branch-protection requirement | **UNVERIFIED** |
| Observed Vercel deployment | `dpl_GtZS87ptziTZpxGf8Cojz7VjjB9x`, READY at exact `b7dbeb` |
| Protected `production-read-only-audit` run ID and artifact | **VERIFIED for `b7dbeb`** by run `34716278632` and the digest-pinned artifacts above |
| Dedicated read-only proof | **VERIFIED for run `34716278632`** |
| Exact Git/Production history, schema, and ACL convergence from the protected run | **VERIFIED for `b7dbeb`**: 33/33 histories and zero unresolved filtered project/ACL drift |
| Migrations 31–33 owner disposition | Existing deployed state verified; historical sequencing exception still requires owner decision |
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
| Phase 1.5 application patch | Existing closure UI complete; isolated Next.js `16.3.5` security patch pending CI/Preview evidence |
| Phase 1 verification | Protected audit of `b7dbeb` verified; fresh hosted acceptance and post-patch protected audit **UNVERIFIED** |
| Phase 1 owner closure | Incomplete — sequencing exception, environment-protection confirmation, hosted acceptance, and final deployment approval require owner action |
| Phase 1 final decision | **OPEN — NOT PASS** |

Phase 2 must not start until the owner-authorized Phase 1.5 closure is complete.
The current readiness verdict is **NOT READY FOR PHASE 2**.
