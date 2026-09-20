# Phase 2 pre-implementation audit

Audit date: 2026-09-18 (America/Tijuana).

Continuation: the owner's subsequent instruction authorized independent local
study/preparation work while external gates remain open. See
[the continuation record](./PERSONAL_WORD_OCR_PHASE2_CONTINUATION.md). The findings
and hashes below remain the original audit snapshot, not current completion claims.

**Status: prerequisite audit recorded; Phase 2 implementation is incomplete.**
The ordered checklist is blocked before the thin slice and full implementation.
No migration, runtime extension, import UI, Server Action, policy freeze, hosted
deployment, or Production operation was performed in this audit.

## Authority and reproducible evidence

The sole Phase 2 specification is
[the attached final plan, copied byte-for-byte](./PERSONAL_WORD_OCR_PHASE2_IMPLEMENTATION_PLAN.md).
Its SHA-256 is
`7bd35176435c104e2966c44f50b22f141d7fb2dfebe7fadb89a44300f8bf798e`.
No older Phase 2 plan or reconciliation document was used to define behavior.

[The machine-readable inventory](./PERSONAL_WORD_OCR_PHASE2_BASELINE_INVENTORY.json)
records both Git baselines, the original dirty status, exact SHA-256 hashes and
baseline Git blob IDs for 50 proposed Phase 0 files, and all 13 local asset
size/hash comparisons. `absent-from-main` means the whole file is an addition;
`modified` means its bytes differ from the current committed baseline. None of
these classifications means review approval. Generated builds, credentials,
environment values, and learner content are not included.

## Checklist 1: current GitHub baseline

`git ls-remote origin refs/heads/main` followed by `git fetch origin main`
identified:

| Field | Fresh observation |
| --- | --- |
| Repository | `ShuaiLn/NingAcademy` |
| Branch | `main` |
| HEAD | `9b156d81807bcf73c4ffb47cd9ef39a480feb4db` |
| Tree | `972c884637354159fdba7aa7e9047bd90f6dc904` |
| Commit | Merge PR #3, `chore/next-security-patch` |
| Previous specification baseline | `b7dbeb1986f37b3724d15f0ab45a95f71dd797aa` |
| Next.js dependency | `16.3.5`; ESLint configuration `^16.3.5` |
| Active migrations | 33; last `20260911213841_personal_words_core.sql` |
| Phase 0 runtime/assets/evidence | Absent from the committed tree |
| Phase 2 implementation | Absent from the committed tree |
| Root telemetry | Unconditional `<SpeedInsights />` remains |

The new main is reconciled by retaining its security patch and closure evidence
when preparing the separate Phase 0 dependency change. Copying the dirty local
`package.json` or lockfile over main would revert the security patch. This audit
does not rewrite the specification's dated baseline or perform that overwrite.

The Phase 1 migration and manual-add action were re-read. The specified
100/1,000/2,000 database character limits, three example sources, three existing
provenance types, two-reference shape check, and three public RPC contracts
match the committed schema. Manual add still performs upsert followed by attach.
`private.normalize_spelling` is
`lower(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')))`;
future TypeScript equivalence must be tested against replay Postgres, not assumed
from JavaScript's whitespace or Unicode casing rules. Phase 0 NFKC normalization
is a separate operation and cannot substitute for that equivalence proof.

Main's Phase 1 closure record now contains protected Production audit evidence
for **b7dbeb**, run `34716278632`. It explicitly leaves hosted acceptance,
sequencing-exception disposition, and owner closure open. That historical audit
does not establish Phase 1.5 closure or approve Phase 2. Its statement forbidding
all Phase 2 work until closure is superseded, for local work only, by the final
plan's `P2-OWN-001`; merge and deployment remain blocked.

## Checklists 2–3: dirty Phase 0 dependency

The workspace is on `feature/personal-word-library-phase-1-5` at
`069ba18d3e405f71b4dc48a841467851242382ab`, with eight modified tracked files and
the additional untracked paths recorded in the inventory. Installed Next.js is
`16.3.0`. Existing edits were preserved. No branch reset, staging, commit, or
bulk import of this dirty work was performed.

The proposed dependency files were compared individually with the exact main
tree. Runtime/cache/protocol/correction code, integration changes, tests,
diagnostics, and provenance reports were inspected. The reuse gate remains
**OPEN**; no file has been promoted to approved or committed dependency status.
The following findings must be addressed in a separately reviewed dependency
change and, where specified, its Phase 2 extensions:

| Area/files | Finding and required disposition |
| --- | --- |
| `models/ocr-runtime.ts`, `contracts.ts` | Only fixed-image diagnostic inference is exposed. Arbitrary image input, stable line/word IDs, original ranges, and Phase 2 geometry are absent. Extend the retained runtime under `P2-CLI-001`; do not create a second runtime. |
| `worker-protocol.ts`, `models/ner-runtime.ts`, `workers/ner.worker.ts` | Protocol only supports initialization/diagnostic/cancel/dispose. Fixed-text NER lacks arbitrary batches, per-line `didRun`, no-truncation token counting, 512-token rejection, and explicit eligible-line failure handling. These remain Phase 2 work. |
| `models/ner-corrections.ts` | Cloned raw objects exist, but raw/corrected contracts are mutable and have no stable correction IDs, rule versions, reason/operation registry, or fixture registry. Overlapping organization correction can replace an entity extending outside the organization span; reviewed rules must preserve privacy evidence and reject ambiguity. |
| `models/worker-model.ts` | An already-aborted signal is not checked before sending a request; attaching an abort listener afterward does not reject it. Non-failure/result matching messages resolve the request without checking the expected response type. Reuse requires cancellation and protocol regression coverage. |
| `model-lifecycle.ts`, `use-local-ai-runtime.ts` | Singleton hook state persists; hook cleanup does not dispose the model. `pagehide` queues `release()` behind existing work and uses a once-only listener. This is not proof of synchronous cancellation/state destruction for navigation, crashes, or repeated pagehide. |
| `workers/ner.worker.ts`, lifecycle, progress, diagnostics | Runtime exception messages are forwarded into UI/snapshots, and diagnostics export the snapshot. Once arbitrary input exists these paths cannot forward content-bearing errors. Phase 2 requires safe codes/copy and no captured content in diagnostics. |
| `model-cache.ts`, NER fetch adapter | Catalog hashes exist, but cache download verification counts bytes only and cache hits are trusted. The NER fetch adapter falls through to native fetch for an unrecognized origin/path. Neither behavior establishes the plan's complete integrity/network acceptance evidence. |
| `model-lifecycle.ts`, TTS files | Lifecycle acquisition imports OCR, NER, and TTS adapters together. TTS work is outside Phase 2, and the retained TTS distribution has unresolved eSpeak obligations. The dependency review must decide its packaging without adding Phase 2 TTS controls or silently replacing a model. |
| Asset catalog and public assets | All 13 local files match catalog bytes and SHA-256; 11 are OCR/NER. This is file-integrity evidence only. NeuroBERT conversion redistribution acceptance and applicable notices remain unresolved. |
| Dictionary | No FrequencyWords asset/catalog entry or approval was found in the proposed local dependency. The required exact source commit, 48,412-entry candidate, asset hash, morphology data, notice, and distribution approval remain unavailable; do not substitute an invented wordlist. |
| Package/lockfile and framework | Reconcile onto main's `16.3.5` while retaining only reviewed Phase 0 additions. Existing local checks exercise `16.3.0` and are not checks of a reconciled dependency commit. |
| CI and tests | Existing unit tests run in Node, not a real browser. Untracked application workflow and modified P-1 test invocation are proposals, not committed CI evidence. Browser, ACL snapshot, registration, and Phase 2 suites remain outstanding. |

The 2026-09-13 Phase 0 reports are historical local evidence. Their reported
browser timings, offline behavior, memory, and license conclusions were not
re-run or accepted by inference. A dedicated reviewed Phase 0 commit/PR and CI
are still required before Phase 2 merge.

## Checklists 4–5: decisions and gates

`P2-OWN-001` through `P2-OWN-007` and `P2-CON-001` through `P2-CON-012` are
preserved verbatim in the copied specification. In particular, mandatory NER,
whole-line Employee/Teacher/Account label rejection, the permanent browser-UUID
ledger, no photo retention, no OCR branch in the public attach RPC, and no
Ning-Privacy-Classifier are unchanged. There is no OCR consent bypass. The
public Phase 6 example wrapper and its executable delegation test remain future
work. No owner/legal acceptance is inferred from the implementation request.

| Gate | Current status / required evidence |
| --- | --- |
| Phase 1.5 formal closure | OPEN in current main; blocks merge/Preview/Production, not authorized local work |
| Phase 0 committed dependency | ABSENT; separate reviewed commit/PR and CI required before merge |
| Dirty Phase 0 reuse | OPEN; file comparison and findings above are review inputs, not approval |
| Fresh untouched baseline replay | BLOCKED by GitHub Actions write access; see below |
| Thin-slice product value | NOT RUN; ten representative fictional 5–10-word worksheets, capture-to-save vs manual timing, median OCR time ≤60% or explicit owner acceptance of convenience |
| 50-line calibration / policy approval | NOT RUN; exact 10/8/8/8/8/8 allocation retained; no v1 policy/runtime freeze |
| NeuroBERT provenance/license | OPEN; written owner/legal acceptance or authorized replacement and full revalidation |
| Wordlist provenance/redistribution | OPEN; exact candidate not present in audited files; no asset distribution approval |
| Runtime/device profile | NOT RUN for Phase 2; 2,200-pixel decode calibration, reference/low-end measurements, and mandatory-NER 9/10 configurations remain required |
| Telemetry isolation | OPEN; root Speed Insights still mounts; no direct-entry/client-transition acceptance trace |
| Next.js baseline | Main has `16.3.5`; local dependency remains `16.3.0`; reconciled build/hosted acceptance not established |
| Replay ACL snapshot | NOT CAPTURED for Phase 2; static source is not a catalog snapshot |
| Preview assets/headers/offline | NOT RUN; no Preview deployment authorized by gate closure |
| Production precondition/convergence | NOT RUN for Phase 2; protected audit and owner review required |

The owner was asked for paths/links to any existing dependency-review,
thin-slice, and calibration approvals. None had been supplied at audit time.

## Checklist 6: replay attempt

GitHub's public Actions API freshly reports
[run 35404722773](https://github.com/ShuaiLn/NingAcademy/actions/runs/35404722773)
at exact main `9b156d8` as successful. The connected GitHub tool confirms:

| Job | ID | Existing result |
| --- | --- | --- |
| Replay every migration from zero | `105791988718` | success |
| Application verification | `105792591916` | success |
| Aggregate gate | `105792799845` | success |
| Production read-only audit | `105792824760` | skipped |

The replay's existing steps include full replay, authorization and Personal
English pgTAP, type generation/drift, history, convergence, and prefix checks.
The baseline has no unit-test script; the existing optional non-database test
step is not Phase 0 or Phase 2 test evidence.

Attempting to rerun replay job `105791988718` through the connected GitHub
integration returned HTTP **403**, `Resource not accessible by integration`.
No fresh replay began. This is a GitHub permission failure, not a SQL failure
or an automatic approval-review rejection. `gh` is not installed. No local
Docker substitute or Production database was used.

To close this gate, an account/integration with Actions write access must rerun
the P-1 workflow at the audited main SHA, with `run_production_audit=false`.
Verify the selected SHA before dispatch; if main advances, repeat the baseline
comparison. Retain the fresh replay's explicit substatuses/artifacts and
aggregate result. The plan says the baseline replay “must be rerun”; the
existing successful run has therefore not been relabeled as closing this gate.

## Network audit observations for later checklists 11–13

`app/layout.tsx` globally mounts Speed Insights. Vocabulary practice clients
also use `sendBeacon` for their separate tab-event feature. No additional global
analytics integration was found by the source search; that is not proof of
runtime silence. The OCR route does not exist yet.

The required route-aware gate must decide only from the pathname and cover
`/student/personal-english/import` and descendants. Real direct-entry and
client-navigation tests must also cover a previously instrumented route.
Unmounting a component is not evidence that a previously installed script stops
emitting. If it does not, the final plan requires global Speed Insights removal
for the release. No telemetry change was made ahead of the ordered gates.

## Checks actually executed

| Check | Fresh local result | Scope |
| --- | --- | --- |
| `npm run test:unit` | 4 files, 41 tests passed | Existing dirty Phase 0 Node tests |
| `npm run typecheck` | exit 0 | Existing local application/dependency tree |
| `npm run lint` | exit 0, 0 errors, 3 existing warnings | Two vocabulary image warnings and cleanup `_req` warning |
| `npm run audit:p1:git-migrations` | 33 tracked migrations verified | Local migration bytes; same migration tree as main |
| `npm run audit:p1:game-listening` | 5 retired files verified | Historical frozen Games evidence |
| Local asset size/SHA-256 comparison | 13/13 match | No licensing or browser acceptance claim |
| `git diff --check` | exit 0 | Existing tracked edits |

Installed Next.js `use client` and `use server` guidance was read, together with
the Next.js/Supabase skills, P-1 runbook/workflow, current Supabase changelog,
and [Supabase testing guidance](https://supabase.com/docs/guides/local-development/testing/overview).
The relevant guidance must be re-read against the reconciled installed version
at checklist 10. No new application code or schema was authored in this audit.

## Ordered continuation and acceptance status

1. Finish checklist 3's separate Phase 0 dependency review using the inventory
   and findings, preserving main's patch and the user's original work.
2. Close checklist 6 with a fresh untouched replay at a verified main SHA.
3. Build and run checklist 7's thin slice; collect actual human timing and owner
   review before full UI/database implementation. Do not substitute scripted
   typing, model-only latency, invented measurements, or a threshold change.
4. Assemble the revised 50-line calibration, register correction fixtures, and
   obtain policy/runtime approval before freeze (checklists 8–9).
5. Continue checklists 10–36 in the copied plan, including telemetry evidence
   before migration/full UI work and every test/release gate. Checklist 37 is
   explicitly Phase 6 and must not be implemented now.

All 43 Phase 2 acceptance criteria remain **NOT VERIFIED**. No Phase 2 holdout,
accessibility, browser, SQL/concurrency, offline, device, or hosted result is
claimed. Release thresholds remain ≥148/150 sensitive blocked with Wilson 95%
lower bound ≥95%, clean false suppression ≤15%, teaching-word recall ≥75%, and
clean PERSON suppression ≤3%; positional errors count within the same aggregate
threshold. The holdout remains separate from calibration.

Master-plan synchronization remains outstanding: no authoritative master-plan
target was identified in the supplied final specification. Existing exploratory
notes were not treated as that target. Future synchronization must reflect only
implemented/verified state and must not claim telemetry is already gated.
