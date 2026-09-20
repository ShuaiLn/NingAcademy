import { describe, expect, it } from "vitest";
import type { DiagnosticRunResult, LocalModelKind, ManagedModel } from "./contracts";
import { LocalModelLifecycle } from "./model-lifecycle";

function model(kind: LocalModelKind, events: string[], failInitialization = false): ManagedModel {
  return {
    kind,
    async initialize() {
      events.push(`init:${kind}`);
      if (failInitialization) throw new Error("forced initialization failure");
    },
    async runDiagnostic(): Promise<DiagnosticRunResult> {
      events.push(`run:${kind}`);
      return { kind, initializedMs: 1, inferenceMs: 1, details: {} };
    },
    cancel() { events.push(`cancel:${kind}`); },
    async dispose() { events.push(`dispose:${kind}`); },
  };
}

describe("LocalModelLifecycle", () => {
  it("reuses the current ready model", async () => {
    const events: string[] = [];
    const lifecycle = new LocalModelLifecycle({
      ocr: () => model("ocr", events), ner: () => model("ner", events), tts: () => model("tts", events),
    });
    await lifecycle.acquire("ocr");
    await lifecycle.acquire("ocr");
    expect(events).toEqual(["init:ocr"]);
  });

  it("disposes the hot model before initializing another kind", async () => {
    const events: string[] = [];
    const lifecycle = new LocalModelLifecycle({
      ocr: () => model("ocr", events), ner: () => model("ner", events), tts: () => model("tts", events),
    });
    await lifecycle.acquire("ocr");
    await lifecycle.acquire("tts");
    await lifecycle.acquire("ner");
    expect(events).toEqual([
      "init:ocr", "cancel:ocr", "dispose:ocr", "init:tts", "cancel:tts", "dispose:tts", "init:ner",
    ]);
  });

  it("serializes concurrent acquisitions", async () => {
    const events: string[] = [];
    const lifecycle = new LocalModelLifecycle({
      ocr: () => model("ocr", events), ner: () => model("ner", events), tts: () => model("tts", events),
    });
    await Promise.all([lifecycle.acquire("ocr"), lifecycle.acquire("ner")]);
    expect(lifecycle.getSnapshot()).toMatchObject({ kind: "ner", phase: "ready" });
    expect(events.indexOf("dispose:ocr")).toBeLessThan(events.indexOf("init:ner"));
  });

  it("drops a failed handle and creates a fresh model on explicit retry", async () => {
    const events: string[] = [];
    let attempts = 0;
    const lifecycle = new LocalModelLifecycle({
      ocr: () => model("ocr", events, attempts++ === 0),
      ner: () => model("ner", events),
      tts: () => model("tts", events),
    });
    await expect(lifecycle.acquire("ocr")).rejects.toThrow("forced initialization failure");
    expect(lifecycle.getSnapshot().phase).toBe("failed");
    await lifecycle.acquire("ocr");
    expect(attempts).toBe(2);
    expect(lifecycle.getSnapshot().phase).toBe("ready");
  });

  it("publishes stable ordered checking, download, initialization, and ready progress", async () => {
    const events: string[] = [];
    const lifecycle = new LocalModelLifecycle({
      ocr: () => ({
        ...model("ocr", events),
        async initialize(_signal, reportProgress) {
          reportProgress?.({ phase: "downloading", loadedBytes: 5, totalBytes: 10 });
          reportProgress?.({ phase: "initializing", message: "worker" });
        },
      }),
      ner: () => model("ner", events),
      tts: () => model("tts", events),
    });
    const phases: string[] = [];
    lifecycle.subscribe(() => phases.push(lifecycle.getSnapshot().phase));
    await lifecycle.acquire("ocr");
    expect(phases).toEqual(["idle", "checking", "downloading", "initializing", "ready"]);
  });

  it("drops retained references even when cancellation fails during disposal", async () => {
    let attempts = 0;
    const events: string[] = [];
    const lifecycle = new LocalModelLifecycle({
      ocr: () => {
        attempts += 1;
        const created = model("ocr", events);
        return attempts === 1
          ? { ...created, cancel: () => { throw new Error("forced cancel failure"); } }
          : created;
      },
      ner: () => model("ner", events),
      tts: () => model("tts", events),
    });
    await lifecycle.acquire("ocr");
    await expect(lifecycle.release()).rejects.toThrow("forced cancel failure");
    expect(lifecycle.getSnapshot()).toMatchObject({ phase: "failed", failure: { code: "dispose-failed" } });
    await lifecycle.acquire("ocr");
    expect(attempts).toBe(2);
    expect(lifecycle.getSnapshot().phase).toBe("ready");
  });
});
