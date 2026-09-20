import type { DiagnosticRunResult, LocalModelKind, ManagedModel, ModelProgressUpdate } from "../contracts";
import type { HostToWorkerMessage, WorkerToHostMessage } from "../worker-protocol";
import type { NerLineInput, NerLineEvidence } from "./ner-lines";

export abstract class WorkerManagedModel implements ManagedModel {
  abstract readonly kind: LocalModelKind;
  protected worker: Worker | null = null;
  private generation = 0;
  private pending = new Set<() => void>();

  protected abstract createWorker(): Worker;

  async initialize(signal: AbortSignal, reportProgress?: (update: ModelProgressUpdate) => void): Promise<void> {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    this.worker = this.createWorker();
    this.generation += 1;
    await this.request("initialize", signal, reportProgress);
  }

  runDiagnostic(signal: AbortSignal): Promise<DiagnosticRunResult> {
    return this.request("diagnostic", signal) as Promise<DiagnosticRunResult>;
  }

  analyzeLines(lines: readonly NerLineInput[], signal: AbortSignal): Promise<readonly NerLineEvidence[]> {
    if (!this.worker) return Promise.reject(new Error("NER unavailable"));
    return this.requestOn(this.worker, "analyze-lines", signal, undefined, lines) as Promise<readonly NerLineEvidence[]>;
  }

  cancel() {
    if (!this.worker) return;
    for (const reject of [...this.pending]) reject();
    this.worker.terminate();
    this.worker = null;
  }

  async dispose() {
    for (const reject of [...this.pending]) reject();
    if (!this.worker) return;
    const worker = this.worker;
    this.worker = null;
    try {
      await this.requestOn(worker, "dispose", AbortSignal.timeout(2_000));
    } catch {
      // terminate() below is the hard disposal boundary.
    } finally {
      worker.terminate();
    }
  }

  private request(
    type: "initialize" | "diagnostic",
    signal: AbortSignal,
    reportProgress?: (update: ModelProgressUpdate) => void,
  ) {
    if (!this.worker) return Promise.reject(new Error(`${this.kind} Worker is not available`));
    return this.requestOn(this.worker, type, signal, reportProgress);
  }

  private requestOn(
    worker: Worker,
    type: "initialize" | "diagnostic" | "dispose" | "analyze-lines",
    signal: AbortSignal,
    reportProgress?: (update: ModelProgressUpdate) => void,
    lines?: readonly NerLineInput[],
  ): Promise<void | DiagnosticRunResult | readonly NerLineEvidence[]> {
    if (signal.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
    const message: HostToWorkerMessage = type === "analyze-lines"
      ? { type, lines: lines ?? [], generation: this.generation, requestId: crypto.randomUUID() } : this.message(type);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error("Local inference timed out")); }, 180_000);
      const cleanup = () => {
        clearTimeout(timeout);
        this.pending.delete(onAbort);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onMessageError);
        signal.removeEventListener("abort", onAbort);
      };
      const onMessage = (event: MessageEvent<WorkerToHostMessage>) => {
        const response = event.data;
        if (response.generation !== message.generation || response.requestId !== message.requestId) return;
        if (response.type === "progress") {
          reportProgress?.({
            phase: "initializing",
            loadedBytes: response.loadedBytes,
            totalBytes: response.totalBytes,
            message: response.message,
          });
          return;
        }
        cleanup();
        if (response.type === "failure") reject(new Error(response.failure.message));
        else if (response.type === "result" && type === "diagnostic") resolve(response.result);
        else if (response.type === "ner-lines" && type === "analyze-lines") resolve(Object.freeze(response.lines.map(line => Object.freeze({
          ...line,
          tokens: Object.freeze(line.tokens.map(token => Object.freeze({ ...token }))),
        }))));
        else if ((response.type === "ready" && type === "initialize") || (response.type === "disposed" && type === "dispose")) resolve();
        else reject(new Error("Unexpected local Worker response"));
      };
      const onError = () => { cleanup(); reject(new Error("Local Worker failed")); };
      const onMessageError = () => { cleanup(); reject(new Error(`${this.kind} Worker message error`)); };
      const onAbort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onMessageError);
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.add(onAbort);
      try { worker.postMessage(message); } catch { cleanup(); reject(new Error("Local Worker failed")); }
    });
  }

  private message(type: "initialize" | "diagnostic" | "cancel" | "dispose"): HostToWorkerMessage {
    const base = { generation: this.generation, requestId: crypto.randomUUID() };
    return type === "initialize"
      ? { ...base, type, kind: this.kind }
      : { ...base, type };
  }
}
