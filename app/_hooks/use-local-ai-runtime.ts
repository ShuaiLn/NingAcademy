"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  collectDeviceCapabilities,
  probeWebGpuAvailability,
} from "@/app/_lib/local-ai/device-capabilities";
import { decideAllWorkloads, decideWorkload } from "@/app/_lib/local-ai/device-tier-policy";
import type {
  CacheInventoryEntry,
  DeviceCapabilitySnapshot,
  DiagnosticRunResult,
  LocalModelKind,
  ProgressSnapshot,
} from "@/app/_lib/local-ai/contracts";

const idleSnapshot: ProgressSnapshot = { kind: null, phase: "idle", generation: 0 };
let currentSnapshot = idleSnapshot;
let lifecyclePromise: ReturnType<typeof importLifecycle> | null = null;
let unsubscribeLifecycle: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentSnapshot;
}

async function importLifecycle() {
  const { getBrowserLifecycle } = await import("@/app/_lib/local-ai/model-lifecycle");
  const lifecycle = await getBrowserLifecycle();
  unsubscribeLifecycle ??= lifecycle.subscribe(() => {
    currentSnapshot = lifecycle.getSnapshot();
    emit();
  });
  return lifecycle;
}

function lifecycle() {
  lifecyclePromise ??= importLifecycle();
  return lifecyclePromise;
}

export function useLocalAiRuntime() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => idleSnapshot);
  const [capabilities, setCapabilities] = useState<DeviceCapabilitySnapshot | null>(null);
  const [inventory, setInventory] = useState<CacheInventoryEntry[]>([]);
  const [lastResult, setLastResult] = useState<DiagnosticRunResult | null>(null);

  const refreshInventory = useCallback(async () => {
    const { createBrowserModelCache } = await import("@/app/_lib/local-ai/model-cache");
    setInventory(await createBrowserModelCache().inventory());
  }, []);

  useEffect(() => {
    let disposed = false;
    const initial = collectDeviceCapabilities();
    setCapabilities(initial);
    void probeWebGpuAvailability().then((webGpu) => {
      if (!disposed) setCapabilities({ ...initial, webGpu });
    });
    void refreshInventory();
    return () => { disposed = true; };
  }, [refreshInventory]);

  const runDiagnostic = useCallback(async (kind: LocalModelKind) => {
    if (!capabilities) throw new Error("Browser capabilities are still being checked");
    const currentCapabilities = kind === "tts"
      ? { ...capabilities, webGpu: await probeWebGpuAvailability() }
      : capabilities;
    if (currentCapabilities !== capabilities) setCapabilities(currentCapabilities);
    const workload = decideWorkload(kind, currentCapabilities);
    if (workload.availability === "unavailable") {
      if (lifecyclePromise) await (await lifecyclePromise).release();
      throw new Error(workload.reason);
    }
    const result = await (await lifecycle()).runDiagnostic(kind);
    setLastResult(result);
    await refreshInventory();
    return result;
  }, [capabilities, refreshInventory]);

  const release = useCallback(async () => {
    await (await lifecycle()).release();
  }, []);

  const cancel = useCallback(async () => {
    (await lifecycle()).cancel();
  }, []);

  const clearModel = useCallback(async (kind: LocalModelKind) => {
    const manager = await lifecycle();
    const { createBrowserModelCache } = await import("@/app/_lib/local-ai/model-cache");
    const result = await createBrowserModelCache(async () => {
      if (manager.getSnapshot().kind === kind) {
        manager.cancel();
        await manager.release();
      }
    }).clearModel(kind);
    await refreshInventory();
    return result;
  }, [refreshInventory]);

  const clearAll = useCallback(async () => {
    const manager = await lifecycle();
    const { createBrowserModelCache } = await import("@/app/_lib/local-ai/model-cache");
    let released = false;
    const result = await createBrowserModelCache(async () => {
      if (!released) {
        manager.cancel();
        await manager.release();
        released = true;
      }
    }).clearAll();
    await refreshInventory();
    return result;
  }, [refreshInventory]);

  const simulateQuotaRejection = useCallback(async (kind: LocalModelKind) => {
    const { createBrowserModelCache } = await import("@/app/_lib/local-ai/model-cache");
    return createBrowserModelCache().quotaForModel(kind, 1);
  }, []);

  return {
    snapshot,
    capabilities,
    decisions: capabilities ? decideAllWorkloads(capabilities) : [],
    inventory,
    lastResult,
    runDiagnostic,
    release,
    cancel,
    clearModel,
    clearAll,
    simulateQuotaRejection,
    refreshInventory,
  };
}
