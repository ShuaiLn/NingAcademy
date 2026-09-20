import { describe, expect, it } from "vitest";
import { assetsFor } from "../asset-catalog";
import type { HostToWorkerMessage } from "../worker-protocol";
import type { NerLineEvidence } from "./ner-lines";
import { analyzeNerEntities, correctNerEntities, normalizeCapturedText } from "./ner-corrections";
import { WorkerManagedModel } from "./worker-model";

class FakeWorker extends EventTarget {
  messages: HostToWorkerMessage[] = [];
  terminated = false;

  postMessage(message: HostToWorkerMessage) {
    this.messages.push(message);
    if (message.type === "dispose") queueMicrotask(() => this.reply(message, "disposed"));
  }

  terminate() { this.terminated = true; }

  reply(message: HostToWorkerMessage, type: "ready" | "disposed", generation = message.generation) {
    this.dispatchEvent(new MessageEvent("message", {
      data: { type, generation, requestId: message.requestId },
    }));
  }

  replyLines(message: HostToWorkerMessage, lines: NerLineEvidence[]) {
    this.dispatchEvent(new MessageEvent("message", {
      data: { type: "ner-lines", lines, generation: message.generation, requestId: message.requestId },
    }));
  }
}

class TestWorkerModel extends WorkerManagedModel {
  readonly kind = "ner" as const;
  constructor(private readonly fakeWorker: FakeWorker) { super(); }
  protected createWorker() { return this.fakeWorker as unknown as Worker; }
}

describe("real model adapter manifests", () => {
  it.each(["ocr", "ner", "tts"] as const)("has pinned local assets for %s", (kind) => {
    const assets = assetsFor(kind);
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((asset) => asset.url.startsWith("/local-ai-assets/"))).toBe(true);
    expect(assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256))).toBe(true);
  });
});

describe("module Worker boundary", () => {
  it("ignores a stale generation and accepts only the matching response", async () => {
    const worker = new FakeWorker();
    const runtime = new TestWorkerModel(worker);
    const pending = runtime.initialize(new AbortController().signal);
    const request = worker.messages[0];
    let settled = false;
    void pending.then(() => { settled = true; });
    worker.reply(request, "ready", request.generation + 1);
    await Promise.resolve();
    expect(settled).toBe(false);
    worker.reply(request, "ready");
    await pending;
    await runtime.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("rejects a messageerror and hard-terminates during disposal", async () => {
    const worker = new FakeWorker();
    const runtime = new TestWorkerModel(worker);
    const pending = runtime.initialize(new AbortController().signal);
    worker.dispatchEvent(new Event("messageerror"));
    await expect(pending).rejects.toThrow("Worker message error");
    await runtime.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("owns and freezes raw line evidence again after the Worker structured clone", async () => {
    const worker = new FakeWorker();
    const runtime = new TestWorkerModel(worker);
    const initialized = runtime.initialize(new AbortController().signal);
    worker.reply(worker.messages[0], "ready"); await initialized;
    const pending = runtime.analyzeLines([{ id: "line", text: "Maria" }], new AbortController().signal);
    const response = [{ id: "line", didRun: true, nerRequired: true, reason: null,
      encodedLength: 3, mappingSafe: true, tokens: [{ tokenIndex: 1, label: "B-PERSON", score: 0.9 }] }];
    worker.replyLines(worker.messages.at(-1)!, response as NerLineEvidence[]);
    const result = await pending;
    response[0].tokens[0].label = "O";
    expect(result[0].tokens[0].label).toBe("B-PERSON");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0].tokens[0])).toBe(true);
    await runtime.dispose();
  });
});

describe("NER normalization and targeted correction", () => {
  it("normalizes compatibility characters and whitespace before inference", () => {
    expect(normalizeCapturedText("  Ｍicrosoft\n  Seattle ")).toBe("Microsoft Seattle");
  });

  it("corrects the confirmed Microsoft GPE error while preserving the raw label", () => {
    const corrected = correctNerEntities("Maria works at Microsoft in Seattle.", [
      { entity_group: "PERSON", score: 0.9, word: "maria" },
      { entity_group: "GPE", score: 0.66, word: "microsoft" },
      { entity_group: "GPE", score: 0.91, word: "seattle" },
    ]);
    expect(corrected).toContainEqual({
      text: "microsoft",
      label: "ORG",
      score: 0.66,
      rawLabel: "GPE",
      start: null,
      end: null,
      correction: "known-organization",
      rawEvidence: [{ entity_group: "GPE", score: 0.66, word: "microsoft" }],
    });
  });

  it("adds an omitted known organization through the same general dictionary mechanism", () => {
    const corrected = correctNerEntities("Alice joined Apple in Paris.", [
      { entity_group: "PERSON", score: 0.8, word: "alice" },
      { entity_group: "GPE", score: 0.8, word: "paris" },
    ]);
    expect(corrected).toContainEqual({
      text: "Apple",
      label: "ORG",
      score: null,
      rawLabel: null,
      start: 13,
      end: 18,
      correction: "known-organization",
      rawEvidence: [],
    });
  });

  it("uses token boundaries and does not add a dictionary substring", () => {
    expect(correctNerEntities("A pineapple is fruit.", [], ["Apple"])).toEqual([]);
  });

  it("accepts an injected dictionary instead of encoding a benchmark-only rule", () => {
    const corrected = correctNerEntities("Ada joined Acme Research.", [], ["Acme Research"]);
    expect(corrected[0]).toMatchObject({ text: "Acme Research", label: "ORG" });
  });

  it("merges split known-organization tokens and retains every raw label, score, and span", () => {
    const raw = [
      { entity_group: "ORG", score: 0.71, word: "Open", start: 11, end: 15 },
      { entity_group: "GPE", score: 0.63, word: "##AI", start: 15, end: 17 },
    ];
    const analysis = analyzeNerEntities("Sam joined OpenAI yesterday.", raw);
    expect(analysis.rawEntities).toEqual(raw);
    expect(analysis.entities).toContainEqual({
      text: "OpenAI",
      label: "ORG",
      score: 0.71,
      rawLabel: "ORG+GPE",
      start: 11,
      end: 17,
      correction: "known-organization",
      rawEvidence: raw,
    });
  });

  it("handles empty input and rejects a malformed non-string at the normalization boundary", () => {
    expect(analyzeNerEntities("", []).entities).toEqual([]);
    expect(() => normalizeCapturedText(null as unknown as string)).toThrow("NER input must be a string");
  });
});
