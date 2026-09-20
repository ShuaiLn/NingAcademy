# Phase 0 security and target-deployment review

Date: 2026-09-13. Scope: retained Phase 0 browser architecture only. No Vercel
or Supabase deployment was performed.

## Dependency audit

### Phase 2 transitive resolution (2026-09-19)

The Phase 2 security review retained `@huggingface/transformers@4.2.0`, the
pinned ONNX Runtime Web build, NeuroBERT model, tokenizer, and asset hashes.
Exact npm overrides move the unused Node-only dependency path to
`adm-zip@0.6.1` and `sharp@0.35.4`. The former remains compatible with the
constructor, `getEntry`, and `extractEntryTo` calls used by the ONNX Runtime
Node Linux install script. The latter loads with Transformers 4.2.0 and passes
a native transform, although the Phase 2 browser architecture never imports
that Node image path.

`npm audit --omit=dev --audit-level=high` now reports zero vulnerabilities.
The production build contains ONNX Runtime Web and contains no
`onnxruntime-node`, `adm-zip`, nested Transformers sharp, or libvips marker in
application chunks. The repository checks the exact lockfile versions, sole
NER-Worker import boundary, Transformers browser export, and emitted bundle.
This supersedes the unresolved dependency finding below; it does not resolve
the separate owner/legal model-distribution gates.

`npm audit --omit=dev --json` reported 5 production findings: 1 critical and
4 high (`info=0`, `low=0`, `moderate=0`, `high=4`, `critical=1`). The installed
and registry versions were re-read rather than inferred from an older report.

### Next.js

- Installed direct dependency: `next@16.3.0`.
- `GHSA-p293-qw3h-jr36` / CVE-2026-75604 affects Next `>=16.0.0 <16.3.3`.
  It concerns unauthenticated RCE for affected Pages/App Router deployments on
  Windows filesystems without Cache Components. This app uses the App Router,
  has generated Pages 404/500 entries, does not enable Cache Components, and is
  developed on Windows. The target Vercel runtime is not Windows, but the local
  configuration is not a defensible reason to leave the direct dependency
  vulnerable.
- `GHSA-2xp9-vwfh-vxw4` affects the same Next range and concerns AVIF image
  optimization RCE. This app does not configure AVIF output and its current
  `next/image` uses are local `logo.png`, which reduces current reachability;
  it does not change the affected package version.
- Both advisories list `16.3.3` as the first patched 16.x release. npm's exact
  current remediation is `next@16.3.5`, also the current registry release.
- Decision: no Phase 0 upgrade was made because a framework-wide Next.js and
  matching `eslint-config-next` update is unrelated to proving the retained
  local-model architecture and the normative Phase 0 plan forbids deployment.
  A separately reviewed update to at least `16.3.3`—prefer the audit-selected
  `16.3.5`—and a complete application test/build pass is mandatory before any
  later deployment.

### Historical Phase 0 Transformers finding

- At the Phase 0 capture, the installed direct dependency was
  `@huggingface/transformers@4.2.0`. Its Node-only dependencies were
  `onnxruntime-node@1.24.3` and `sharp@0.34.5`.
- `onnxruntime-node@1.24.3` installs `adm-zip@0.5.18`. npm reports the chain as
  high severity. `GHSA-xcpc-8h2w-3j85` affects `adm-zip <0.6.0` and has a
  `0.6.0` patch; `GHSA-vwc7-r8mq-g2x9` affects `0.5.9` through `0.6.0` and has
  no patch in that range. Current `adm-zip@0.6.1` is outside both published
  ranges. Current `onnxruntime-node@1.29.0` allows `adm-zip ^0.6.0`, but the
  current Transformers release pins `onnxruntime-node@1.24.3`, so npm offers no
  supported tree fix for Transformers 4.2.0.
- `sharp@0.34.5` is affected by `GHSA-f88m-g3jw-g9cj` (`<0.35.0`) and
  `GHSA-rgj7-g3m4-5g8c` (`<0.35.4`). Current `sharp@0.35.4` is patched, but the
  Transformers dependency range `^0.34.5` cannot accept it.
- Next's separate `sharp@0.35.3` is outside the first advisory but below the
  second advisory's `0.35.4` patch.
- Actual Phase 0 import topology is browser-only: the sole Transformers import
  is the NER module Worker, configured for `device: "wasm"`; package conditional
  exports select `dist/transformers.web.js`. The successful production output
  contains no `onnxruntime-node`, `adm-zip`, native-sharp module, or
  `@img/sharp` marker, and none of 46 server trace manifests includes `sharp`.
  The client bundle's `toSharp` method names are browser-library code, not the
  native Node package.
- Phase 0 reachability conclusion: the reported Transformers transitive
  vulnerabilities were not in the exercised browser inference/runtime bundle.
  They remained install-time/supply-chain and accidental-server-import risks.
  The later Phase 2 resolution above completed the required dedicated
  compatibility, regression, and security review without changing the browser
  model/runtime baseline.

## Vercel/static deployment feasibility

- Local Next.js 16.3 Turbopack production build: pass. All model Workers and
  WASM/static assets emitted and executed under `next start`.
- Local source payload approximation (excluding `.git`, `.next`, and
  `node_modules`): 336 files, 87,620,148 bytes (83.561 MiB). Local AI public
  assets account for 13 files, 76,403,258 bytes (72.864 MiB). Largest individual
  file: 24,369,971 bytes.
- Vercel's current documented CLI source upload limit is 100 MB on Hobby and
  1 GB on Pro, with 15,000 source files. The measured tree is below both plan
  size limits and far below the file-count limit. The model files are static
  `public/` assets referenced by URL strings and do not appear in server trace
  bundles, so the 250 MB standard Function bundle limit is not consumed by the
  model payload.
- The checked immutable version paths return `Cache-Control: public,
  max-age=31536000, immutable` and `Accept-Ranges: bytes`. Observed MIME types:
  `.wasm` `application/wasm`; `.mjs`/`.js` JavaScript; `.json`
  `application/json`; `.gz` `application/gzip`; `.onnx`/`.npz`
  `application/octet-stream`. Every tested response returned its exact
  catalogued `Content-Length`.
- All Worker/model/WASM URLs are same-origin. No CORS relaxation, COOP, COEP, or
  cross-origin isolation was required. WebGPU requires a secure context;
  localhost satisfies development and Vercel supplies HTTPS for deployment.
- The inference target is Microsoft Edge/other WebGPU browsers, not Vercel's
  server-side Edge Runtime. Static CDN serving is the only Vercel execution
  responsibility for these files; no model inference runs in a Function.
- No Vercel CLI/project link is installed in this checkout. The plan prohibits
  deployment, so a Preview deployment was not created. This leaves real Vercel
  upload/CDN header verification as a later deployment gate, not an observed
  architecture failure.

## Primary evidence links

- Next Windows RCE: <https://github.com/advisories/GHSA-p293-qw3h-jr36>
- Next AVIF RCE: <https://github.com/advisories/GHSA-2xp9-vwfh-vxw4>
- adm-zip memory allocation: <https://github.com/advisories/GHSA-xcpc-8h2w-3j85>
- adm-zip symlink overwrite: <https://github.com/advisories/GHSA-vwc7-r8mq-g2x9>
- sharp/libvips: <https://github.com/advisories/GHSA-f88m-g3jw-g9cj>
- sharp/libheif: <https://github.com/advisories/GHSA-rgj7-g3m4-5g8c>
- Vercel limits: <https://vercel.com/docs/limits>
- Vercel static caching: <https://vercel.com/docs/caching/cdn-cache>
- Vercel Function limits: <https://vercel.com/docs/functions/limitations>
