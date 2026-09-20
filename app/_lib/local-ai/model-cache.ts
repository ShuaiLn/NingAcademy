import { assetsFor, findAsset, LOCAL_AI_ASSETS } from "./asset-catalog";
import type { CacheInventoryEntry, LocalModelKind } from "./contracts";

export const LOCAL_AI_CACHE_NAME = "ning-local-ai-assets-v1";
const DATABASE_NAME = "ning-local-ai-metadata-v1";
const STORE_NAME = "assets";

export type QuotaResult =
  | { status: "sufficient"; remainingBytes: number; requiredBytes: number }
  | { status: "insufficient"; remainingBytes: number; requiredBytes: number }
  | { status: "unknown"; requiredBytes: number };

export interface AssetMetadataStore {
  list(): Promise<CacheInventoryEntry[]>;
  put(entry: CacheInventoryEntry): Promise<void>;
  delete(assetId: string): Promise<void>;
}

export interface ModelCacheDependencies {
  cacheStorage: Pick<CacheStorage, "open">;
  metadata: AssetMetadataStore;
  fetcher: typeof fetch;
  estimate: () => Promise<{ quota?: number; usage?: number }>;
  unload?: (kind: LocalModelKind) => Promise<void>;
}

export interface ClearResult {
  cleared: string[];
  failed: { assetId: string; message: string }[];
}

interface EnsureOptions {
  signal?: AbortSignal;
  artificialRemainingBytes?: number;
  onProgress?: (loadedBytes: number, totalBytes: number, assetId: string) => void;
}

export function classifyRemainingQuota(requiredBytes: number, remainingBytes: number): QuotaResult {
  return remainingBytes >= requiredBytes
    ? { status: "sufficient", remainingBytes, requiredBytes }
    : { status: "insufficient", remainingBytes, requiredBytes };
}

export class ModelAssetCache {
  constructor(private readonly dependencies: ModelCacheDependencies) {}

  async quotaFor(requiredBytes: number): Promise<QuotaResult> {
    try {
      const estimate = await this.dependencies.estimate();
      if (!Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) {
        return { status: "unknown", requiredBytes };
      }
      const remainingBytes = Math.max(0, estimate.quota! - estimate.usage!);
      return classifyRemainingQuota(requiredBytes, remainingBytes);
    } catch {
      return { status: "unknown", requiredBytes };
    }
  }

  async quotaForModel(kind: LocalModelKind, artificialRemainingBytes?: number): Promise<QuotaResult> {
    const requiredBytes = assetsFor(kind).reduce((total, assetEntry) => total + assetEntry.bytes, 0);
    return artificialRemainingBytes === undefined
      ? this.quotaFor(requiredBytes)
      : classifyRemainingQuota(requiredBytes, artificialRemainingBytes);
  }

  async ensureModel(kind: LocalModelKind, options: EnsureOptions = {}) {
    const descriptors = assetsFor(kind);
    const cache = await this.dependencies.cacheStorage.open(LOCAL_AI_CACHE_NAME);
    const missing: typeof descriptors = [];
    let completedBytes = 0;
    for (const descriptor of descriptors) {
      if (await cache.match(descriptor.url)) {
        await this.ensureMetadata(descriptor.id, descriptor.kind, descriptor.version, descriptor.bytes);
        completedBytes += descriptor.bytes;
      } else {
        await this.dependencies.metadata.delete(descriptor.id);
        missing.push(descriptor);
      }
    }
    const totalBytes = descriptors.reduce((total, descriptor) => total + descriptor.bytes, 0);
    options.onProgress?.(completedBytes, totalBytes, missing[0]?.id ?? descriptors.at(-1)?.id ?? kind);
    const requiredBytes = missing.reduce((total, descriptor) => total + descriptor.bytes, 0);
    if (requiredBytes > 0) {
      const quota = options.artificialRemainingBytes === undefined
        ? await this.quotaFor(requiredBytes)
        : classifyRemainingQuota(requiredBytes, options.artificialRemainingBytes);
      if (quota.status !== "sufficient") throw new Error(`Model quota ${quota.status}: ${kind}`);
    }
    for (const descriptor of missing) {
      const baseBytes = completedBytes;
      await this.downloadRegisteredAsset(descriptor.id, options.signal, (assetBytes) => {
        options.onProgress?.(baseBytes + assetBytes, totalBytes, descriptor.id);
      });
      completedBytes += descriptor.bytes;
    }
  }

  async ensureAsset(
    assetId: string,
    options: EnsureOptions = {},
  ): Promise<Response> {
    const descriptor = findAsset(assetId);
    if (!descriptor) throw new Error(`Unregistered local AI asset: ${assetId}`);
    const cache = await this.dependencies.cacheStorage.open(LOCAL_AI_CACHE_NAME);
    const cached = await cache.match(descriptor.url);
    if (cached) {
      await this.ensureMetadata(descriptor.id, descriptor.kind, descriptor.version, descriptor.bytes);
      return cached;
    }

    await this.dependencies.metadata.delete(descriptor.id);
    const quota = options.artificialRemainingBytes === undefined
      ? await this.quotaFor(descriptor.bytes)
      : classifyRemainingQuota(descriptor.bytes, options.artificialRemainingBytes);
    if (quota.status !== "sufficient") throw new Error(`Asset quota ${quota.status}: ${assetId}`);

    return this.downloadRegisteredAsset(assetId, options.signal, (loadedBytes) => {
      options.onProgress?.(loadedBytes, descriptor.bytes, descriptor.id);
    });
  }

  private async downloadRegisteredAsset(
    assetId: string,
    signal?: AbortSignal,
    onProgress?: (loadedBytes: number) => void,
  ): Promise<Response> {
    const descriptor = findAsset(assetId);
    if (!descriptor) throw new Error(`Unregistered local AI asset: ${assetId}`);
    const cache = await this.dependencies.cacheStorage.open(LOCAL_AI_CACHE_NAME);
    const response = await this.dependencies.fetcher(descriptor.url, { signal });
    if (!response.ok) throw new Error(`Asset download failed (${response.status}): ${assetId}`);
    if (!response.body) throw new Error(`Asset response has no body: ${assetId}`);
    const [cacheBody, inspectionBody] = response.body.tee();
    const cachedResponse = new Response(cacheBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    try {
      const [inspection, cacheWrite] = await Promise.allSettled([
        countStreamBytes(inspectionBody, signal, onProgress),
        cache.put(descriptor.url, cachedResponse),
      ]);
      if (inspection.status === "rejected") throw inspection.reason;
      if (cacheWrite.status === "rejected") throw cacheWrite.reason;
      const loadedBytes = inspection.value;
      if (loadedBytes !== descriptor.bytes) {
        throw new Error(`Asset integrity mismatch: ${assetId}`);
      }
    } catch (error) {
      await cache.delete(descriptor.url).catch(() => false);
      await this.dependencies.metadata.delete(descriptor.id).catch(() => undefined);
      throw error;
    }
    await this.ensureMetadata(descriptor.id, descriptor.kind, descriptor.version, descriptor.bytes);
    const stored = await cache.match(descriptor.url);
    if (!stored) throw new Error(`Asset cache verification failed: ${assetId}`);
    return stored;
  }

  async inventory(): Promise<CacheInventoryEntry[]> {
    const cache = await this.dependencies.cacheStorage.open(LOCAL_AI_CACHE_NAME);
    for (const request of await cache.keys()) {
      const pathname = new URL(request.url).pathname;
      if (!LOCAL_AI_ASSETS.some((descriptor) => descriptor.url === pathname)) {
        await cache.delete(request);
      }
    }
    const metadata = await this.dependencies.metadata.list();
    const reconciled: CacheInventoryEntry[] = [];
    for (const entry of metadata) {
      const descriptor = findAsset(entry.assetId);
      if (!descriptor || descriptor.version !== entry.version || !(await cache.match(descriptor.url))) {
        await this.dependencies.metadata.delete(entry.assetId);
      } else {
        reconciled.push(entry);
      }
    }
    return reconciled;
  }

  async invalidate(assetId: string): Promise<void> {
    const descriptor = findAsset(assetId);
    if (!descriptor) throw new Error(`Unregistered local AI asset: ${assetId}`);
    const cache = await this.dependencies.cacheStorage.open(LOCAL_AI_CACHE_NAME);
    await cache.delete(descriptor.url);
    await this.dependencies.metadata.delete(assetId);
  }

  async clearModel(kind: LocalModelKind): Promise<ClearResult> {
    await this.dependencies.unload?.(kind);
    return this.clear(assetsFor(kind).map((assetEntry) => assetEntry.id));
  }

  async clearAll(): Promise<ClearResult> {
    for (const kind of ["ocr", "ner", "tts"] as const) await this.dependencies.unload?.(kind);
    await this.inventory();
    return this.clear(LOCAL_AI_ASSETS.map((assetEntry) => assetEntry.id));
  }

  private async clear(assetIds: string[]): Promise<ClearResult> {
    const cleared: string[] = [];
    const failed: ClearResult["failed"] = [];
    for (const assetId of assetIds) {
      try {
        await this.invalidate(assetId);
        cleared.push(assetId);
      } catch (error) {
        failed.push({ assetId, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { cleared, failed };
  }

  private async ensureMetadata(assetId: string, kind: LocalModelKind, version: string, bytes: number) {
    await this.dependencies.metadata.put({
      assetId,
      kind,
      version,
      bytes,
      cachedAt: new Date().toISOString(),
    });
  }
}

async function countStreamBytes(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  onProgress?: (loadedBytes: number) => void,
) {
  const reader = stream.getReader();
  let loadedBytes = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const { done, value } = await reader.read();
      if (done) return loadedBytes;
      loadedBytes += value.byteLength;
      onProgress?.(loadedBytes);
    }
  } finally {
    reader.releaseLock();
  }
}

export function createBrowserModelCache(unload?: (kind: LocalModelKind) => Promise<void>) {
  return new ModelAssetCache({
    cacheStorage: caches,
    metadata: new IndexedDbMetadataStore(),
    fetcher: globalThis.fetch.bind(globalThis),
    estimate: () => navigator.storage.estimate(),
    unload,
  });
}

class IndexedDbMetadataStore implements AssetMetadataStore {
  async list(): Promise<CacheInventoryEntry[]> {
    return this.request("readonly", (store) => store.getAll());
  }

  async put(entry: CacheInventoryEntry): Promise<void> {
    await this.request("readwrite", (store) => store.put(entry));
  }

  async delete(assetId: string): Promise<void> {
    await this.request("readwrite", (store) => store.delete(assetId));
  }

  private async request<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await openDatabase();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "assetId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
