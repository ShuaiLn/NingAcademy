import { assetsFor } from "../../../app/_lib/local-ai/asset-catalog";
import { createBrowserModelCache, LOCAL_AI_CACHE_NAME } from "../../../app/_lib/local-ai/model-cache";

// The Phase 0 cache checks byte counts. The study additionally verifies cached
// bytes before any runtime executes them; this does not approve distribution.
export async function ensureVerifiedStudyAssets(kind: "ocr" | "ner", signal: AbortSignal) {
  await createBrowserModelCache().ensureModel(kind, { signal });
  const cache = await caches.open(LOCAL_AI_CACHE_NAME);
  for (const asset of assetsFor(kind)) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const response = await cache.match(asset.url);
    if (!response) throw new Error("Missing study asset");
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== asset.sha256 || bytes.byteLength !== asset.bytes) {
      await cache.delete(asset.url);
      throw new Error("Invalid study asset");
    }
  }
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}
