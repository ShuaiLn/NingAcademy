# Phase 0 local runtime evidence

Date: 2026-09-13  
Integration base: `feature/personal-word-library-phase-1-5` at
`069ba18d3e405f71b4dc48a841467851242382ab`

## Scope and conclusion

This work validates the Phase 0 architecture for local OCR, compact NER, and
KittenTTS Nano INT8. It does not implement learner-facing capture/import,
entity/privacy, speech, assignment, teacher, learner-model, vocabulary, or
persistence features. It makes no database, RLS, RPC, migration, Supabase
Storage, retired-Games, Production-data, or deployment change. The Full
Implementation Plan was not edited.

The three real browser runtimes pass the available normal-device technical
checks, including production build, Worker execution, repeated inference,
explicit cache eviction/reload, offline cached-model execution, locality, and
failure/recovery checks. Phase 0 is nevertheless **BLOCKED**, not accepted or
closed, because the current browser-delivered TTS Worker contains GPL-covered
eSpeak code/data without a resolved distribution strategy and the converted
NeuroBERT artifact lacks an explicit conversion-repository license statement.
The required physical low-end-device validation and owner listening acceptance
also remain outstanding, but those owner-only gates are not the reason for the
technical/legal `BLOCKED` classification.

## Reference device and measurement method

Normal device: Lenovo 82YA, Windows 11, Intel Core i7-13700H (14 cores/20
logical processors), 16 GiB RAM. Browsers installed: Microsoft Edge
152.0.4191.66 and Firefox 155.0.1. Browser timings came from
`performance.now()` inside the real page/Worker.

Memory figures are the sum of new Edge process working sets sampled every 200
ms in a fresh browser process tree. They include browser, renderer, Worker, and
GPU processes and are approximate process-tree deltas, not isolated model or
GPU allocations. Main-page JS heap metrics do not include Worker/GPU buffers.

No qualifying low-end physical device was available. No low-end results,
substitutes, simulations, thresholds, or procedures are asserted here. Device
policy therefore uses prerequisites and runtime probing rather than guessed
RAM/core cutoffs or automatic model downloads.

## OCR

Candidate: `tesseract.js@7.0.0`, matching Tesseract core, and Project Naptha
English fast trained data. Tesseract owns the real nested Worker. Library
language caching is disabled so the shared catalog remains the asset inventory
authority.

Production Edge evidence:

- Isolated candidate: 715.5 ms cold initialization, 115.8 ms inference.
- Retained adapter: 1,140.1 ms cold initialization, 110.7 ms inference; later
  warm initialization after other workloads: 314.4 ms, 122.4 ms inference.
- Fresh memory run: 902.2 ms initialization, 116.7 ms inference. Edge process
  tree rose from 564,776,960 to 733,851,648 bytes: +169,074,688 bytes
  (161.24 MiB). Five seconds after release it was 642,592,768 bytes:
  +77,815,808 bytes (74.21 MiB) above baseline. Main-page JS heap changed from
  3,142,564 to 4,015,556 bytes.
- Offline cached-model run, with the synthetic PNG supplied locally as a user
  file would be: 276.7 ms initialization, 112.9 ms inference, confidence 95,
  non-empty geometry, no failed request, and no external request.
- Every measured inference exactly recognized the synthetic non-personal
  phrase with confidence 95 and non-empty block geometry.
- Worker, core, and language data stayed on the application origin. LSTM,
  SIMD-LSTM, and relaxed-SIMD-LSTM variants allow Tesseract to select a
  supported implementation.
- Aborting an actual streaming first download left zero OCR metadata entries;
  retry restored all five assets and succeeded.

Status: normal-device technical PASS. The owner-run physical-device gate is
outstanding.

## NER

Candidate: `onnx-community/NeuroBERT-NER-ONNX` at
`e3a6a290e438a506d2ba7bbb0f5875b7f034cebf`, quantized ONNX (`q8`), using
`@huggingface/transformers@4.2.0` and its pinned ONNX Runtime Web WASM backend.
Remote models and runtime-managed remote caching are disabled. ONNX Runtime is
limited to one WASM thread, so the production Worker succeeds without adding
COOP/COEP headers.

The retained output architecture is:

`NFKC/whitespace normalization -> raw NER inference -> targeted/configurable correction -> final structured entities`

The correction result preserves a cloned raw inference list and, for each
corrected entity, the contributing raw labels, raw scores, and exact character
spans/token boundaries. Known-organization matching uses Unicode token
boundaries and a configurable dictionary. It can correct a mislabeled entity,
merge overlapping split tokens, or add a model-omitted entity. It is not tied
to one benchmark sentence.

Observed model evidence:

- Maria Garcia: raw `PERSON`, score 0.8687.
- Microsoft: raw `GPE`, score 0.6607, narrowly corrected to `ORG`.
- Seattle: raw `GPE`, score 0.9078.
- Amazon was correctly labeled `ORG`; Microsoft varied by context; Google and
  Apple could be omitted; OpenAI could split across inconsistent labels.
- This small corpus shows isolated organization correctness defects that the
  approved correction architecture can represent. It does not establish
  systemic failure. A future systemic failure is a stop condition, not
  permission to replace the model.

Runtime evidence:

- Production Edge: 1,346.4 ms cold initialization and 42.3 ms inference in the
  no-COOP/COEP run; another run measured 2,560.8 / 61.2 ms.
- Retained cross-model sequence: 720.6 ms initialization and 74.2 ms corrected
  inference after OCR and TTS disposal.
- Fresh memory run: 592.6 ms initialization and 59.8 ms inference. Edge process
  tree rose from 604,839,936 to 850,812,928 bytes: +245,972,992 bytes
  (234.58 MiB). Five seconds after release it was 626,073,600 bytes:
  +21,233,664 bytes (20.25 MiB) above baseline. Main-page JS heap changed from
  3,141,292 to 2,625,408 bytes.
- Explicit browser cache eviction removed all six NER assets with no failed
  deletion; a real reload restored all six and succeeded in 475.7 ms
  initialization / 43.5 ms inference.
- Offline cached-model run: 431.6 ms initialization / 42.1 ms inference, no
  failure and zero external requests.
- Deliberately corrupting the cached ONNX produced a real protobuf parse
  failure; the adapter evicted the complete NER group and an explicit retry
  succeeded in 57.0 ms inference.
- Unit regressions cover Microsoft relabeling, omitted Apple, split OpenAI
  merging, raw labels/scores/spans, Unicode normalization, boundary rejection,
  an injected non-benchmark organization, empty input, and malformed non-string
  entity input.

Status: normal-device technical architecture PASS, with known isolated risks
and regression coverage. Redistribution provenance is not yet accepted; see
the license review.

## TTS - KittenTTS Nano INT8

Piper is permanently rejected and is not a fallback. Candidate: KittenML Nano
INT8 model/voices at
`84781d74e29ee25217551556398b42f80593a813`, using the installed
`kitten-tts-webgpu@0.1.1`. The verified runtime source corresponds to upstream
commit `35f31049363ea39464dc05d42c1135b5c9e3235f`.

The Next.js 16.3 production build compiles the runtime with Turbopack into a
dedicated module Worker. A narrow Worker `globalThis.window` alias supports
upstream callbacks that still reference `window`; the lifecycle can always
hard-terminate the Worker. This shim should be removed if upstream becomes
natively Worker-safe.

Real Edge synthesis evidence:

- WebGPU device initialization: 356.7-455.0 ms.
- First local model/voice load after GPU setup: 1,119-1,192 ms.
- Cached reload components: 154.7 ms WebGPU initialization plus 533.5 ms model
  parsing/GPU upload; model and voice responses were cache hits.
- First diagnostic: 0.873-0.905 seconds to synthesize 7.35 seconds of audio.
- Repeated sentence: 0.491-0.535 seconds to synthesize 4.725 seconds of audio.
- Retained cross-model sequence: 1,110.0 ms initialization and 711.1 ms
  synthesis for 4.375 seconds / 105,000 non-zero samples at 24 kHz.
- Fresh memory run: 1,283.2 ms initialization and 676.1 ms synthesis for the
  same valid 4.375-second waveform. Edge process tree rose from 620,425,216 to
  867,270,656 bytes: +246,845,440 bytes (235.41 MiB). Five seconds after
  release it was 717,131,776 bytes: +96,706,560 bytes (92.23 MiB) above
  baseline. Main-page JS heap changed from 3,141,708 to 3,404,392 bytes.
- Offline cached-model run: 588.6 ms initialization and 856.3 ms synthesis for
  4.375 seconds / 105,000 non-zero samples, no failures and zero external
  requests.
- Final traces contained no external HTTP(S) inference, telemetry, CDN,
  Supabase, or model request. Page, Worker chunks, model, voices, phonemizer,
  and inference stayed local/same-origin.

Capability and recovery evidence:

- Capability collection performs an actual asynchronous
  `navigator.gpu.requestAdapter()` probe. Missing API is `unknown`; a null
  adapter or probe failure is `false`; only a returned adapter is `true`.
- Edge launched with WebGPU/GPU disabled retained OCR and NER availability but
  returned TTS `webgpu-unavailable` before lifecycle acquisition, with zero AI
  asset and external requests.
- A TTS run re-probes WebGPU at invocation time. After the disposable harness
  killed its Edge GPU process, the next run failed closed with
  `webgpu-unavailable`, released the formerly hot runtime, and returned the
  lifecycle to `idle`. Same-document GPU recovery was unavailable; a fresh
  browser initializes normally.
- Intercepting the actual production TTS Worker chunk with a forced throw made
  lifecycle state `failed`, code `initialization-failed`, retryable `true`,
  generation 1. Explicit retry created generation 2 and produced valid audio
  after 1,337.6 ms initialization / 999.2 ms synthesis.
- Cancelling during real synthesis returned `AbortError`, dropped the Worker,
  and a warm explicit retry produced valid speech in 715.7 ms.
- Cached model/voice corruption or incomplete writes are rejected by catalog
  size/hash/integrity paths; runtime initialization rejection clears the TTS
  group before retry.

Objective speech evidence: Windows local en-US recognition transcribed the
fixed generated phrase exactly with confidence 0.7804. This supports but does
not replace human approval.

Human listening artifact:

- File: `docs/personalized-english/evidence/kitten-tts-nano-int8-listening.wav`
- SHA-256: `22bc17b5fa517248003f30286b8150858a8933d60018e3b24fa3744bd1bc08ab`
- Size: 352,844 bytes; mono PCM WAV, 24 kHz, 7.35 seconds.
- Voice/settings: Bella, speed 1.
- Exact input: `The quick brown fox jumps over the lazy dog while the sun sets behind the mountains.`

Owner listening procedure: verify the file hash; play the WAV end-to-end on a
normal speaker or headphones; compare it with the exact text above; record a
pass/fail judgment for intelligibility, pronunciation errors, truncation,
artifacts, pacing, and practical learner use. Codex does not claim this
subjective approval.

Status: normal-device technical PASS for real synthesis, repetition,
cancellation/retry, Worker lifecycle/crash, current WebGPU detection/failure,
Next.js 16 production build, Edge, self-hosting, cache/offline execution, and
locality. Formal TTS acceptance is blocked by redistribution disposition and
still requires owner listening and low-end-device evidence.

## Asset footprint and integrity

All 13 retained runtime assets are registered with exact byte size and SHA-256
in `app/_lib/local-ai/asset-catalog.ts`. Browser cache writes enforce response
completeness; final verification recomputed every repository file hash against
the catalog.

| Workload | Asset group | Raw bytes | gzip bytes |
| --- | --- | ---: | ---: |
| OCR | Worker + three LSTM core variants + English trained data | 14,765,903 | 7,352,026 |
| NER | config + tokenizer + q8 model + ORT loader/WASM | 33,988,482 | 12,572,894 |
| TTS | Nano INT8 ONNX + voices | 27,648,873 | 23,610,513 |
| All catalogued assets | 13 files | 76,403,258 | 43,535,433 |

Largest file: TTS ONNX, 24,369,971 bytes. The measured production TTS Worker
chunk was 1,430,256 bytes and contains the engine, shaders, and phonemizer.

## Cache, lifecycle, privacy, and failure contracts

- One per-document lifecycle serializes acquisition. Workload switches cancel
  and dispose the current Worker before creating another. Generation/request
  IDs reject stale messages.
- Catalog URLs are the only model responses accepted. Cache Storage holds
  versioned immutable public responses. IndexedDB holds only asset ID, kind,
  version, byte size, and cache timestamp.
- First-download bodies stream concurrently to Cache Storage and a decoded-byte
  verifier; partial/short bodies and failed writes are removed before metadata
  commit. Repository hashes pin content independently.
- Tests cover cold/hit, allowlist rejection, quota sufficient/insufficient/
  unknown, pre-write rejection, interrupted and partial responses, stale
  metadata/browser eviction, old/orphan cleanup, per-asset invalidation,
  unload-before-clear, and partial clear failure.
- Lifecycle tests cover reuse, all model transitions, concurrent serialization,
  failure cleanup, fresh retry, ordered progress, stale-generation rejection,
  `messageerror`, disposal acknowledgement/timeout, hard termination, and
  disposal failure without retaining a hot handle.
- Browser failure experiments covered interrupted OCR download, corrupt NER,
  actual TTS cancellation, forced TTS Worker crash, explicit cache eviction and
  reload, unsupported WebGPU, and GPU-process loss.
- The retained diagnostic exporter omits OCR text, entity contents, TTS input
  and audio, account data, cookies, and credentials. Inputs/results remain
  transient.
- The diagnostic route is unlinked, authenticated by existing Proxy behavior,
  and server-disabled unless `LOCAL_AI_DIAGNOSTICS_ENABLED=true`. Model and
  fixture prefixes are exact public matches. No ordinary page imports a model.

The production browser sequence `OCR -> KittenTTS -> NER -> OCR` ended in
`idle`, inventoried all 13 assets, and reported `insufficient` for a one-byte
artificial quota against each model group. It made zero external requests. A
non-fatal local Speed Insights stub parse error was independently attributed to
the pre-existing `/_vercel/speed-insights/script.js`, not any model/runtime.

## Browser and target-deployment feasibility

- Next.js 16.3.0/Turbopack production build and `next start`: PASS.
- Approximate source upload excluding `.git`, `.next`, and `node_modules`: 336
  files, 87,620,148 bytes (83.561 MiB). The public runtime assets account for
  76,403,258 bytes (72.864 MiB). Vercel currently documents a 100 MB Hobby CLI
  source-upload limit, 1 GB Pro limit, and 15,000 files; the measured tree fits.
- Assets are static `public/` files and do not appear in server trace/function
  bundles. The 250 MB Function limit is not consumed by model weights.
- Observed production headers: exact `Content-Length`, `Accept-Ranges: bytes`,
  and `Cache-Control: public, max-age=31536000, immutable`. MIME types were
  `.wasm` `application/wasm`, JS/MJS JavaScript, JSON `application/json`, `.gz`
  `application/gzip`, and ONNX/NPZ `application/octet-stream`.
- All Worker, model, and WASM requests are same-origin. No CORS relaxation,
  COOP, or COEP was required. WebGPU runs in the browser, not Vercel Edge
  Runtime; Vercel serves static assets over HTTPS/CDN.
- No Vercel deployment was made because the normative Phase 0 plan prohibits
  deployment. Actual Preview upload/CDN verification remains a downstream
  deployment gate rather than fabricated evidence.

Details and source links are in
`docs/personalized-english/PHASE0_SECURITY_DEPLOYMENT_REVIEW.md`.

## Dependency/security result

Fresh `npm audit --omit=dev --json`: 5 production findings, comprising 1
critical and 4 high.

- Installed `next@16.3.0` is affected by Windows-hosted RCE
  `GHSA-p293-qw3h-jr36` and AVIF RCE `GHSA-2xp9-vwfh-vxw4`; the first patched
  16.x version is 16.3.3 and npm currently selects 16.3.5. No Phase 0 upgrade
  was made because a framework-wide update is outside this runtime validation
  and no deployment is authorized. Updating Next and matching
  `eslint-config-next`, followed by full regression, is mandatory before later
  deployment.
- Transformers 4.2.0 is the current installed/registry release but installs
  Node-only `onnxruntime-node@1.24.3 -> adm-zip@0.5.18` and `sharp@0.34.5`, which
  remain in affected audit ranges. The exercised browser Worker selects
  `transformers.web.js`/ORT Web; production bundles and 46 server trace files
  contain none of those Node packages. The findings are not reachable in the
  retained browser inference path but remain install-time/supply-chain and
  accidental-server-import risks. Track an upstream supported update; do not
  force incompatible overrides.
- Next's separate `sharp@0.35.3` is below the current 0.35.4 advisory patch.

Exact advisory ranges and source links are in
`docs/personalized-english/PHASE0_SECURITY_DEPLOYMENT_REVIEW.md`.

## License and redistribution result

Verified licenses for the retained exact artifacts are Apache-2.0 for
Tesseract.js/core/trained data, Transformers.js, and Kitten weights/voices;
MIT for ONNX Runtime Web and the installed Kitten wrapper 0.1.1; Apache-2.0 for
the phonemizer wrapper. Applicable license texts/notices and attributions must
ship.

Two items are unresolved:

1. The actual generated browser TTS Worker contains eSpeak NG WASM and
   dictionary/rule material. eSpeak NG is GPL-3.0-or-later. The installed
   wrapper artifacts provide neither an eSpeak GPL notice nor a Corresponding
   Source offer, and the legal scope of GPL obligations for the single combined
   Worker bundle is unresolved. This is a distribution blocker.
2. The pinned NeuroBERT ONNX conversion names an Apache-2.0 source model but its
   conversion repository has no license card field or `LICENSE` file. The
   converted artifact's provenance/notice handling needs written owner/legal
   acceptance or a replacement conversion with explicit terms and repeated
   hash/runtime checks.

This is technical compliance analysis, not legal advice. Exact component
evidence, obligations, and source links are in
`docs/personalized-english/PHASE0_THIRD_PARTY_LICENSE_REVIEW.md`.

## Ning-Privacy-Classifier disposition

The normative Master Plan describes a separate per-line four-way classifier:
`PERSONAL_FIELD | MIXED_CONTENT | PEDAGOGICAL_CONTENT | AMBIGUOUS`. It follows
deterministic sensitive-field/regex rules, gazetteers, and pretrained NER, then
feeds a conservative import-offer policy. It uses line context, layout, and
position; this responsibility does not overlap with extracting named entities.

The Master Plan also says deterministic v1 may ship and the neural classifier
is a Phase 2 accuracy improvement rather than a launch blocker, while some
Phase 0 text counts four coordinated models. The Phase 0 specific plan defines
only OCR, NER, and TTS and never requires a privacy-classifier spike. Current
NER evidence therefore neither implements nor technically eliminates the
separate classifier.

This is an owner architecture decision:

- Keep it separate: select/train a candidate, add a fourth lifecycle kind and
  repeat browser, Worker, cache, memory, offline, locality, license, and
  deployment validation before neural use. Deterministic Phase 2 v1 can remain
  the accepted interim path.
- Defer it as optional Phase 2+ work: amend the normative model count and Phase
  0 acceptance to three, retaining conservative deterministic policy.
- Remove or merge it: this materially changes the privacy architecture. The
  current NER cannot substitute for line-level classification, so policy and
  acceptance criteria would need explicit redesign and owner approval.

It was not silently removed, conflated with NER, or implemented in Phase 0.

## Automated verification

Final verification results are recorded after removal of the disposable
closure-only route:

- `npm run test:unit`: PASS, 4 files / 41 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with 0 errors / 3 pre-existing warnings.
- `npm run build`: PASS under Next.js 16.3.0/Turbopack.
- `npm run audit:p1:git-migrations`: PASS; 33 tracked migrations unchanged.
- `npm run audit:p1:game-listening`: PASS.
- `git diff --check`: PASS.
- Catalog file size/SHA-256 verification: PASS, 13/13 assets.
- Local database-backed tests were unavailable because no local
  Supabase/Docker database listened at `127.0.0.1:54322`. The existing P-1 CI
  replay remains authoritative; this is not reported as a pass.
- No remote Actions workflow was triggered, so remote CI status is unavailable.

## Phase 0 boundary audit

Modified existing files and direct Phase 0 purpose:

- `.env.example`: documents the server-only diagnostic gate.
- `.github/workflows/p1-database-audit.yml`: makes the Phase 0 unit suite a
  mandatory application check in the existing audit workflow.
- `README.md`: documents diagnostic access, locality/privacy, and cache
  ownership.
- `eslint.config.mjs`: excludes pinned generated/vendor model files from source
  linting.
- `next.config.ts`: immutable caching for versioned same-origin model assets.
- `package.json`, `package-lock.json`: pin the three validated runtimes and
  Vitest; add the Phase 0 unit command.
- `proxy.ts`: exact public bypasses for versioned assets and the non-personal
  OCR fixture; the application diagnostic remains authenticated.

Created runtime, diagnostic, test, and CI files:

- `.github/workflows/application-quality.yml`
- `vitest.config.ts`
- `app/_components/local-ai/model-download-progress.tsx`
- `app/_hooks/use-local-ai-runtime.ts`
- `app/_lib/local-ai/asset-catalog.ts`
- `app/_lib/local-ai/contracts.ts`
- `app/_lib/local-ai/device-capabilities.ts`
- `app/_lib/local-ai/device-capabilities.test.ts`
- `app/_lib/local-ai/device-tier-policy.ts`
- `app/_lib/local-ai/model-cache.ts`
- `app/_lib/local-ai/model-cache.test.ts`
- `app/_lib/local-ai/model-lifecycle.ts`
- `app/_lib/local-ai/model-lifecycle.test.ts`
- `app/_lib/local-ai/worker-protocol.ts`
- `app/_lib/local-ai/models/worker-model.ts`
- `app/_lib/local-ai/models/ocr-runtime.ts`
- `app/_lib/local-ai/models/ner-runtime.ts`
- `app/_lib/local-ai/models/kitten-tts-runtime.ts`
- `app/_lib/local-ai/models/ner-corrections.ts`
- `app/_lib/local-ai/models/model-adapters.test.ts`
- `app/_lib/local-ai/workers/ner.worker.ts`
- `app/_lib/local-ai/workers/kitten-tts.worker.ts`
- `app/student/personal-english/local-runtime-diagnostics/page.tsx`
- `app/student/personal-english/local-runtime-diagnostics/diagnostics-client.tsx`
- `docs/personalized-english/PHASE0_LOCAL_RUNTIME_EVIDENCE.md`
- `docs/personalized-english/PHASE0_THIRD_PARTY_LICENSE_REVIEW.md`
- `docs/personalized-english/PHASE0_SECURITY_DEPLOYMENT_REVIEW.md`
- `docs/personalized-english/evidence/kitten-tts-nano-int8-listening.wav`

Created pinned public Phase 0 assets:

- `public/local-ai-diagnostics/ocr-smoke-test.png`
- `public/local-ai-assets/ocr/tesseract-7.0.0/worker.min.js`
- `public/local-ai-assets/ocr/tesseract-7.0.0/tesseract-core-lstm.wasm.js`
- `public/local-ai-assets/ocr/tesseract-7.0.0/tesseract-core-relaxedsimd-lstm.wasm.js`
- `public/local-ai-assets/ocr/tesseract-7.0.0/tesseract-core-simd-lstm.wasm.js`
- `public/local-ai-assets/ocr/tesseract-7.0.0/eng.traineddata.gz`
- `public/local-ai-assets/ner/neurobert-e3a6a29/config.json`
- `public/local-ai-assets/ner/neurobert-e3a6a29/tokenizer.json`
- `public/local-ai-assets/ner/neurobert-e3a6a29/tokenizer_config.json`
- `public/local-ai-assets/ner/neurobert-e3a6a29/onnx/model_quantized.onnx`
- `public/local-ai-assets/ner/ort-1.26.0-dev/ort-wasm-simd-threaded.asyncify.mjs`
- `public/local-ai-assets/ner/ort-1.26.0-dev/ort-wasm-simd-threaded.asyncify.wasm`
- `public/local-ai-assets/tts/kitten-nano-int8-84781d7/kitten_tts_nano_v0_8.onnx`
- `public/local-ai-assets/tts/kitten-nano-int8-84781d7/voices.npz`

Each file exists only to implement, test, or document the required Phase 0
runtime architecture. The disposable public closure route was removed after
measurement. No later-phase functionality was implemented. The user-owned
untracked Master Plan remains byte-for-byte untouched; observed SHA-256:
`d5653f15556e7b4212c5acb97acb62b03195015bb295fda2646e6c82190f2aa`.

## Required Full Implementation Plan Updates

These are factual downstream deltas only. The Full Implementation Plan was not
generated, rewritten, or amended.

### TTS architecture

1. Current assumption: Piper voice/runtime, phonemizer, fallback language, and
   WASM-oriented estimates.
2. Evidence: Piper was permanently rejected; KittenTTS Nano INT8 passes real
   Edge/WebGPU/Worker/Next 16/locality checks on the reference device.
3. Required modification: replace all Piper references with pinned KittenTTS
   Nano INT8; explicitly require WebGPU, same-origin model/voice assets, Worker
   execution, and no Piper fallback.
4. Affected phases: 0, 7, 11, sequencing/dependency diagrams and open decisions.
5. Type: architecture, dependency, implementation, documentation, and
   acceptance-criteria change.
6. Stale later plan: any written Phase 7 plan naming Piper or WASM performance
   assumptions.
7. Owner approval: already supplied for KittenTTS; learner-visible fallback,
   final voice quality, and GPL distribution response still require approval.

### TTS footprint, capabilities, and recovery

1. Current assumption: generic local-TTS capability/device selection.
2. Evidence: WebGPU-only runtime, 27,648,873 model/voice bytes plus a measured
   1,430,256-byte Worker; normal-device peak process-tree delta 235.41 MiB;
   unsupported/lost WebGPU fails closed.
3. Required modification: use measured footprints, probe a real adapter, define
   runtime cleanup/retry, and retain a product-decision placeholder for
   unsupported browsers.
4. Affected phases: 0, 7, 11.
5. Type: architecture, implementation, dependency, acceptance criteria.
6. Stale later plan: Piper/WASM sizes, capability assumptions, and fallback.
7. Owner approval: required for product fallback and post-device measurements.

### NER correction architecture

1. Current assumption: compact NER output can flow directly to later policy.
2. Evidence: isolated organization omission/mislabel/split errors; general
   correction tests preserve raw evidence.
3. Required modification: normalization -> raw NER -> configurable targeted
   correction -> final entities; preserve raw labels, scores, and spans; add a
   regression for every confirmed fixed defect.
4. Affected phases: 0 and 2.
5. Type: architecture, implementation, acceptance criteria.
6. Stale later plan: any Phase 2 consumer treating raw NER as final.
7. Owner approval: supplied for bounded corrections; model replacement or a
   major classifier change requires new approval.

### Ning-Privacy-Classifier/model count

1. Current assumption: some Master Plan text counts a fourth local classifier,
   while the specific plan validates three runtimes and calls the classifier a
   later accuracy improvement.
2. Evidence: Phase 0 NER is entity extraction/correction and cannot perform the
   documented line-level privacy classification responsibility.
3. Required modification: explicitly choose separate validated fourth model,
   optional Phase 2+ deferral, or a redesigned removal/merge.
4. Affected phases: 0, 2, 5, lifecycle diagrams and sequencing.
5. Type: architecture and acceptance-criteria clarification.
6. Stale later plan: any plan assuming either four validated hot models or that
   NER silently replaced the classifier.
7. Owner approval: required.

### Distribution, security, and deployment gates

1. Current assumption: browser success and model licenses are sufficient for
   later self-hosted production integration.
2. Evidence: GPL-covered eSpeak is embedded in the TTS Worker, NeuroBERT
   conversion licensing is unstated, Next 16.3.0 has a critical patched
   advisory, the Transformers tree has non-reachable browser-path findings, and
   source payload is 83.561 MiB.
3. Required modification: add third-party notices/GPL/source disposition,
   explicit ONNX provenance, Next patch before deployment, audit tracking, and
   actual Vercel Preview upload/header validation before production.
4. Affected phases: 0, 7, 11 and deployment/release gates.
5. Type: dependency, legal/compliance, deployment, documentation, acceptance
   criteria.
6. Stale later plan: any plan treating Kitten wrapper/phonemizer distribution,
   current Next, or Vercel payload as fully cleared.
7. Owner approval: legal/security/deployment owners must approve before later
   production integration.

Exact sections that eventually require revision: cross-cutting local-model and
privacy decisions; Phase 0 local runtime; Phase 2 OCR/privacy import; Phase 7
TTS; Phase 11 client storage; sequencing; and open decisions naming Piper,
NeuroBERT/NER, Ning-Privacy-Classifier, device fallback, licensing, or browser
backend. Editing those sections is intentionally deferred until the owner
separately requests a new Full Implementation Plan.

## Remaining unresolved gates

### Owner-run physical-device validation

The required low-end physical-device validation remains outstanding.

### Owner human-quality approval

The owner must complete and record the listening judgment using the retained
WAV and exact procedure in the TTS section. Automated ASR is supporting
evidence only.

### Owner architecture/product decisions

- Decide the learner-visible behavior when WebGPU/KittenTTS is unavailable;
  only technical fail-closed behavior was validated.
- Decide among the three Ning-Privacy-Classifier dispositions documented above.

### Legal/licensing uncertainty

- Resolve GPL-3.0-or-later compliance and combined-bundle scope for the
  browser-delivered eSpeak/phonemizer Worker.
- Resolve the NeuroBERT ONNX conversion's missing explicit license/provenance
  statement.
- Produce complete third-party notices for the exact later distribution.

### Security/dependency blockers

- Update Next from vulnerable 16.3.0 to at least 16.3.3 (audit currently
  selects 16.3.5), align `eslint-config-next`, and rerun full regression before
  deployment.
- Track a supported Transformers release with patched Node-only transitive
  dependencies and prevent server-side import in the meantime.

### Deployment blockers

- A real Vercel Preview upload/CDN/header trace remains unperformed because
  Phase 0 deployment is prohibited. The local size/build/header evidence shows
  feasibility, not actual target acceptance.
- Production integration remains prohibited until the legal blocker and the
  critical Next advisory are resolved.

## Phase 0 conclusion

**BLOCKED** - available normal-device technical work is complete, but the
unresolved eSpeak/GPL distribution path and NeuroBERT conversion provenance
prevent formal Phase 0 acceptance. Low-end physical-device validation, owner
speech-quality approval, learner fallback, and the Ning-Privacy-Classifier
decision remain explicit owner gates. No requirement was weakened and no
missing result was fabricated.
