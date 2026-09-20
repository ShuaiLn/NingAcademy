import type {
  DiagnosticRunResult,
  LocalModelKind,
  ManagedModel,
  ManagedModelFactory,
  ProgressSnapshot,
} from "./contracts";

type Listener = () => void;

export class LocalModelLifecycle {
  private active: ManagedModel | null = null;
  private activeAbort: AbortController | null = null;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<Listener>();
  private snapshot: ProgressSnapshot = { kind: null, phase: "idle", generation: 0 };

  constructor(private readonly factories: Record<LocalModelKind, ManagedModelFactory>) {}

  getSnapshot = () => this.snapshot;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  acquire(kind: LocalModelKind): Promise<void> {
    return this.serialize(async () => {
      if (this.active?.kind === kind && this.snapshot.phase === "ready") return;
      await this.disposeActive();
      const generation = ++this.generation;
      const model = this.factories[kind]();
      const abort = new AbortController();
      this.active = model;
      this.activeAbort = abort;
      this.publish({ kind, phase: "checking", generation, message: "正在检查本地模型资源" });
      try {
        await model.initialize(abort.signal, (update) => {
          if (generation === this.generation && !abort.signal.aborted) {
            this.publish({ kind, generation, ...update });
          }
        });
        if (generation !== this.generation || abort.signal.aborted) return;
        this.publish({ kind, phase: "ready", generation });
      } catch (error) {
        const wasCancelled = abort.signal.aborted;
        await this.dropFailedModel(model);
        this.publish({
          kind,
          phase: "failed",
          generation,
          failure: {
            code: wasCancelled ? "cancelled" : "initialization-failed",
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
        });
        throw error;
      }
    });
  }

  async runDiagnostic(kind: LocalModelKind): Promise<DiagnosticRunResult> {
    await this.acquire(kind);
    return this.serialize(async () => {
      if (!this.active || this.active.kind !== kind || !this.activeAbort) {
        throw new Error(`No ready ${kind} model`);
      }
      const generation = this.generation;
      this.publish({ kind, phase: "running", generation });
      try {
        const result = await this.active.runDiagnostic(this.activeAbort.signal);
        if (generation === this.generation) this.publish({ kind, phase: "ready", generation });
        return result;
      } catch (error) {
        const failed = this.active;
        await this.dropFailedModel(failed);
        this.publish({
          kind,
          phase: "failed",
          generation,
          failure: {
            code: "inference-failed",
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
        });
        throw error;
      }
    });
  }

  release(): Promise<void> {
    return this.serialize(() => this.disposeActive());
  }

  cancel(): void {
    this.activeAbort?.abort();
    void this.active?.cancel();
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async disposeActive() {
    const model = this.active;
    if (!model) {
      this.publish({ kind: null, phase: "idle", generation: this.generation });
      return;
    }
    this.publish({ kind: model.kind, phase: "disposing", generation: this.generation });
    this.activeAbort?.abort();
    this.active = null;
    this.activeAbort = null;
    let disposalError: unknown;
    try {
      await model.cancel();
    } catch (error) {
      disposalError = error;
    }
    try {
      await model.dispose();
    } catch (error) {
      disposalError ??= error;
    }
    if (disposalError) {
      this.publish({
        kind: model.kind,
        phase: "failed",
        generation: this.generation,
        failure: {
          code: "dispose-failed",
          message: disposalError instanceof Error ? disposalError.message : String(disposalError),
          retryable: true,
        },
      });
      throw disposalError;
    }
    this.publish({ kind: null, phase: "idle", generation: this.generation });
  }

  private async dropFailedModel(model: ManagedModel | null) {
    if (!model) return;
    this.activeAbort?.abort();
    this.active = null;
    this.activeAbort = null;
    try {
      await model.dispose();
    } catch {
      // The invariant is no retained hot handle; a terminated module Worker is the final boundary.
    }
  }

  private publish(snapshot: ProgressSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

let browserLifecycle: LocalModelLifecycle | null = null;

export async function getBrowserLifecycle() {
  if (browserLifecycle) return browserLifecycle;
  const [{ OcrRuntime }, { NerRuntime }, { KittenTtsRuntime }] = await Promise.all([
    import("./models/ocr-runtime"),
    import("./models/ner-runtime"),
    import("./models/kitten-tts-runtime"),
  ]);
  browserLifecycle = new LocalModelLifecycle({
    ocr: () => new OcrRuntime(),
    ner: () => new NerRuntime(),
    tts: () => new KittenTtsRuntime(),
  });
  window.addEventListener("pagehide", () => void browserLifecycle?.release(), { once: true });
  return browserLifecycle;
}
