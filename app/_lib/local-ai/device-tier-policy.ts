import type {
  DeviceCapabilitySnapshot,
  LocalModelKind,
  WorkloadDecision,
} from "./contracts";

export const DEVICE_POLICY_VERSION = "phase0-probe-first-2026-09-12";

export function decideWorkload(
  kind: LocalModelKind,
  capabilities: DeviceCapabilitySnapshot,
): WorkloadDecision {
  if (!capabilities.worker) {
    return decision(kind, "unavailable", "worker-unavailable", "此浏览器不支持后台模型 Worker。", false);
  }
  if (kind === "tts" && capabilities.webGpu === "unknown") {
    return decision(kind, "unavailable", "webgpu-unverified", "WebGPU availability could not be verified.", false);
  }
  if (kind === "tts" && !capabilities.webGpu) {
    return decision(kind, "unavailable", "webgpu-unavailable", "本地语音需要 WebGPU。", false);
  }

  const persistenceUnknown =
    !capabilities.cacheStorage || !capabilities.indexedDb || !capabilities.storageEstimate;
  if (persistenceUnknown) {
    return decision(
      kind,
      "degraded",
      "persistent-storage-unavailable",
      "无法验证本地模型缓存或可用空间；不会自动下载。",
      false,
    );
  }

  return decision(
    kind,
    "enabled",
    "explicit-load-only",
    "可进行用户主动触发的本地诊断；尚未设置未经实测的硬件阈值。",
    false,
  );
}

export function decideAllWorkloads(capabilities: DeviceCapabilitySnapshot) {
  return (["ocr", "ner", "tts"] as const).map((kind) => decideWorkload(kind, capabilities));
}

function decision(
  kind: LocalModelKind,
  availability: WorkloadDecision["availability"],
  code: string,
  reason: string,
  autoDownload: boolean,
): WorkloadDecision {
  return { kind, availability, code, reason, autoDownload };
}
