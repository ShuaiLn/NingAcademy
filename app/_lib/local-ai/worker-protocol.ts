import type { DiagnosticRunResult, LocalAiFailure, LocalModelKind } from "./contracts";
import type { NerLineInput, NerLineEvidence } from "./models/ner-lines";

interface Envelope {
  generation: number;
  requestId: string;
}

export type HostToWorkerMessage = Envelope &
  (
    | { type: "initialize"; kind: LocalModelKind }
    | { type: "diagnostic" }
    | { type: "analyze-lines"; lines: readonly NerLineInput[] }
    | { type: "cancel" }
    | { type: "dispose" }
  );

export type WorkerToHostMessage = Envelope &
  (
    | { type: "progress"; loadedBytes?: number; totalBytes?: number; message: string }
    | { type: "ready" }
    | { type: "result"; result: DiagnosticRunResult }
    | { type: "ner-lines"; lines: readonly NerLineEvidence[] }
    | { type: "cancelled" }
    | { type: "disposed" }
    | { type: "failure"; failure: LocalAiFailure }
  );

type WithoutEnvelope<T> = T extends unknown ? Omit<T, "generation" | "requestId"> : never;
export type WorkerResponsePayload = WithoutEnvelope<WorkerToHostMessage>;
