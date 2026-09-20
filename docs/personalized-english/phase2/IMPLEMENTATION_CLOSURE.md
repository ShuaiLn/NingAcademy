# Phase 2 local implementation closure

Date: 2026-09-19

Authoritative specification:
`docs/p1/PERSONAL_WORD_OCR_PHASE2_IMPLEMENTATION_PLAN.md`, SHA-256
`7bd35176435c104e2966c44f50b22f141d7fb2dfebe7fadb89a44300f8bf798e`.

Status: **local implementation complete; merge/release closure pending**.
This record reports only observed local results. It does not assert owner,
legal, hosted Preview, protected Production, deployment, convergence, or
physical-device approval.

## Completed implementation

- Browser-local one-photo OCR and mandatory NER pipeline with safe teardown,
  verified same-origin assets, offline cache behavior, image guards, EXIF-aware
  geometry, reversible normalization/span mapping, immutable raw NER evidence,
  governed corrections, and deterministic fail-closed policy.
- FrequencyWords binary dictionary and governed morphology; independent OCR
  confidence and dictionary states; deterministic candidate extraction.
- Complete learner import/review route, keyboard/mobile/accessibility behavior,
  confirmed-only retry semantics, client PII validation, safe error copy,
  kill switch, and route-aware telemetry isolation with Speed Insights disabled
  globally for this release.
- Authenticated Server Action that validates, calls only the bulk RPC, and
  revalidates the personal-word library.
- Phase 2 migration with exact ledger, provenance columns, constraints,
  indexes, RLS, grants, comments, private helpers, advisory locking, quotas,
  idempotence, ordered replay, full rollback, and the public bulk RPC.
- pgTAP, migration-order/security suites, two-session concurrency harness,
  PGlite supplemental runner, unit/component/browser/accessibility/privacy/
  lifecycle/network suites, fixture generators, registration checks, CI jobs,
  rollback source, precondition source, evidence manifests, and Master Plan
  synchronization.

No upload/Storage/retention object, existing applied migration, Phase 1 public
RPC signature/manual-add behavior, Phase 6 public example wrapper, Phase 3B
feature, vocabulary engine, or retired Games contract was changed for Phase 2.

## Acceptance criteria disposition

| Criterion | Local disposition | Remaining evidence, if any |
| --- | --- | --- |
| P2-AC-001–004 | Implemented; SQL source/order checks and 129-assertion supplemental DB run pass | Canonical clean replay/pgTAP |
| P2-AC-005 | Implementation and real two-session harness authored | Real Postgres concurrency run |
| P2-AC-006 | Implemented; ownership denial covered by SQL and supplemental DB run | Canonical pgTAP |
| P2-AC-007 | Atomic lock/quota implementation and race harness authored | Real Postgres concurrency run |
| P2-AC-008–011 | Implemented; quota, rollback, and three-field server PII cases pass supplemental DB run | Canonical pgTAP |
| P2-AC-012–014 | Design/catalog preservation implemented and SQL assertions authored | Canonical pgTAP/catalog replay |
| P2-AC-015–020 | Unit/component/browser suites pass locally | Hosted browser repetition where required |
| P2-AC-021 | Local real-browser pre-confirmation allowlist passes | Isolated Preview trace |
| P2-AC-022 | Unit and browser teardown/cancel/pagehide checks pass | Physical browser memory evidence |
| P2-AC-023 | Warm-cache OCR/NER offline browser check passes locally | Isolated Preview repetition |
| P2-AC-024 | Runtime and test support implemented | Approved 9/10 device matrix |
| P2-AC-025 | Pinned provenance documented | Owner/legal approval of NeuroBERT conversion distribution |
| P2-AC-026 | Ning-Privacy-Classifier is absent and explicitly deferred | None for local implementation |
| P2-AC-027 | axe, focus, target-size, keyboard, and narrow-mobile checks pass locally | Required physical/manual accessibility evidence |
| P2-AC-028 | No implementation dependency remains | Owner Phase 1.5 closure before merge |
| P2-AC-029 | Named fail-closed workflows and aggregation authored | Hosted CI run with every status zero |
| P2-AC-030 | Precondition/convergence source authored; no Production operation performed | Authorized deployment and read-only convergence |
| P2-AC-031–037 | Frozen manifests and unit/fixture/equivalence/precedence suites pass locally | Owner policy/runtime approval where specified |
| P2-AC-038 | Private helper and bulk delegation implemented/tested | Phase 6 later creates/tests its public wrapper |
| P2-AC-039–040 | Fixture registration and all-field client validation suites pass | None for local implementation |
| P2-AC-041 | Exact FK order checker and supplemental DB assertions pass | Canonical zero-to-latest replay |
| P2-AC-042 | OCR has no bypass; Phase 1 manual add remains unchanged; UI/regression checks pass | None for local implementation |
| P2-AC-043 | Direct-entry and client-navigation telemetry silence pass locally; Speed Insights globally disabled | Isolated Preview network trace |

## Tests executed locally

- Governance/preparation generators and registration/legacy-ACL/migration
  checks.
- Vitest unit/component suite: 167 tests in 13 files.
- PGlite database suite: 138 assertions using actual Phase 1/Phase 2 migration
  source and actual helpers.
- Protected precondition source executed successfully in the supplemental
  database both before and after applying the Phase 2 migration.
- Playwright production-build suite: 4 tests covering real OCR/NER,
  confirmed-only transport, direct/navigation silence, warm offline reuse,
  JPEG EXIF, WebP, invalid input, failure/retry, cancellation, axe, focus, and
  mobile layout.
- TypeScript typecheck, ESLint, optimized Next.js build, migration inventory,
  JavaScript syntax checks, workflow YAML parse, and whitespace validation.

These are the final observed local outcomes. The Playwright run completed in
67.6 seconds with four expected passes and no skipped, unexpected, or flaky
tests. ESLint reported zero errors and three pre-existing warnings outside the
Phase 2 implementation. PGlite remains supplemental and excludes the 15
Unicode normalization assertions whose engine behavior differs from canonical
Supabase PostgreSQL; neither its 138 assertions nor its two precondition
executions are labeled as canonical replay, Production-catalog evidence, or
concurrency evidence.

## Technically remaining local implementation

None identified. The generated `supabase/database.types.ts` shape is reconciled
locally, but canonical regeneration is coupled to the unavailable clean
Supabase replay and remains an evidence item rather than unfinished source code.

## External and release-only gates

- Fresh P-1 zero-to-latest replay, named pgTAP suites, two-session Postgres
  concurrency, canonical database type generation/drift, ACL snapshot, and
  hosted fail-closed aggregation.
- Phase 1.5 closure and dedicated review/CI of the reused local Phase 0 work.
- Human ten-worksheet product-value study or explicit convenience acceptance;
  50-line calibration execution and approval; untouched 300-line release
  holdout execution and owner review.
- Reference/low-end physical-device timing, memory, 9/10 mandatory-NER,
  screen-reader, lifecycle, and offline evidence.
- FrequencyWords attribution/provenance approval and NeuroBERT conversion
  provenance/redistribution approval.
- Resolution or explicit acceptance of dependency audit findings while keeping
  the exact plan-pinned model baseline.
- Isolated Preview browser/RLS/runtime/offline/network acceptance.
- Protected Production precondition and approval, authorized deployment, and
  read-only convergence. Production remains unchanged.
