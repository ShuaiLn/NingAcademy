import type { DeviceCapabilitySnapshot } from "./contracts";

export interface NavigatorFacade {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  gpu?: {
    requestAdapter?: (options?: { powerPreference?: "low-power" | "high-performance" }) => Promise<unknown>;
  } | null;
  storage?: { estimate?: () => Promise<unknown> };
}

export async function probeWebGpuAvailability(
  facade: BrowserCapabilityFacade = globalThis as BrowserCapabilityFacade,
): Promise<boolean | "unknown"> {
  const gpu = facade.navigator?.gpu;
  if (gpu === undefined) return "unknown";
  if (!gpu || typeof gpu.requestAdapter !== "function") return false;

  try {
    return Boolean(await gpu.requestAdapter({ powerPreference: "low-power" }));
  } catch {
    return false;
  }
}

export interface BrowserCapabilityFacade {
  navigator?: NavigatorFacade;
  Worker?: unknown;
  caches?: unknown;
  indexedDB?: unknown;
}

function positiveFinite(value: unknown): number | "unknown" {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : "unknown";
}

export function collectDeviceCapabilities(
  facade: BrowserCapabilityFacade = globalThis as BrowserCapabilityFacade,
): DeviceCapabilitySnapshot {
  const navigatorFacade = facade.navigator;
  return {
    worker: typeof facade.Worker === "function",
    cacheStorage: Boolean(facade.caches),
    indexedDb: Boolean(facade.indexedDB),
    storageEstimate: typeof navigatorFacade?.storage?.estimate === "function",
    webGpu: navigatorFacade?.gpu === undefined ? "unknown" : Boolean(navigatorFacade.gpu),
    deviceMemoryGiB: positiveFinite(navigatorFacade?.deviceMemory),
    hardwareConcurrency: positiveFinite(navigatorFacade?.hardwareConcurrency),
  };
}
