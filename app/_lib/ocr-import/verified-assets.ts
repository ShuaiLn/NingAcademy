import { assetsFor } from "../local-ai/asset-catalog";
import { createBrowserModelCache, LOCAL_AI_CACHE_NAME } from "../local-ai/model-cache";
export async function ensureVerifiedAssets(kind: "ocr" | "ner", signal: AbortSignal) {
  await createBrowserModelCache().ensureModel(kind, { signal });
  const cache = await caches.open(LOCAL_AI_CACHE_NAME);
  for (const asset of assetsFor(kind)) {
    signal.throwIfAborted();
    const response = await cache.match(asset.url);
    if (!response) throw new Error("Local asset missing");
    const bytes = await response.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (digest !== asset.sha256 || bytes.byteLength !== asset.bytes) {
      await cache.delete(asset.url); throw new Error("Local asset invalid");
    }
  }
  signal.throwIfAborted();
}
