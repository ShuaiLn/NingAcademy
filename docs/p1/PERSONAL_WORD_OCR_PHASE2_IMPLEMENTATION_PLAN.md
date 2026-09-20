## 1. Final Reconciled Phase 2 Implementation Plan

# Phase 2 — Client-side OCR Import Implementation Plan

## Summary

This document is the sole implementation specification for Phase 2 OCR import. Phase 2 delivers one-photo, browser-local OCR; deterministic and NeuroBERT-assisted privacy classification; accessible candidate review; and one-transaction bulk persistence into the Phase 1 personal-word library.

Photographs, raw OCR text, normalized mappings, NER entities, and rejected content remain transient. They are never uploaded, persisted, logged, or sent to remote inference or telemetry services. Only student-confirmed `term`, optional `meaning`, and permitted `exampleSentence` fields reach Supabase.

This plan preserves every original Phase 2 requirement not explicitly amended by the reconciliation documents. The newer “Revised Specification” controls where the reconciliation documents differ, including the revised 50-line calibration composition. It does not change the original evaluation thresholds or the original 5–10-word thin-slice range.

Applied skills: `vercel:nextjs` informed the Next.js 16 component/action and global-layout telemetry boundaries; `supabase:supabase` informed explicit grants, RLS, function hardening, and pgTAP requirements.

## Owner decisions

| ID | Decision | Consequence |
|---|---|---|
| `P2-OWN-001` | Local Phase 2 implementation may begin before Phase 1.5 closure. | Phase 1.5 still blocks merge, hosted Preview, and Production. |
| `P2-OWN-002` | NeuroBERT is mandatory for every model-eligible completed import. | Static capability failure prevents OCR. Later Worker, runtime, or model failure aborts the import and discards all OCR-derived candidate state. Deterministically rejected oversized lines are not model-eligible failures. |
| `P2-OWN-003` | Import metadata is a permanent ledger with `students(id) ON DELETE CASCADE`. | No expiry, tombstone, purge, or import-delete UI. The ledger stores a digest but no captured plaintext. |
| `P2-OWN-004` | The browser supplies the import UUID; bulk confirmation reserves and finalizes it atomically. | No `create_personal_word_ocr_import_v1` RPC exists. |
| `P2-OWN-005` | Photograph retention is excluded. | No Storage upload, OCR upload purpose, file table, retention fields, cleanup changes, or photo-read path. |
| `P2-OWN-006` | Ning-Privacy-Classifier is deferred to optional Phase 2+ work. | Phase 2 uses Stage 1, script/dictionary rules, contextual gazetteer, NeuroBERT with corrected entities, positional signals, and deterministic policy. |
| `P2-OWN-007` | Every recognized high-risk label-value line is whole-line `never_offer`. | `Name:`, `Student ID:`, `Employee:`, `Teacher:`, `Account #:`, `DOB:`, `Address:`, `Phone:`, and `Email:` cannot use delimiter-side recovery. |

## Audited baseline

### Authoritative GitHub baseline

The authoritative committed baseline is GitHub `main`, not the previously inspected dirty feature worktree.

Current verified GitHub state:

- Branch: `main`.
- HEAD: `b7dbeb1986f37b3724d15f0ab45a95f71dd797aa`.
- Commit: `Merge pull request #2 from ShuaiLn/feature/personal-word-library-phase-1-5 — Close Personal Word Library Phase 1 gaps`.
- Phase 1/1.5 personal-word code is committed, including:
  - `20260911213841_personal_words_core.sql`;
  - `app/actions/personal-words.ts`;
  - the `/student/personal-english` page and Phase 1 components.
- Phase 0 OCR/NER runtime, local-AI assets, diagnostic route, and Phase 0 evidence documents are absent from committed GitHub `main`.
- Phase 2 OCR implementation and `docs/p1/PERSONAL_WORD_OCR_PHASE2_IMPLEMENTATION_PLAN.md` are absent from committed GitHub `main`.
- Root `app/layout.tsx` unconditionally renders `@vercel/speed-insights/next`’s `<SpeedInsights />`.
- `@vercel/speed-insights` is a committed production dependency.
- Therefore, existing global telemetry is a known conflict with Phase 2’s pre-confirmation network-isolation contract and must be gated before OCR browser acceptance can pass.

The implementer must re-query GitHub `main` and record its exact HEAD before starting. If `main` has advanced, re-audit the committed tree rather than assuming this SHA remains current.

### Local dirty working-tree evidence

A previously inspected local worktree contained:

- branch `feature/personal-word-library-phase-1-5`;
- commit `069ba18d3e405f71b4dc48a841467851242382ab`;
- modified/untracked Phase 0 OCR, NER, cache, lifecycle, diagnostic, asset, test, and evidence files.

Those local files are exploratory evidence only:

- they are not part of the authoritative GitHub baseline;
- they do not prove Phase 0 is committed, reviewed, merged, or available to another implementation session;
- they must be freshly audited before reuse;
- each reused file must be reconciled against current GitHub `main`;
- Phase 2 may not treat their tests or evidence as committed implementation evidence;
- their eventual commit must be separately reviewed and gated before Phase 2 merge.

### Current schema/application facts to re-verify

- The authoritative baseline contains 33 active migrations ending in `20260911213841_personal_words_core.sql`.
- `personal_words` enforces term ≤100 characters, meaning ≤1,000, and example sentence ≤2,000.
- `example_sentence_source` accepts `own_context`, `curated_corpus`, and `ningtutor_core`.
- `personal_word_sources` accepts only `teacher_vocabulary_word`, `teacher_pronunciation_word`, and `self_added`.
- Its reference-shape constraint covers only `vocabulary_word_id` and `pronunciation_task_word_id`.
- Public Phase 1 RPCs are `upsert_personal_word_v1`, `attach_personal_word_source_v1`, and `archive_personal_word_v1`.
- Phase 1 manual add uses the existing two-RPC flow. Phase 2 must not extend OCR-specific PII rejection to that surface.
- `private.normalize_spelling` lowercases, trims, and collapses whitespace.
- Current committed Next.js is `16.3.0`; existing security evidence requires an owner-reviewed patched 16.x, not below `16.3.5`, before hosted deployment.

No historical PASS, local result, or uncommitted Phase 0 artifact may be promoted to committed-baseline status by inference.

## Reconciliation and conflict record

Preserve `P2-CON-001` through `P2-CON-011`:

- `P2-CON-001`: local work is allowed before Phase 1.5 closure, but merge and deployment are not.
- `P2-CON-002`: mandatory NeuroBERT replaces the old low-capability `word_only` fallback.
- `P2-CON-003`: the permanent ledger and account-deletion cascade replace expiry/tombstone semantics.
- `P2-CON-004`: atomic browser-UUID reservation replaces a separate create-import RPC.
- `P2-CON-005`: all optional photo-retention and Storage work is excluded.
- `P2-CON-006`: Ning-Privacy-Classifier is deferred, not removed or replaced.
- `P2-CON-007`: the public Phase 1 attach RPC does not gain an OCR branch.
- `P2-CON-008`: the existing source-type CHECK must gain `ocr_import`.
- `P2-CON-009`: extend the reviewed retained runtime rather than creating a second OCR runtime.
- `P2-CON-010`: the retired Games SQL test receives a documented registration exemption.
- `P2-CON-011`: confidence, memory, language, and latency values remain provisional until calibrated.

Add:

- `P2-CON-012`: `P2-OWN-007` reverses the former example in which `Employee: John Smith / Costco Wholesale` allowed `Costco` extraction. The current result is Priority 2, whole-line `never_offer`, with no surviving candidate.

## Scope and non-goals

- `P2-SCP-001`: ship one-photo browser-local OCR, privacy classification, review, and atomic bulk persistence.
- `P2-SCP-002`: use Phase 1 `personal_words` and `personal_word_sources` as the only persistence target.
- `P2-SCP-003`: preserve the `生词库` name, Phase 1 public RPC signatures, vocabulary v1/v2 behavior, retired Games contracts, and absence of teacher access.
- `P2-SCP-004`: exclude pasted-text/document import, `explain_imported_text`, AI Tutor, TTS controls, practice scheduling, Phase 3B naming/filters, teacher visibility, Goal Packs, PDF import, analytics, and PWA synchronization.
- `P2-SCP-005`: exclude all photograph retention and Storage work.
- `P2-SCP-006`: exclude Ning-Privacy-Classifier code, assets, training, and learner-data collection.
- `P2-SCP-007`: strict deterministic rejection in `term`, `meaning`, and `exampleSentence` is specific to OCR bulk import. It does not change Phase 1 manual add or general authored-text “Send once” rules. OCR import offers no “Send once” exception.
- `P2-SCP-008`: global product telemetry must not observe or emit requests because of an OCR image, OCR-derived content, review interaction, or OCR route session. Existing Speed Insights must be gated off the OCR route before Phase 2 browser acceptance.

## Gate register

| Gate | Initial status | Closed by | Blocks |
|---|---|---|---|
| Phase 1.5 formal closure | Re-audit against current GitHub records | Owner-approved closure evidence | Merge, Preview, Production |
| Phase 0 dependency in GitHub | Absent from current `main` | Reviewed Phase 0 commit/PR and CI | Phase 2 merge |
| Local Phase 0 worktree reuse | Unverified | Fresh diff, provenance, review, and tests | Reuse of local files |
| Untouched baseline replay | Must be rerun against current `main` | Authorized P-1 replay | Migration authoring and merge |
| Thin-slice product-value check | Not run | Owner-reviewed timing study | Full UI/database implementation |
| 50-line calibration and policy approval | Not run | Calibration report and owner approval | Policy freeze |
| NeuroBERT provenance/license | Open | Written owner/legal acceptance or replacement plus revalidation | Production |
| Wordlist provenance/redistribution | Open | Exact source, attribution, and approval | Asset distribution |
| Runtime/device profile | Incomplete | Reference and low-end browser benchmarks | Runtime-profile freeze |
| Mandatory-NER device availability | Unknown | Approved device matrix | Production |
| OCR telemetry isolation | Open; root layout mounts Speed Insights globally | Route-level gating plus direct-load/client-navigation browser evidence; if gating cannot prove silence, disable Speed Insights globally for this release | Phase 2 browser acceptance, Preview, Production |
| Next.js security baseline | `16.3.0` | Reviewed patched 16.x upgrade, ≥`16.3.5` | Preview/Production |
| Replay ACL snapshot | Static evidence only | Disposable replay catalog | Merge |
| Vercel asset/header/offline behavior | Unverified | Hosted Preview evidence | Production |
| Production precondition | Not run | Protected read-only audit and owner review | Production deployment |

Owner/external capabilities include protected environments, hosted services, legal acceptance, physical-device tests, and Production authorization. Their status must not be inferred.

## Versioned constants and governance

### `P2-LIM-001`: governed configuration family

Create a generator-checked family:

- `limits.v1.json`;
- `runtime-profile.provisional.json`;
- approved `runtime-profile.v1.json`;
- canonical `privacy-policy.v1.json`;
- versioned Stage 1 patterns and sensitive-label inventory;
- versioned gazetteer data;
- versioned institution-title patterns;
- versioned NER correction rules;
- versioned correction-fixture registry.

`privacy-policy.v1.json` records or references the version and SHA-256 hash of each governed policy artifact plus approved positional thresholds and the policy-precedence version.

The generator verifies:

- generated TypeScript, SQL, and test literals;
- referenced-file hashes;
- correction-rule-to-fixture coverage;
- institution-pattern metadata/fixtures;
- manifest consistency;
- deployed v1 immutability.

After approval or deployment, v1 files cannot be silently rewritten. Changes require a later version and refreshed evidence.

### Immutable `limits.v1.json`

| Constant | v1 value |
|---|---:|
| Maximum bulk items | 100 |
| Term length | 100 |
| Meaning length | 1,000 |
| Example length | 2,000 |
| Photos per import | 1 |
| Maximum encoded file size | 10 MiB |
| Maximum encoded width/height | 8,192 px each |
| Maximum encoded pixel area | 20,000,000 |
| Processing long edge | 2,200 px |
| Accepted types | JPEG, PNG, WebP by magic bytes |
| Normalized line limit | 2,000 UTF-16 code units |
| NeuroBERT encoded limit | 512 input IDs including special tokens |
| NER batch | 100 lines and 50,000 normalized characters |
| PERSON expansion | Four adjacent OCR words per side |
| Hourly imports per student | 20 |
| Lifetime imports per student | 2,000 |
| Lifetime OCR source items per student | 20,000 |

The character and model-token limits are independent.

### Provisional runtime profile

- `P2-RUN-001`: confidence bands are ≥90, 70–<90, and <70. Non-finite values or values outside `[0,100]` are invalid.
- `P2-RUN-002`: provisional elapsed-time targets are 6 seconds on the reference device and 15 seconds on an approved low-end device.
- `P2-RUN-003`: provisional incremental peak-memory ceiling is 288 MiB.
- `P2-RUN-004`: English OCR is required. `chi_sim` is conditional on measured benefit.
- `P2-RUN-005`: benchmark preflight, initialization, OCR variants, OCR inference, NER initialization, 100-line NER, policy, and teardown separately.
- `P2-RUN-006`: freeze confidence bands only after images traverse the actual 2,200 px decode path.
- `P2-RUN-007`: mandatory NER baseline is `onnx-community/NeuroBERT-NER-ONNX`, revision `e3a6a290e438a506d2ba7bbb0f5875b7f034cebf`, q8, `@huggingface/transformers@4.2.0`, with `max_position_embeddings = 512`.
- `P2-RUN-008`: replacing any baseline component reopens provenance, license, calibration, regressions, browser/runtime, performance, cache/offline, device, and deployment evidence.

### Dictionary and morphology

- `P2-WRD-001`: retain the reviewed FrequencyWords candidate with full commit hash, asset SHA-256, and CC-BY-SA-4.0 notice. The candidate contains 48,412 normalized entries and is approximately 390,710 bytes.
- `P2-WRD-002`: distribution is blocked pending provenance and attribution approval.
- `P2-WRD-003`: store sorted UTF-8 bytes plus compact offsets and use binary search.
- `P2-WRD-004`: results are `known`, `known_inflected`, or `unknown`; versioned morphology handles common inflections and irregulars.
- `P2-WRD-005`: update exact asset bytes/hashes through the existing catalog mechanism.
- `P2-WRD-006`: a line with at least five eligible Latin tokens and a known/inflected ratio below 35% becomes `never_offer/non_english_latin_low_match`.

Individual `unknown` results remain nonblocking warnings and default unselected.

## Database implementation

Create one migration using `supabase migration new <descriptive-name>`, then verify its timestamp is strictly later than the current GitHub baseline. Never edit an applied migration.

Use `lock_timeout = '5s'` and `statement_timeout = '60s'`.

### Migration ordering

`P2-DB-024` requires this order:

1. Create `public.personal_word_ocr_imports`, indexes, RLS, policy, grants, and comments.
2. Add `personal_word_sources.ocr_import_id` with its FK.
3. Add `ocr_item_index`.
4. Replace/widen source constraints.
5. Create partial indexes.
6. Create private helpers.
7. Create the public bulk RPC and grants.

A named pgTAP case proves after zero-to-latest replay that the table, column, exact FK, and referenced table/column exist. Replay success is the temporal ordering evidence.

### Import ledger

`P2-DB-001` creates:

```sql
public.personal_word_ocr_imports (
  id uuid primary key,
  student_id uuid not null
    references public.students(id) on delete cascade,
  payload_hash bytea not null,
  confirmed_count smallint not null,
  confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint personal_word_ocr_imports_payload_hash_length_check
    check (octet_length(payload_hash) = 32),
  constraint personal_word_ocr_imports_confirmed_count_check
    check (confirmed_count between 1 and 100)
)
```

Add `(student_id, created_at desc)`.

`P2-DB-002`: document that the ledger contains no captured plaintext but does contain a content-derived SHA-256 digest.

Enable RLS immediately. The single SELECT policy requires ready profile and matching current student. Revoke all table privileges from `public`, `anon`, and `authenticated`; grant authenticated SELECT and service-role CRUD only.

### Source columns and constraints

`P2-DB-003` adds:

```sql
ocr_import_id uuid
  references public.personal_word_ocr_imports(id) on delete cascade,
ocr_item_index smallint
```

`P2-DB-004` replaces the reference-shape check with:

```sql
num_nonnulls(
  vocabulary_word_id,
  pronunciation_task_word_id,
  ocr_import_id
) <= 1
```

`P2-DB-005` adds:

```sql
(
  source_type = 'ocr_import'
  and ocr_import_id is not null
  and ocr_item_index between 0 and 99
)
or
(
  source_type <> 'ocr_import'
  and ocr_import_id is null
  and ocr_item_index is null
)
```

`P2-DB-006` widens the source-type CHECK to include `ocr_import`.

Use add-`NOT VALID`, validate, drop-old, rename for populated-table CHECK replacements.

`P2-DB-007` adds exactly:

```sql
create unique index personal_word_sources_ocr_word_uidx
on public.personal_word_sources(personal_word_id, ocr_import_id)
where source_type = 'ocr_import'
  and ocr_import_id is not null;

create unique index personal_word_sources_ocr_item_uidx
on public.personal_word_sources(ocr_import_id, ocr_item_index)
where source_type = 'ocr_import'
  and ocr_import_id is not null
  and ocr_item_index is not null;
```

### Preserved RPCs and private OCR helper

`P2-DB-008` leaves these unchanged:

- `upsert_personal_word_v1(text,text)`
- `attach_personal_word_source_v1(uuid,text,uuid)`
- `archive_personal_word_v1(uuid)`

The public attach RPC continues rejecting `ocr_import`.

`P2-DB-009` creates an ungranted private OCR-source helper that verifies import/word ownership, requires the locked import, inserts/replays against both unique indexes, returns the source ID, and cannot alter legacy sources.

### Shared example helper

`P2-DB-015` creates:

```sql
private.set_personal_word_example(
  p_student_id uuid,
  p_personal_word_id uuid,
  p_sentence text,
  p_source text
) returns void
```

It uses `search_path = ''`, qualified identifiers, ownership verification, legal-source verification, no authenticated execute grant, and one atomic update of sentence plus source.

Phase 2 calls it with `own_context` for nonblank examples. Blank/null preserves the current pair.

Phase 6 later creates public `set_personal_word_example_v1(...)` as an owner-checked wrapper around this helper. Phase 2 neither creates nor calls that wrapper.

Phase 2 tests prove the helper invariant and bulk-RPC delegation. Actual public-wrapper delegation is tested only when Phase 6 implements the wrapper.

### Deterministic server PII helper

Create or finalize:

```sql
private.captured_text_has_high_confidence_pii_v1(p_text text)
returns boolean
```

It uses generated v1 Stage 1 data, receives no authenticated execute grant, and never logs input.

`P2-DB-016` applies it to every nonblank OCR-submitted `term`, `meaning`, and `exampleSentence`. A hit rejects and rolls back the complete batch.

This stricter rule belongs only to `upsert_personal_words_bulk_v1`. Do not add it to Phase 1 manual-add actions/RPCs.

### Atomic bulk RPC

`P2-DB-010` creates:

```sql
public.upsert_personal_words_bulk_v1(
  p_ocr_import_id uuid,
  p_words jsonb
)
returns table (
  personal_word_id uuid,
  source_id uuid,
  term text,
  ocr_item_index smallint
)
```

`P2-DB-011` validates ready profile, active student, UUID, 1–100 objects, exact allowed keys, types, blanks, lengths, order, and normalized duplicates before writes.

`P2-DB-012` canonicalizes trimmed term, blank-to-null meaning/example, and original order, then computes SHA-256 over deterministic canonical JSONB.

`P2-DB-013`:

1. Acquires a student transaction advisory lock.
2. Inserts the browser UUID with conflict-ignore.
3. Selects that UUID `FOR UPDATE`.
4. Denies another owner generically.
5. Replays the ordered mapping for matching owner/hash.
6. Treats same UUID/different hash as an invariant failure.
7. Enforces hourly, lifetime-import, and lifetime-source-item quotas under the lock.
8. Only then mutates words, examples, and sources.

A failed transaction leaves no reservation.

`P2-DB-014` preserves Phase 1 normalization, deduplication, unarchive, meaning patch/preserve, and input order.

`P2-DB-017` relies on transaction rollback for every invalid batch.

`P2-DB-018` requires empty search paths, qualified identifiers, explicit execute revocations, and minimum grants.

### Deployment and rollback

- `P2-DB-019`: migration timeouts are mandatory.
- `P2-DB-020`: measure the populated source table during the Production precondition.
- `P2-DB-021`: application rollback revokes bulk execution and hides the UI while retaining compatible data.
- `P2-DB-022`: database rollback after deployment is a forward migration.
- `P2-DB-023`: no upload/Storage/cleanup object changes.
- `P2-DB-025`: comments describe ownership, sensitivity, RPC-only writes, ordinals, and no retained photo/plaintext.

## Browser runtime and privacy contracts

### Runtime APIs

- `P2-CLI-001`: extend the reviewed OCR runtime with arbitrary-image inference returning stable line/word IDs, text, confidence, order, and geometry.
- `P2-CLI-002`: extend the NER Worker protocol for arbitrary normalized-line batches and explicit per-line `didRun`.
- `P2-CLI-003`: maintain immutable raw and corrected NER types with raw evidence, stable correction IDs, versions, operations, and reasons.
- `P2-CLI-004`: expose only review-safe candidates, `safeWords`, `sanitizedText`, and `removedLineCount`.
- `P2-CLI-005`: permit `@huggingface/transformers` imports only in the NER Worker.

### Normalized line

`P2-CLI-012` introduces `OcrWord`, `NormalizedSpanMapEntry`, and `NormalizedLine` contracts containing:

- stable OCR word IDs;
- word text, confidence, geometry, and original character range;
- original and NFKC/whitespace-normalized text;
- line/image geometry;
- half-open normalized UTF-16 ranges;
- mapping back to original ranges and OCR word IDs.

Model tokens remain distinct from OCR words and character ranges.

Out-of-range spans, inconsistent order, unresolved overlap, ambiguous mapping, or unconvertible offsets become `never_offer/unsafe_span_mapping`.

### Confidence and geometry

`P2-PRV-007`:

| Condition | Effect |
|---|---|
| Invalid word confidence | Suppress that word as a candidate; retain its text transiently for privacy analysis when safe. |
| Invalid word geometry with otherwise safe mapping | Suppress that word and continue. |
| Invalid line confidence | Whole line `never_offer/invalid_line_confidence`. |
| Invalid line geometry | Whole line `never_offer/invalid_line_geometry`. |
| Unsafe structural mapping | Whole line `never_offer/unsafe_span_mapping`. |

Candidate presentation:

| Confidence | Dictionary | State | Default |
|---|---|---|---|
| ≥90 | known/inflected | Normal | Selected |
| ≥90 | unknown | Possible typo/proper noun | Unselected |
| 70–<90 | Any | Confirm | Unselected |
| <70 | Any | Must review | Unselected |
| Invalid | Any | Suppressed | Hidden |

### NER correction governance

Every correction rule has:

- stable/versioned ID;
- reason;
- raw evidence where applicable;
- at least one registered fixture.

Cover relabel, omitted addition, split merge, Unicode boundaries, NFKC changes, whitespace collapse, malformed entities/spans, empty input, immutability, and provenance.

Every confirmed defect corrected through normalization, dictionary logic, post-processing, confidence, or context requires a fixture before merge.

### Policy API

`P2-PRV-006` defines:

```ts
function classifyLineDisposition(
  input: LinePolicyInput
): LineDispositionResult;
```

Input contains the normalized line, corrected entities, OCR words and IDs, word/line/image geometry, confidence, NER execution, Stage 1, script/dictionary, gazetteer, positional signals, and span mapping.

The result contains disposition, reason, and suppressed OCR-word IDs.

The table is signal precedence, not execution order. Cheap structural/size guards may return early; all other eligible lines compute the complete configured signal set before evaluation.

### Stage 1, script, dictionary, and gazetteer

- `P2-PRV-001`: detect email, phone, student/employee/account/member IDs, DOB, identifying URLs, postal addresses, and high-risk label-value lines.
- `P2-PRV-002`: direct high-confidence PII and every recognized high-risk label-value line are whole-line `never_offer`.
- `P2-PRV-003`: the gazetteer is contextual, not an allowlist. Bare gazetteer and corrected-NER ORG/LOC receive equivalent `full_offer` treatment absent higher-priority context.
- `P2-PRV-004`: CJK-dominant lines become `never_offer/non_target_script` before Latin candidate extraction. `chi_sim` remains benchmark-conditional.
- `P2-PRV-005`: the `<35%` English-match rule applies only with at least five eligible Latin tokens. Individual unknown words remain nonblocking.

### Positional institution rule

`P2-PRV-008`: positional logic runs only when the image has at least six structurally valid, nonblank OCR lines.

A line whose vertical midpoint is provisionally in the top or bottom 15% becomes `never_offer/header_footer_institution` only if it also has corrected/gazetteer ORG or an approved institution-title pattern.

Being near the edge alone is safe. Short/cropped images bypass only positional logic.

### Character and token guards

`P2-CLI-013`:

- normalized length >2,000 → `never_offer/input_too_large`, without tokenizer invocation;
- otherwise tokenize with special tokens, truncation disabled, no sliding window;
- encoded length >512 → `never_offer/ner_input_too_large`, without inference.

These lines have `nerRequired: false`.

An eligible line that fails mandatory NER causes fatal import abort.

`P2-CLI-014`: every model-eligible line runs raw NeuroBERT inference, immutable raw capture, correction, Stage 1, script/dictionary, gazetteer, positional signals, and corrected-entity policy evaluation.

### Disposition precedence

`P2-PRV-009`:

| Priority | Signal | Result |
|---:|---|---|
| 1 | Invalid line geometry/confidence, unsafe mapping, character overflow, token overflow | `never_offer` with specific reason |
| 2 | Stage 1 formatted PII/high-risk label | `never_offer/deterministic_high_risk_pii` |
| 3 | Positional institution | `never_offer/header_footer_institution` |
| 4 | CJK-dominant or line-level low-English match | `never_offer` with script/language reason |
| 5 | Malformed/ambiguous corrected NER | `never_offer/ner_ambiguous` |
| 6 | PERSON expansion exhausts four adjacent OCR words without boundary | `never_offer/person_boundary_uncertain` |
| 7 | Delimiter-bounded PERSON without Stage 1 label | `word_only/person_segment_removed` |
| 8 | Other corrected PERSON | `word_only/person_span_removed` |
| 9 | Bare ORG/LOC | `full_offer/public_entity_only` |
| 10 | No signal after complete stack | `full_offer/no_privacy_signal` |

Mandatory NER failure is an import abort outside this table.

PERSON suppression operates on complete OCR words and expands independently per side until `/`, `|`, tab, semicolon, line boundary, or the four-word limit.

Normative examples:

- `Employee: John Smith / Costco Wholesale` → Priority 2; no candidate survives.
- `Maria Garcia | complete the workplace safety checklist` → Priority 7; suppress left segment, allow safe right-side candidates, exclude line from `sanitizedText`.
- Bare `Costco` ORG in a clean teaching sentence → Priority 9.
- Required NER unavailable → abort.

### End-to-end processing

- `P2-CLI-006`: explicit student click before asset acquisition.
- `P2-CLI-007`: static capability checks without initializing NER.
- `P2-CLI-008`: magic-byte and encoded-dimension validation.
- `P2-CLI-009`: EXIF-aware direct resized decode to ≤2,200 px long edge.
- `P2-CLI-010`: acquire/run/dispose OCR.
- `P2-CLI-011`: acquire NER once after OCR.
- Construct geometry and stable IDs.
- Normalize and map spans.
- Apply character guard.
- Tokenize without truncation and apply token guard.
- Batch eligible lines at ≤100 lines/≤50,000 characters.
- Execute `P2-CLI-014`.
- Apply precedence.
- `P2-CLI-015`: deterministic rejection remains line-local; Worker/model/runtime/lifecycle failure aborts the import.
- `P2-CLI-016`: extract safe words, normalize/deduplicate deterministically, and construct `sanitizedText` from `full_offer` lines only.
- `P2-CLI-017`: prove TypeScript/Postgres normalization equivalence.
- Review locally.
- Validate OCR fields.
- Confirm through one action/RPC.
- `P2-CLI-018`: teardown on success, cancel, navigation, error, crash, or `pagehide`.
- `P2-CLI-019`: persist/send nothing before confirmation.
- `P2-CLI-020`: dictionary unknown remains nonblocking.
- `P2-CLI-021`: throughout the complete OCR route/session, allow only reviewed same-origin model/static-asset requests before confirmation and the explicit Supabase confirmation request afterward. Emit no Speed Insights, `sendBeacon`, analytics, telemetry, or external inference request because of the image, OCR content, candidates, edits, review actions, errors, or teardown.

## UI, Server Action, and telemetry isolation

- `P2-UI-001`: route shells remain Server Components; browser/model/review state remains in a route-local Client Component subtree.
- `P2-UI-002`: add `拍照导入` to `生词库` without Phase 3B rename/filters.
- `P2-UI-003`: select → validate → acquire → OCR → privacy → review → field validation → save → success → teardown.
- `P2-UI-004`: rows support edit/select/deselect/discard, separate OCR/dictionary badges, optional meaning, and examples only for `full_offer`.
- `P2-UI-005`: generate UUID at confirmation; identical transport retry reuses it; post-failure edit rotates it.
- `P2-UI-006`: same UUID/different hash receives generic error copy.
- `P2-UI-007`: `confirmOcrWordsBulk` re-authenticates, validates, calls only the bulk RPC, revalidates the library route, and returns a safe result.
- `P2-UI-008`: no create-import action.
- `P2-UI-009`: no Storage call and no image/blob/base64 Server Action field.
- `P2-UI-010`: labels, keyboard operation, managed focus, Chinese live regions, ≥44 px targets, headings, and narrow-mobile layout.
- `P2-UI-011`: implement every specified idle/progress/review/save/error/success/cancel state.
- `P2-UI-012`: deterministic client checks cover selected term, meaning, and example before RPC invocation.
- `P2-UI-013`: OCR review offers no “Send once” bypass. Phase 1 manual add remains unchanged.
- `P2-UI-014`: replace unconditional root-layout `<SpeedInsights />` mounting with a route-aware telemetry gate that does not mount Speed Insights on `/student/personal-english/import` or descendants. Verify both direct entry and client-side navigation into the route. If the package continues emitting after unmount or route transition, disable Speed Insights globally for the Phase 2 release rather than weakening the network-isolation assertion.

The telemetry gate must not receive, inspect, copy, or log captured content. Its decision is based only on the static route pathname.

Treat the Server Action as an untrusted POST boundary.

## Tests and CI

### Database and pgTAP

Create `personal_english_ocr.test.sql` covering:

- ledger columns, constraints, FK, RLS, grants, comments;
- migration-order contract;
- source CHECKs and exact indexes;
- legacy source/RPC behavior;
- public attach rejection of OCR;
- auth/ownership/input validation;
- ordered initial return/replay;
- Phase 1 dedup/unarchive/meaning semantics;
- private example helper and bulk delegation;
- blank example preservation;
- absence of the future public Phase 6 wrapper;
- PII appearing only in term, meaning, or example;
- rollback and quotas;
- UUID replay/invariant/cross-owner behavior;
- helper isolation;
- account cascade;
- absence of OCR Storage objects.

Add a two-session concurrency harness.

Phase 2 must not claim to execute-test the nonexistent Phase 6 wrapper. Phase 6 owns that future test.

### Security and registration

- `P2-CI-001`: frozen replay-generated legacy SECURITY DEFINER/ACL snapshot plus exact new-function checks.
- `P2-CI-002`: require every SQL test to be named in workflow or exemption manifest.
- `P2-CI-003`: retain the Games exemption.
- `P2-CI-004`: distinct named OCR, security, migration-order, and concurrency steps with fail-closed aggregation.
- `P2-CI-005`: inherit applicable Phase 0 runtime verification.
- `P2-CI-006`: every correction rule must have a registered fixture.
- `P2-CI-007`: add browser network-isolation tests for:
  - direct navigation to the OCR route;
  - client-side navigation from a page where Speed Insights was mounted;
  - image selection, model acquisition, OCR, review, editing, cancellation, error, success, and teardown;
  - zero Speed Insights/analytics/beacon requests during the OCR route lifetime;
  - zero captured content in request URLs, headers, bodies, telemetry payloads, errors, or exported diagnostics.

### Unit/browser coverage

Cover:

- image headers, MIME, EXIF, resized decode, cleanup;
- confidence × dictionary matrix;
- morphology and normalization;
- `P2-PRV-004` CJK handling;
- `P2-PRV-005` low-English matching;
- every Stage 1 family;
- Employee, Teacher, and Account # rejection;
- header/footer/clean edge/cropped positional cases;
- gazetteer and NER-only ORG/LOC equivalence;
- word/line confidence and geometry distinctions;
- unsafe mapping;
- whitespace and NFKC mapping;
- OCR-word PERSON boundaries;
- 2,000-character tokenizer-skip proof;
- 511/512/513-token behavior and inference-skip proof;
- `P2-CLI-014`;
- immutable raw NER and correction provenance;
- fixture registry;
- fatal mandatory-NER failure;
- deterministic batching/order;
- term/meaning/example client and server PII checks;
- no OCR “Send once” control;
- unchanged manual-add behavior;
- example helper invariant;
- lifecycle and teardown;
- UUID retry behavior;
- accessibility/mobile behavior;
- global network stubs including `fetch`, XHR, `sendBeacon`, `WebSocket`, `EventSource`, and known Speed Insights endpoints.

### Runtime/manual evidence

Re-run applicable Phase 0 checks for:

- exact asset hashes/sizes/licenses;
- real browser inference;
- Worker isolation;
- cold/warm behavior;
- cache/offline operation;
- asset failures and retry;
- cancellation/crash/teardown;
- zero external inference/telemetry;
- memory and bytes;
- low-end devices;
- Preview CDN/MIME/header behavior;
- raw/corrected NER evidence.

## Calibration and evaluation

- `P2-EVAL-001`: before full implementation, build a thin slice and time **ten representative 5–10-word fictional worksheets** against manual entry. Continue only if median OCR capture-to-save time is **≤60%** of manual entry or the owner explicitly accepts convenience rather than speed as the benefit.
- `P2-EVAL-002`: run a 50-line calibration before freezing policy/runtime thresholds.
- `P2-EVAL-003`: use fictional product-shaped material and approved public out-of-distribution layouts. Never use real learner materials.
- `P2-EVAL-004`: public crops with third-party PII require explicit provenance/privacy approval; otherwise use synthetic reproductions.
- `P2-EVAL-005`: release holdout includes at least 150 sensitive and 150 clean lines, requiring:
  - at least 148/150 sensitive lines blocked;
  - Wilson 95% lower bound ≥95%;
  - clean-line false suppression ≤15%;
  - teaching-word recall ≥75%;
  - clean-line PERSON-triggered suppression ≤3%.
- `P2-EVAL-006`: zero observed leakage is not zero real-world risk.
- `P2-EVAL-007`: no telemetry/override is authorized for `never_offer`; only local reason counts and guidance are allowed.
- `P2-EVAL-008`: at least 9/10 target configurations complete mandatory NER or `P2-OWN-002` reopens.
- `P2-EVAL-009`: `chi_sim` requires measured benefit.
- `P2-EVAL-010`: positional false suppression is reported separately and included within the unchanged aggregate ≤15% threshold.

The 50-line calibration allocation is:

- 10 full-page header/footer institution lines;
- 8 clean full-page edge-band instructional lines;
- 8 ORG-bearing first/last lines from cropped 3–5-line images;
- 8 Stage 1 label/direct-PII lines;
- 8 interior gazetteer/NER-only ORG/LOC lines;
- 8 PERSON-boundary, mapping, character-limit, and token-limit cases.

The release holdout also includes at least 30 qualifying institution lines and 30 clean edge/cropped lines, with at least half the latter from fewer-than-six-line images.

## Acceptance criteria

| ID | Assertion | Evidence |
|---|---|---|
| `P2-AC-001` | Source-type CHECK accepts `ocr_import`. | pgTAP |
| `P2-AC-002` | Legacy rows permit null OCR columns. | pgTAP |
| `P2-AC-003` | OCR rows require import ID and ordinal. | pgTAP |
| `P2-AC-004` | Initial/replay returns preserve order. | pgTAP |
| `P2-AC-005` | Concurrent first requests mutate once. | Concurrency harness |
| `P2-AC-006` | Cross-owner UUID access is denied generically. | pgTAP |
| `P2-AC-007` | Hourly quota is atomic. | Concurrency test |
| `P2-AC-008` | Lifetime import quota is enforced. | pgTAP |
| `P2-AC-009` | Lifetime item quota is enforced. | pgTAP |
| `P2-AC-010` | Invalid input leaves no writes. | Rollback tests |
| `P2-AC-011` | Server OCR PII defense covers term, meaning, and example. | Isolated-field tests |
| `P2-AC-012` | Server does not claim neural policy reproduction. | Design review |
| `P2-AC-013` | No OCR retention/upload object is added. | Catalog test |
| `P2-AC-014` | Public attach still rejects OCR. | pgTAP |
| `P2-AC-015` | Raw NER remains immutable. | Vitest |
| `P2-AC-016` | Corrections retain evidence/reason. | Vitest |
| `P2-AC-017` | Policy cannot consume raw entities. | Typecheck |
| `P2-AC-018` | Word confidence and line structural failures have distinct effects. | Unit matrix |
| `P2-AC-019` | Dictionary unknown is nonblocking unless the line-level rule fires. | Unit/privacy tests |
| `P2-AC-020` | Fatal NER failure shows/saves nothing. | Integration test |
| `P2-AC-021` | Before confirmation, only reviewed same-origin model/static-asset requests occur. | Network stubs/Preview |
| `P2-AC-022` | Teardown releases all captured state/resources. | Lifecycle tests |
| `P2-AC-023` | Cached OCR/NER works offline. | Browser/Preview |
| `P2-AC-024` | Device gate reaches 9/10 or architecture reopens. | Device report |
| `P2-AC-025` | NeuroBERT provenance/license is resolved in writing. | Owner/legal record |
| `P2-AC-026` | Ning-Privacy-Classifier is deferred. | Design/manifest |
| `P2-AC-027` | Accessibility/mobile requirements pass. | Automated/manual |
| `P2-AC-028` | Phase 1.5 closes before merge. | Owner record |
| `P2-AC-029` | Every CI substatus and aggregate is zero. | Workflow |
| `P2-AC-030` | Production requires convergence. | Closure |
| `P2-AC-031` | Exact NeuroBERT baseline is pinned. | Manifest |
| `P2-AC-032` | Character/token guards are distinct and skip work correctly. | Boundary tests |
| `P2-AC-033` | Normalized spans map safely or fail closed. | Fixtures |
| `P2-AC-034` | PERSON logic operates on OCR words. | Fixtures |
| `P2-AC-035` | Positional rule requires position, institution, and minimum content. | Positional tests |
| `P2-AC-036` | Gazetteer and NER-only bare ORG/LOC are equivalent. | Equivalence tests |
| `P2-AC-037` | Every high-risk label, including Employee, rejects the full line. | Stage 1 tests |
| `P2-AC-038` | Phase 2 bulk uses the tested private example helper; actual Phase 6 wrapper delegation is a future Phase 6 condition. | Phase 2 pgTAP/design |
| `P2-AC-039` | Every correction rule has a fixture. | Registry check |
| `P2-AC-040` | Client blocks OCR PII in all three fields before RPC. | Component tests |
| `P2-AC-041` | Replay proves exact FK ordering. | Named pgTAP/replay |
| `P2-AC-042` | OCR has no “Send once”; manual add remains unchanged. | UI/regression tests |
| `P2-AC-043` | Speed Insights and all other telemetry are silent for the entire OCR route/session, including direct entry and client navigation from a previously instrumented route. | Browser network tests and Preview trace |

## Requirement traceability

| Requirements | Enforcement | Evidence |
|---|---|---|
| `P2-OWN-*`, `P2-CON-*`, `P2-SCP-*` | Gates/scope assertions | Closure review |
| `P2-LIM-001`, `P2-RUN-*` | Manifests/generator | Generator/runtime tests |
| `P2-WRD-*` | Catalog/loader/legal gate | Inventory/dictionary tests |
| `P2-DB-001`–`P2-DB-025` | DDL/helpers/RPC/locks/grants | pgTAP/concurrency |
| `P2-CLI-001`–`P2-CLI-021` | Runtime/pipeline/network boundary | Typecheck, unit, browser |
| `P2-PRV-001`–`P2-PRV-009` | Policy modules/fixtures | Privacy evaluation |
| `P2-UI-001`–`P2-UI-014` | Route/review/action/telemetry gate | Component/hosted tests |
| `P2-CI-001`–`P2-CI-007` | Workflow/assertions | `verification_gate` |
| `P2-EVAL-001`–`P2-EVAL-010` | Calibration/holdout | Owner-reviewed reports |
| `P2-AC-001`–`P2-AC-043` | Evidence links above | Closure audit |

## File manifest

### Create

- Phase 2 plan, migration, pgTAP, security test, concurrency harness, registration assertion, Production precondition, and closure record
- Versioned limits/runtime/privacy/pattern/gazetteer/institution/correction/fixture artifacts
- Generator/checker
- OCR contracts, image guards, normalization/mapping, dictionary, policy, and pipeline modules
- OCR import route and route-local components
- `app/actions/personal-word-ocr.ts`
- Network-isolation and telemetry-gate tests
- A route-aware Speed Insights gate component
- Approved wordlist/notice and conditional `chi_sim`

### Modify

- Reviewed/committed local-AI runtime files after Phase 0 baseline reconciliation
- Existing personal-English page
- Root `app/layout.tsx`, replacing unconditional `<SpeedInsights />` with the OCR-aware gate
- ESLint/static boundary configuration
- P-1 workflow, package scripts, READMEs, generated database types, and migration inventory

### Explicitly untouched

- Existing applied migrations
- Upload RPCs, upload-purpose CHECK, attachment bucket, Storage policies, and cleanup
- Phase 1 public RPC signatures and manual-add behavior
- Vocabulary v1/v2
- Retired Games contracts
- Phase 3B naming/filter work

## Ordered implementation checklist

1. Query GitHub `main`; record exact HEAD and committed tree.
2. Re-audit the local dirty feature worktree separately; do not merge its status with GitHub evidence.
3. Diff every proposed Phase 0 file against current `main`; select only reviewed work for a dedicated Phase 0 dependency commit/PR.
4. Record owner decisions and reconciliation conflicts.
5. Close/preserve external gates without inferred PASS.
6. Run untouched zero-to-latest replay against current `main`.
7. Build the thin slice using ten 5–10-word fictional worksheets and the original ≤60% threshold.
8. Assemble the revised 50-line calibration and correction fixtures.
9. Freeze limits; calibrate/freeze runtime and privacy manifests.
10. Re-read installed Next.js and current Supabase guidance.
11. Audit root/global network emitters, including Speed Insights, before OCR UI implementation.
12. Replace unconditional Speed Insights mounting with the route-aware OCR telemetry gate.
13. Prove direct-entry and client-navigation telemetry silence; if unmount/gating is insufficient, disable Speed Insights globally for the release.
14. Generate the migration through the Supabase CLI.
15. Create ledger before FK; add constraints, indexes, RLS, grants, and comments.
16. Add PII, OCR-source, and shared-example helpers.
17. Add the atomic bulk RPC.
18. Preserve Phase 1 manual add unchanged.
19. Extend reviewed OCR runtime and implement geometry.
20. Implement normalization and reversible mapping.
21. Extend pinned NER runtime and corrections.
22. Implement `P2-CLI-014` and `P2-PRV-001`–`P2-PRV-009`.
23. Implement candidate extraction and teardown.
24. Implement review UI, no-consent OCR validation, and Server Action.
25. Add database, concurrency, unit, browser, privacy, accessibility, lifecycle, and telemetry-isolation tests.
26. Add CI registration, ACL, Games exemption, and fail-closed statuses.
27. Regenerate inventory/types through generators.
28. Run Docker-free local checks.
29. Complete replay, named suites, type drift, application checks, artifacts, and aggregation.
30. Apply original holdout thresholds: ≤15% clean false suppression, ≥75% teaching recall, ≤3% clean PERSON suppression.
31. Complete device, licensing, dependency, and telemetry gates.
32. Upgrade Next.js to the approved patched 16.x baseline.
33. Deploy only to isolated Preview and run browser/RLS/runtime/offline/network acceptance.
34. Run protected Production precondition and obtain approval.
35. Deploy through the authorized mechanism.
36. Complete read-only convergence before PASS.
37. In Phase 6, implement and test the public example wrapper’s delegation.

## Master Plan Synchronization Required

Update:

- §3.2 policy contract, Employee reversal, precedence, and examples;
- runtime/NER model, limits, mapping, and correction governance;
- Phase 2 database/runtime/UI/telemetry description;
- tests and revised calibration composition while retaining original evaluation thresholds;
- Phase 6 shared-helper delegation and future test ownership;
- Decision Log with `P2-CON-012`;
- baseline language so GitHub `main` and local dirty Phase 0 evidence are never conflated;
- privacy/network sections to record that global Speed Insights is gated off the OCR route.

## Final self-audit

Confirm:

- authoritative GitHub and local dirty baselines are separate;
- committed GitHub `main` is not described as containing Phase 0 OCR/NER;
- Speed Insights is identified and gated;
- no telemetry request occurs during the OCR route/session;
- `P2-EVAL-001` says ten 5–10-word worksheets and ≤60%;
- `P2-EVAL-005` retains ≤15%, ≥75%, and ≤3%;
- `P2-CLI-014`, `P2-PRV-004`, and `P2-PRV-005` exist;
- OCR has no “Send once” while manual add remains unchanged;
- Phase 2 does not claim to test the nonexistent Phase 6 wrapper;
- every referenced requirement ID exists;
- privacy examples, database contracts, tests, manifest, checklist, and acceptance criteria agree.

## 2. Reconciliation Summary

| Source requirement | Superseded behavior | Final behavior | Final requirement ID |
|---|---|---|---|
| Employee label | Partial recovery allowed `Costco` | Whole-line rejection | `P2-OWN-007`, `P2-CON-012` |
| Policy API | Two-argument function | Structured line input/result | `P2-PRV-006` |
| Gazetteer | Ambiguous allowlist behavior | Context signal; bare ORG/LOC normally allowed | `P2-PRV-003` |
| Geometry/mapping | No reversible normalized mapping | OCR-word-aware fail-closed mapping | `P2-CLI-012`, `P2-PRV-007` |
| Model limits | Character cap only | Independent character/token guards | `P2-CLI-013` |
| Correction governance | Partial provenance | Versioned rules and fixtures | `P2-CI-006` |
| Example write | Independent mutation | Shared private helper | `P2-DB-015` |
| OCR field PII | Term/example only | Term, meaning, and example; no consent bypass | `P2-DB-016`, `P2-UI-012`, `P2-UI-013` |
| Phase 6 wrapper | Could appear testable during Phase 2 | Contract now; executable delegation test in Phase 6 | `P2-AC-038` |
| Migration order | Descriptive only | Exact-FK replay contract | `P2-DB-024`, `P2-AC-041` |
| Calibration | Superseded allocation | Revised 10/8/8/8/8/8 composition | `P2-EVAL-002`, `P2-EVAL-010` |

The reconciliation changes calibration composition and policy coverage. It does not change the original 5–10-word thin-slice range or the original evaluation thresholds.

## 3. Unresolved Conflicts

No unresolved reconciliation conflicts remain.

Open items are implementation/release gates—not source-document conflicts—including Phase 0 commit/review, calibration approval, licensing, device evidence, telemetry isolation, Preview evidence, and Production authorization.
