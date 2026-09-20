import { describe, expect, it, vi } from "vitest";
import { assetsFor, LOCAL_AI_ASSETS } from "./asset-catalog";
import type { CacheInventoryEntry } from "./contracts";
import { ModelAssetCache, type AssetMetadataStore } from "./model-cache";

class Metadata implements AssetMetadataStore {
  entries = new Map<string, CacheInventoryEntry>();
  async list() { return [...this.entries.values()]; }
  async put(entry: CacheInventoryEntry) { this.entries.set(entry.assetId, entry); }
  async delete(assetId: string) { this.entries.delete(assetId); }
}

function setup(options: {
  quota?: number;
  usage?: number;
  failPut?: boolean;
  assetBytes?: number;
  unload?: (kind: "ocr" | "ner" | "tts") => Promise<void>;
} = {}) {
  const responses = new Map<string, Response>();
  const metadata = new Metadata();
  const cache = {
    match: vi.fn(async (url: string) => responses.get(url)),
    put: vi.fn(async (url: string, response: Response) => {
      if (options.failPut) throw new Error("interrupted write");
      responses.set(url, response);
    }),
    delete: vi.fn(async (url: string | Request) => responses.delete(
      typeof url === "string" ? url : new URL(url.url).pathname,
    )),
    keys: vi.fn(async () => [...responses.keys()].map((url) => new Request(`https://local.invalid${url}`))),
  };
  const descriptor = LOCAL_AI_ASSETS[0];
  const fetcher = vi.fn(async () => new Response(new Uint8Array(options.assetBytes ?? descriptor.bytes), {
    status: 200,
  }));
  const cacheStorage = { open: vi.fn(async () => cache) } as unknown as CacheStorage;
  const modelCache = new ModelAssetCache({
    cacheStorage,
    metadata,
    fetcher,
    estimate: vi.fn(async () => ({ quota: options.quota ?? descriptor.bytes * 2, usage: options.usage ?? 0 })),
    unload: options.unload,
  });
  return { cache, cacheStorage, descriptor, fetcher, metadata, modelCache, responses };
}

describe("ModelAssetCache", () => {
  it("downloads a registered cold asset once and then returns the cache hit", async () => {
    const context = setup();
    await context.modelCache.ensureAsset(context.descriptor.id);
    await context.modelCache.ensureAsset(context.descriptor.id);
    expect(context.fetcher).toHaveBeenCalledTimes(1);
    expect((await context.modelCache.inventory())[0].assetId).toBe(context.descriptor.id);
  });

  it("rejects arbitrary URLs and IDs", async () => {
    await expect(setup().modelCache.ensureAsset("https://unapproved.example/model")).rejects.toThrow("Unregistered");
  });

  it("distinguishes sufficient, insufficient, and unknown quota", async () => {
    const required = 100;
    await expect(setup({ quota: 200, usage: 50 }).modelCache.quotaFor(required)).resolves.toMatchObject({ status: "sufficient" });
    await expect(setup({ quota: 100, usage: 50 }).modelCache.quotaFor(required)).resolves.toMatchObject({ status: "insufficient" });
    const context = setup();
    const unknown = new ModelAssetCache({
      cacheStorage: context.cacheStorage,
      metadata: context.metadata,
      fetcher: context.fetcher,
      estimate: async () => ({}),
    });
    await expect(unknown.quotaFor(required)).resolves.toEqual({ status: "unknown", requiredBytes: required });
  });

  it("does not commit ready metadata after an interrupted cache write", async () => {
    const context = setup({ failPut: true });
    await expect(context.modelCache.ensureAsset(context.descriptor.id)).rejects.toThrow("interrupted write");
    expect(await context.metadata.list()).toEqual([]);
  });

  it("reconciles stale metadata after browser eviction", async () => {
    const context = setup();
    await context.metadata.put({ assetId: context.descriptor.id, kind: context.descriptor.kind, version: context.descriptor.version, bytes: context.descriptor.bytes, cachedAt: new Date().toISOString() });
    expect(await context.modelCache.inventory()).toEqual([]);
    expect(await context.metadata.list()).toEqual([]);
  });

  it("reports an artificial quota cap before fetching", async () => {
    const context = setup();
    await expect(context.modelCache.ensureAsset(context.descriptor.id, { artificialRemainingBytes: 1 })).rejects.toThrow("insufficient");
    expect(context.fetcher).not.toHaveBeenCalled();
  });

  it("rejects and removes a partial decoded response before metadata commit", async () => {
    const context = setup({ assetBytes: 3 });
    await expect(context.modelCache.ensureAsset(context.descriptor.id)).rejects.toThrow("integrity mismatch");
    expect(context.cache.delete).toHaveBeenCalledWith(context.descriptor.url);
    expect(await context.metadata.list()).toEqual([]);
  });

  it("invalidates an individual catalogued asset", async () => {
    const context = setup();
    await context.modelCache.ensureAsset(context.descriptor.id);
    await context.modelCache.invalidate(context.descriptor.id);
    expect(context.cache.delete).toHaveBeenCalledWith(context.descriptor.url);
    expect(await context.metadata.list()).toEqual([]);
  });

  it("unloads before model clearing and reports a partial deletion failure", async () => {
    const events: string[] = [];
    const context = setup({ unload: async (kind) => { events.push(`unload:${kind}`); } });
    context.cache.delete.mockImplementationOnce(async () => {
      events.push("delete");
      throw new Error("forced deletion failure");
    });
    const result = await context.modelCache.clearModel("ocr");
    expect(events.slice(0, 2)).toEqual(["unload:ocr", "delete"]);
    expect(result.failed).toHaveLength(1);
    expect(result.cleared.length + result.failed.length).toBe(assetsFor("ocr").length);
  });

  it("removes an orphaned old-version response from the dedicated cache", async () => {
    const context = setup();
    const oldUrl = "/local-ai-assets/ocr/old-version/model.bin";
    context.responses.set(oldUrl, new Response("old"));
    await context.modelCache.inventory();
    expect(context.responses.has(oldUrl)).toBe(false);
  });
});
