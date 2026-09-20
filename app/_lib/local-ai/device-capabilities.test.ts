import { describe, expect, it } from "vitest";
import { collectDeviceCapabilities, probeWebGpuAvailability } from "./device-capabilities";
import { decideWorkload } from "./device-tier-policy";

describe("collectDeviceCapabilities", () => {
  it("normalizes supported signals", () => {
    const snapshot = collectDeviceCapabilities({
      Worker: class {},
      caches: {},
      indexedDB: {},
      navigator: {
        gpu: {},
        deviceMemory: 8,
        hardwareConcurrency: 12,
        storage: { estimate: async () => ({}) },
      },
    });
    expect(snapshot).toEqual({
      worker: true,
      cacheStorage: true,
      indexedDb: true,
      storageEstimate: true,
      webGpu: true,
      deviceMemoryGiB: 8,
      hardwareConcurrency: 12,
    });
  });

  it.each([undefined, 0, -1, Number.NaN])("normalizes invalid hardware value %s", (value) => {
    const snapshot = collectDeviceCapabilities({ navigator: { deviceMemory: value, hardwareConcurrency: value } });
    expect(snapshot.deviceMemoryGiB).toBe("unknown");
    expect(snapshot.hardwareConcurrency).toBe("unknown");
  });

  it("keeps a missing WebGPU signal explicitly unknown", () => {
    expect(collectDeviceCapabilities({ navigator: {} }).webGpu).toBe("unknown");
  });

  it("confirms WebGPU only after an adapter is obtained", async () => {
    await expect(probeWebGpuAvailability({
      navigator: { gpu: { requestAdapter: async () => ({}) } },
    })).resolves.toBe(true);
    await expect(probeWebGpuAvailability({
      navigator: { gpu: { requestAdapter: async () => null } },
    })).resolves.toBe(false);
  });

  it("normalizes an adapter probe failure without throwing", async () => {
    await expect(probeWebGpuAvailability({
      navigator: { gpu: { requestAdapter: async () => { throw new Error("blocked"); } } },
    })).resolves.toBe(false);
    await expect(probeWebGpuAvailability({ navigator: {} })).resolves.toBe("unknown");
  });
});

describe("device policy", () => {
  const capable = {
    worker: true,
    cacheStorage: true,
    indexedDb: true,
    storageEstimate: true,
    webGpu: true as const,
    deviceMemoryGiB: "unknown" as const,
    hardwareConcurrency: "unknown" as const,
  };

  it("does not invent a numeric hardware threshold", () => {
    expect(decideWorkload("ner", capable)).toMatchObject({ availability: "enabled", autoDownload: false });
  });

  it("keeps unavailable NER distinct from an empty successful result", () => {
    expect(decideWorkload("ner", { ...capable, worker: false })).toMatchObject({
      availability: "unavailable",
      code: "worker-unavailable",
    });
  });

  it("requires WebGPU for KittenTTS", () => {
    expect(decideWorkload("tts", { ...capable, webGpu: false })).toMatchObject({
      availability: "unavailable",
      code: "webgpu-unavailable",
    });
  });

  it("keeps an unverified WebGPU signal distinct from confirmed unavailability", () => {
    expect(decideWorkload("tts", { ...capable, webGpu: "unknown" })).toMatchObject({
      availability: "unavailable",
      code: "webgpu-unverified",
    });
  });

  it("uses a conservative degraded state when persistence is unknown", () => {
    expect(decideWorkload("ocr", { ...capable, storageEstimate: false })).toMatchObject({
      availability: "degraded",
      autoDownload: false,
    });
  });
});
