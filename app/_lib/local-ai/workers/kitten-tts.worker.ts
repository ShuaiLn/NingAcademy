/// <reference lib="webworker" />

import { KittenTTSEngine, textToInputIds } from "kitten-tts-webgpu";
import type { HostToWorkerMessage, WorkerResponsePayload } from "../worker-protocol";
import { LOCAL_AI_CACHE_NAME } from "../model-cache";

const MODEL_URL = "/local-ai-assets/tts/kitten-nano-int8-84781d7/kitten_tts_nano_v0_8.onnx";
const VOICES_URL = "/local-ai-assets/tts/kitten-nano-int8-84781d7/voices.npz";
const nativeFetch = fetch.bind(globalThis);
let engine: KittenTTSEngine | null = null;
let initializedMs = 0;
let cancelledGeneration = -1;

// kitten-tts-webgpu@0.1.1 dispatches device-loss events through `window`.
// A Worker-safe global alias keeps that narrow lifecycle path functional.
if (!("window" in globalThis)) {
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
}
globalThis.fetch = cacheFirstFetch as typeof fetch;

self.onmessage = (event: MessageEvent<HostToWorkerMessage>) => void handle(event.data);

async function handle(message: HostToWorkerMessage) {
  try {
    if (message.type === "cancel") {
      cancelledGeneration = message.generation;
      respond(message, { type: "cancelled" });
      return;
    }
    if (message.type === "dispose") {
      engine?.destroy();
      engine = null;
      respond(message, { type: "disposed" });
      return;
    }
    if (message.type === "initialize") {
      const startedAt = performance.now();
      engine = new KittenTTSEngine();
      await engine.init();
      await engine.loadModel(MODEL_URL, VOICES_URL);
      initializedMs = performance.now() - startedAt;
      respond(message, { type: "ready" });
      return;
    }
    if (!engine) throw new Error("KittenTTS runtime is not initialized");
    if (cancelledGeneration === message.generation) throw new DOMException("Cancelled", "AbortError");

    const phrase = "The quick brown fox jumps over the lazy dog.";
    const startedAt = performance.now();
    const { ids } = await textToInputIds(phrase);
    const generated = await engine.generate(ids, "Bella", 1, phrase.length);
    const waveform = generated.waveform;
    let peak = 0;
    let nonZeroSamples = 0;
    for (const sample of waveform) {
      peak = Math.max(peak, Math.abs(sample));
      if (sample !== 0) nonZeroSamples += 1;
    }
    respond(message, {
      type: "result",
      result: {
        kind: "tts",
        initializedMs,
        inferenceMs: performance.now() - startedAt,
        details: {
          sampleRate: 24_000,
          sampleCount: waveform.length,
          durationSeconds: waveform.length / 24_000,
          nonZeroSamples,
          peak,
          valid: waveform.length > 0 && nonZeroSamples > 0 && Number.isFinite(peak),
          engine: "KittenTTS Nano INT8",
        },
      },
    });
  } catch (error) {
    respond(message, {
      type: "failure",
      failure: {
        code: message.type === "initialize" ? "initialization-failed" : "inference-failed",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      },
    });
  }
}

async function cacheFirstFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/local-ai-assets/")) {
    const cached = await (await caches.open(LOCAL_AI_CACHE_NAME)).match(request);
    if (cached) return cached;
  }
  return nativeFetch(request);
}

function respond(
  request: HostToWorkerMessage,
  response: WorkerResponsePayload,
) {
  self.postMessage({ ...response, generation: request.generation, requestId: request.requestId });
}

export {};
