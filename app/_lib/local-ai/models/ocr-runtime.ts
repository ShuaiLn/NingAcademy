import { createWorker, OEM, type Worker as TesseractWorker } from "tesseract.js";
import type { DiagnosticRunResult, ManagedModel, ModelProgressUpdate } from "../contracts";
import { createBrowserModelCache } from "../model-cache";

const ROOT = "/local-ai-assets/ocr/tesseract-7.0.0";
const DEFAULT_OPERATION_TIMEOUT_MS = 180_000;
type OcrInput = Parameters<TesseractWorker["recognize"]>[0];
type WorkerFactory = typeof createWorker;

type OcrRuntimeOptions = {
  createWorker?: WorkerFactory;
  initializationTimeoutMs?: number;
  recognitionTimeoutMs?: number;
};

const abortError = () => new DOMException("Cancelled", "AbortError");
const runtimeError = (value: unknown) => value instanceof Error ? value : new Error("OCR Worker failed");

export class OcrRuntime implements ManagedModel {
  readonly kind = "ocr" as const;
  private worker: TesseractWorker | null = null;
  private pendingWorker: Promise<TesseractWorker> | null = null;
  private lifecycleAbort: AbortController | null = null;
  private rejectWorkerFailure: ((error: Error) => void) | null = null;
  private initializedMs = 0;
  private readonly create: WorkerFactory;
  private readonly initializationTimeoutMs: number;
  private readonly recognitionTimeoutMs: number;

  constructor(options: OcrRuntimeOptions = {}) {
    this.create = options.createWorker ?? createWorker;
    this.initializationTimeoutMs = options.initializationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    this.recognitionTimeoutMs = options.recognitionTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  }

  private async bounded<T>(operation: Promise<T>, signal: AbortSignal, timeoutMs: number, timeoutMessage: string): Promise<T> {
    if (signal.aborted) throw abortError();
    let rejectAbort: (error: DOMException) => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    try {
      return await Promise.race([operation, aborted, timedOut]);
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  async initialize(signal: AbortSignal, reportProgress?: (update: ModelProgressUpdate) => void) {
    if (this.worker || this.pendingWorker || this.lifecycleAbort) throw new Error("OCR Worker lifecycle is already active");
    const startedAt = performance.now();
    const cache = createBrowserModelCache();
    const lifecycle = new AbortController();
    this.lifecycleAbort = lifecycle;
    const onExternalAbort = () => lifecycle.abort();
    signal.addEventListener("abort", onExternalAbort, { once: true });
    if (signal.aborted) lifecycle.abort();
    try {
      await this.bounded(cache.ensureModel(this.kind, {
        signal: lifecycle.signal,
        onProgress: (loadedBytes, totalBytes, assetId) => reportProgress?.({
          phase: "downloading",
          loadedBytes,
          totalBytes,
          message: `正在准备 OCR 资源：${assetId}`,
        }),
      }), lifecycle.signal, this.initializationTimeoutMs, "OCR asset initialization timed out");
      reportProgress?.({ phase: "initializing", message: "正在初始化 OCR Worker" });
      const pending = this.create("eng", OEM.LSTM_ONLY, {
        workerPath: `${ROOT}/worker.min.js`,
        corePath: ROOT,
        langPath: ROOT,
        cacheMethod: "none",
        gzip: true,
        workerBlobURL: false,
        errorHandler: (error) => this.rejectWorkerFailure?.(runtimeError(error)),
        logger: (message) => reportProgress?.({
          phase: "initializing",
          message: `OCR：${message.status}`,
        }),
      });
      this.pendingWorker = pending;
      void pending.then(async worker => {
        if (lifecycle.signal.aborted || this.pendingWorker !== pending) await worker.terminate();
      }).catch(() => undefined);
      const worker = await this.bounded(pending, lifecycle.signal, this.initializationTimeoutMs, "OCR Worker initialization timed out");
      if (lifecycle.signal.aborted || this.pendingWorker !== pending) {
        await worker.terminate();
        throw abortError();
      }
      this.pendingWorker = null;
      this.worker = worker;
      this.initializedMs = performance.now() - startedAt;
    } catch (error) {
      await this.dispose().catch(() => undefined);
      if (!(error instanceof DOMException && error.name === "AbortError")) await cache.clearModel(this.kind);
      throw error;
    } finally {
      signal.removeEventListener("abort", onExternalAbort);
      if (this.lifecycleAbort === lifecycle && !this.worker) this.lifecycleAbort = null;
    }
  }

  private async performRecognition(image: OcrInput, signal: AbortSignal) {
    if (signal.aborted) throw abortError();
    const worker = this.worker;
    const lifecycle = this.lifecycleAbort;
    if (!worker || !lifecycle) throw new Error("OCR Worker is not initialized");
    const onExternalAbort = () => lifecycle.abort();
    signal.addEventListener("abort", onExternalAbort, { once: true });
    if (signal.aborted) lifecycle.abort();
    const crashed = new Promise<never>((_, reject) => {
      this.rejectWorkerFailure = reject;
    });
    try {
      const recognition = worker.recognize(image, {}, { blocks: true });
      const result = await this.bounded(
        Promise.race([recognition, crashed]),
        lifecycle.signal,
        this.recognitionTimeoutMs,
        "OCR recognition timed out",
      );
      if (signal.aborted || lifecycle.signal.aborted) throw abortError();
      return result.data;
    } catch (error) {
      await this.dispose().catch(() => undefined);
      throw error;
    } finally {
      signal.removeEventListener("abort", onExternalAbort);
      this.rejectWorkerFailure = null;
    }
  }

  // Reuses the retained Worker; callers own input validation and captured state.
  async recognizeImage(image: Blob, signal: AbortSignal) {
    return this.performRecognition(image, signal);
  }

  async runDiagnostic(signal: AbortSignal): Promise<DiagnosticRunResult> {
    const startedAt = performance.now();
    const data = await this.performRecognition("/local-ai-diagnostics/ocr-smoke-test.png", signal);
    const blocks = data.blocks ?? [];
    return {
      kind: this.kind,
      initializedMs: this.initializedMs,
      inferenceMs: performance.now() - startedAt,
      details: {
        nonEmptyText: data.text.trim().length > 0,
        confidence: data.confidence,
        hasGeometry: blocks.length > 0,
        blockCount: blocks.length,
      },
    };
  }

  async cancel() {
    await this.dispose();
  }

  async dispose() {
    const lifecycle = this.lifecycleAbort;
    this.lifecycleAbort = null;
    lifecycle?.abort();
    this.rejectWorkerFailure?.(abortError());
    this.rejectWorkerFailure = null;
    this.pendingWorker = null;
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }
}
