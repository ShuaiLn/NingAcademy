import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createWorker: vi.fn(), ensureModel: vi.fn(), clearModel: vi.fn() }));
vi.mock("tesseract.js", () => ({ createWorker: mocks.createWorker, OEM: { LSTM_ONLY: 1 } }));
vi.mock("../model-cache", () => ({ createBrowserModelCache: () => mocks }));
import { OcrRuntime } from "./ocr-runtime";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
};

describe("retained OCR study extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureModel.mockResolvedValue(undefined);
    mocks.clearModel.mockResolvedValue(undefined);
  });

  it("passes the validated Blob to the existing Worker and returns geometry", async () => {
    const data = { text: "bread", blocks: [{ bbox: { x0: 1, y0: 1, x1: 5, y1: 5 } }] };
    const worker = { recognize: vi.fn().mockResolvedValue({ data }), terminate: vi.fn() };
    mocks.createWorker.mockResolvedValue(worker);
    const runtime = new OcrRuntime(); const abort = new AbortController(); const input = new Blob(["fixture"]);
    await runtime.initialize(abort.signal);
    expect(await runtime.recognizeImage(input, abort.signal)).toBe(data);
    expect(worker.recognize).toHaveBeenCalledWith(input, {}, { blocks: true });
    await runtime.dispose(); expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("cancels pending createWorker initialization without waiting for it to resolve", async () => {
    const creation = deferred<{ recognize: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }>();
    const worker = { recognize: vi.fn(), terminate: vi.fn() };
    mocks.createWorker.mockReturnValue(creation.promise);
    const runtime = new OcrRuntime(); const abort = new AbortController();
    const pending = runtime.initialize(abort.signal);
    await vi.waitFor(() => expect(mocks.createWorker).toHaveBeenCalled());
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).not.toHaveBeenCalled();
    creation.resolve(worker);
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledTimes(1));
  });

  it("clears cached OCR assets after initialization failure", async () => {
    mocks.createWorker.mockRejectedValue(new Error("initialization failed"));
    const runtime = new OcrRuntime();
    await expect(runtime.initialize(new AbortController().signal)).rejects.toThrow("initialization failed");
    expect(mocks.clearModel).toHaveBeenCalledWith("ocr");
  });

  it("aborts a hanging recognition and disposes its Worker", async () => {
    const worker = { recognize: vi.fn(() => new Promise(() => undefined)), terminate: vi.fn() };
    mocks.createWorker.mockResolvedValue(worker);
    const runtime = new OcrRuntime(); const abort = new AbortController();
    await runtime.initialize(abort.signal);
    const pending = runtime.recognizeImage(new Blob(), abort.signal); abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects a pre-aborted recognition without calling inference", async () => {
    const runtime = new OcrRuntime(); const abort = new AbortController(); abort.abort();
    await expect(runtime.recognizeImage(new Blob(), abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("disposes the Worker when recognition rejects", async () => {
    const worker = { recognize: vi.fn().mockRejectedValue(new Error("recognition failed")), terminate: vi.fn() };
    mocks.createWorker.mockResolvedValue(worker);
    const runtime = new OcrRuntime(); const abort = new AbortController();
    await runtime.initialize(abort.signal);
    await expect(runtime.recognizeImage(new Blob(), abort.signal)).rejects.toThrow("recognition failed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("turns a Tesseract worker error callback into a settled crash and teardown", async () => {
    let crash: ((error: unknown) => void) | undefined;
    const worker = { recognize: vi.fn(() => new Promise(() => undefined)), terminate: vi.fn() };
    mocks.createWorker.mockImplementation((_language, _oem, options) => {
      crash = options.errorHandler;
      return Promise.resolve(worker);
    });
    const runtime = new OcrRuntime(); const abort = new AbortController();
    await runtime.initialize(abort.signal);
    const pending = runtime.recognizeImage(new Blob(), abort.signal);
    crash?.(new Error("worker crashed"));
    await expect(pending).rejects.toThrow("worker crashed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("times out a recognition hang and tears down the Worker", async () => {
    const worker = { recognize: vi.fn(() => new Promise(() => undefined)), terminate: vi.fn() };
    mocks.createWorker.mockResolvedValue(worker);
    const runtime = new OcrRuntime({ recognitionTimeoutMs: 5 });
    await runtime.initialize(new AbortController().signal);
    await expect(runtime.recognizeImage(new Blob(), new AbortController().signal)).rejects.toThrow("OCR recognition timed out");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("times out pending initialization and terminates a Worker that resolves later", async () => {
    const creation = deferred<{ recognize: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }>();
    const worker = { recognize: vi.fn(), terminate: vi.fn() };
    mocks.createWorker.mockReturnValue(creation.promise);
    const runtime = new OcrRuntime({ initializationTimeoutMs: 5 });
    await expect(runtime.initialize(new AbortController().signal)).rejects.toThrow("OCR Worker initialization timed out");
    creation.resolve(worker);
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledTimes(1));
  });
});
