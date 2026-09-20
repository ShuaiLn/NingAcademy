/// <reference lib="webworker" />

import { env, pipeline } from "@huggingface/transformers";
import type { HostToWorkerMessage, WorkerResponsePayload } from "../worker-protocol";
import { analyzeNerEntities, normalizeCapturedText, type RawNerEntity } from "../models/ner-corrections";
import { LOCAL_AI_CACHE_NAME } from "../model-cache";
import { assetsFor } from "../asset-catalog";
import { analyzeNerLines, type RawTokenEvidence } from "../models/ner-lines";
import { mapModelTokens } from "../../ocr-import/token-spans";

type Encoded = Record<string, { dims: number[]; data: ArrayLike<bigint> }>;

type Classifier = ((
  text: string,
  options: { aggregation_strategy: "simple" },
) => Promise<RawNerEntity[]>) & {
  dispose(): Promise<void>;
  tokenizer: ((text: string, options: { truncation: false; padding: false; add_special_tokens: true }) => Encoded) & {
    encode(text: string, options: { add_special_tokens: false }): number[];
  };
  model: ((encoded: Encoded) => Promise<{ logits: { dims: number[]; data: ArrayLike<number> } }>) & {
    config: { id2label: Record<string, string> };
  };
};

let classifier: Classifier | null = null;
let initializedMs = 0;
let cancelledGeneration = -1;
const nativeFetch = fetch.bind(globalThis);

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = "/local-ai-assets/ner/";
env.useBrowserCache = false;
const wasmBackend = env.backends.onnx.wasm;
if (!wasmBackend) throw new Error("ONNX Runtime Web WASM backend is unavailable");
wasmBackend.numThreads = 1;
wasmBackend.wasmPaths = "/local-ai-assets/ner/ort-1.26.0-dev/";
env.fetch = cacheFirstFetch;
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
      await classifier?.dispose();
      classifier = null;
      respond(message, { type: "disposed" });
      return;
    }
    if (message.type === "initialize") {
      const startedAt = performance.now();
      classifier = await pipeline("token-classification", "neurobert-e3a6a29", {
        dtype: "q8",
        device: "wasm",
      }) as unknown as Classifier;
      initializedMs = performance.now() - startedAt;
      respond(message, { type: "ready" });
      return;
    }
    if (!classifier) throw new Error("NER runtime is not initialized");
    if (cancelledGeneration === message.generation) throw new DOMException("Cancelled", "AbortError");

    if (message.type === "analyze-lines") {
      const active = classifier;
      let spans: ({ start: number; end: number } | null)[] = [];
      const lines = await analyzeNerLines(message.lines, {
        tokenize(text) {
          const encoded = active.tokenizer(text, { truncation: false, padding: false, add_special_tokens: true });
          const mapped = mapModelTokens(text, Array.from(encoded.input_ids.data, Number),
            piece => active.tokenizer.encode(piece, { add_special_tokens: false }));
          spans = mapped.spans;
          return { encoded, length: encoded.input_ids.data.length, mappingSafe: mapped.safe };
        },
        async infer(encoded) {
          const { logits } = await active.model(encoded);
          const [, count, labels] = logits.dims;
          if (count !== encoded.input_ids.data.length || !labels) throw new Error("Invalid model output");
          const tokens: RawTokenEvidence[] = [];
          for (let index = 0; index < count; index++) {
            let best = 0;
            for (let label = 1; label < labels; label++) {
              if (logits.data[index * labels + label] > logits.data[index * labels + best]) best = label;
            }
            const label = active.model.config.id2label[String(best)];
            if (!label) throw new Error("Invalid model labels");
            const peak = logits.data[index * labels + best];
            let denominator = 0;
            for (let i = 0; i < labels; i++) denominator += Math.exp(logits.data[index * labels + i] - peak);
            if (label !== "O") tokens.push({ tokenIndex: index, label, score: 1 / denominator,
              ...(spans[index] ?? {}) });
          }
          return tokens;
        },
      });
      if (cancelledGeneration === message.generation) throw new Error("Cancelled");
      respond(message, { type: "ner-lines", lines });
      return;
    }

    const text = "Maria Garcia works at Microsoft in Seattle.";
    const normalizedText = normalizeCapturedText(text);
    const startedAt = performance.now();
    const raw = await classifier(normalizedText, { aggregation_strategy: "simple" });
    const corrected = analyzeNerEntities(normalizedText, raw).entities;
    respond(message, {
      type: "result",
      result: {
        kind: "ner",
        initializedMs,
        inferenceMs: performance.now() - startedAt,
        details: {
          didRun: true,
          rawEntityCount: raw.length,
          correctedEntityCount: corrected.length,
          labels: [...new Set(corrected.map((entity) => entity.label))],
          correctionCount: corrected.filter((entity) => entity.correction !== "none").length,
        },
      },
    });
  } catch {
    respond(message, {
      type: "failure",
      failure: {
        code: message.type === "initialize" ? "initialization-failed" : "inference-failed",
        message: "本地 NER 未完成，请重试。",
        retryable: true,
      },
    });
  }
}

async function cacheFirstFetch(input: string | URL, init?: RequestInit) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search ||
      !assetsFor("ner").some(asset => asset.url === url.pathname) || request.method !== "GET") {
    throw new Error("Unregistered NER asset");
  }
  const cached = await (await caches.open(LOCAL_AI_CACHE_NAME)).match(request);
  if (cached) return cached;
  return nativeFetch(request);
}

function respond(
  request: HostToWorkerMessage,
  response: WorkerResponsePayload,
) {
  self.postMessage({ ...response, generation: request.generation, requestId: request.requestId });
}

export {};
