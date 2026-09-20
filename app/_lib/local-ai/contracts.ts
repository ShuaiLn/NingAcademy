export type LocalModelKind = "ocr" | "ner" | "tts";

export type LifecyclePhase =
  | "idle"
  | "checking"
  | "downloading"
  | "initializing"
  | "ready"
  | "running"
  | "disposing"
  | "failed";

export type LocalAiErrorCode =
  | "unsupported"
  | "policy-blocked"
  | "quota-unknown"
  | "quota-insufficient"
  | "asset-unregistered"
  | "asset-download-failed"
  | "asset-corrupt"
  | "worker-crashed"
  | "cancelled"
  | "initialization-failed"
  | "inference-failed"
  | "dispose-failed";

export interface LocalAiFailure {
  code: LocalAiErrorCode;
  message: string;
  retryable: boolean;
}

export interface ProgressSnapshot {
  kind: LocalModelKind | null;
  phase: LifecyclePhase;
  generation: number;
  loadedBytes?: number;
  totalBytes?: number;
  message?: string;
  failure?: LocalAiFailure;
}

export type ModelProgressUpdate = Pick<
  ProgressSnapshot,
  "phase" | "loadedBytes" | "totalBytes" | "message"
>;

export interface AssetDescriptor {
  id: string;
  kind: LocalModelKind;
  version: string;
  url: string;
  bytes: number;
  sha256: string;
  source: string;
  license: string;
  cacheSchemaVersion: number;
}

export interface CacheInventoryEntry {
  assetId: string;
  kind: LocalModelKind;
  version: string;
  bytes: number;
  cachedAt: string;
}

export interface DeviceCapabilitySnapshot {
  worker: boolean;
  cacheStorage: boolean;
  indexedDb: boolean;
  storageEstimate: boolean;
  webGpu: boolean | "unknown";
  deviceMemoryGiB: number | "unknown";
  hardwareConcurrency: number | "unknown";
}

export type WorkloadAvailability = "enabled" | "degraded" | "unavailable";

export interface WorkloadDecision {
  kind: LocalModelKind;
  availability: WorkloadAvailability;
  code: string;
  reason: string;
  autoDownload: boolean;
}

export interface DiagnosticRunResult {
  kind: LocalModelKind;
  initializedMs: number;
  inferenceMs: number;
  details: Record<string, unknown>;
}

export interface ManagedModel {
  readonly kind: LocalModelKind;
  initialize(signal: AbortSignal, reportProgress?: (update: ModelProgressUpdate) => void): Promise<void>;
  runDiagnostic(signal: AbortSignal): Promise<DiagnosticRunResult>;
  cancel(): void | Promise<void>;
  dispose(): Promise<void>;
}

export type ManagedModelFactory = () => ManagedModel;
