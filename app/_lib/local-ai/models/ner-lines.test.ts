import { describe, expect, it, vi } from "vitest";
import { analyzeNerLines } from "./ner-lines";

describe("Phase 2 study NER boundary", () => {
  it("skips tokenization above 2,000 UTF-16 units", async () => {
    const tokenize = vi.fn(); const infer = vi.fn();
    expect(await analyzeNerLines([{ id: "large", text: "a".repeat(2001) }], { tokenize, infer }))
      .toMatchObject([{ reason: "input_too_large", didRun: false, nerRequired: false }]);
    expect(tokenize).not.toHaveBeenCalled(); expect(infer).not.toHaveBeenCalled();
  });
  it.each([511, 512, 513])("guards %i encoded tokens independently", async length => {
    const infer = vi.fn(async () => []);
    const result = await analyzeNerLines([{ id: "line", text: "short" }], {
      tokenize: () => ({ encoded: "encoded", length }), infer,
    });
    expect(result[0].didRun).toBe(length <= 512);
    expect(infer).toHaveBeenCalledTimes(length <= 512 ? 1 : 0);
  });
  it("rejects the whole batch after a later mandatory inference failure", async () => {
    const infer = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("private payload"));
    await expect(analyzeNerLines([{ id: "a", text: "a" }, { id: "b", text: "b" }], {
      tokenize: () => ({ encoded: [], length: 3 }), infer,
    })).rejects.toThrow();
  });
  it("preserves order, owns and freezes evidence", async () => {
    const raw = [{ tokenIndex: 1, label: "B-PERSON", score: 0.9 }];
    const result = await analyzeNerLines([{ id: "b", text: "b" }, { id: "a", text: "a" }], {
      tokenize: () => ({ encoded: [], length: 3 }), infer: async () => raw,
    });
    raw[0].label = "O";
    expect(result.map(line => line.id)).toEqual(["b", "a"]);
    expect(result[0].tokens[0].label).toBe("B-PERSON");
    expect(Object.isFrozen(result[0].tokens[0])).toBe(true);
  });
  it("rejects duplicate IDs, oversized batches and malformed evidence", async () => {
    const backend = { tokenize: () => ({ encoded: [], length: 3 }), infer: async () => [] };
    await expect(analyzeNerLines([{ id: "a", text: "a" }, { id: "a", text: "b" }], backend)).rejects.toThrow();
    await expect(analyzeNerLines(Array.from({ length: 101 }, (_, i) => ({ id: String(i), text: "a" })), backend)).rejects.toThrow();
    await expect(analyzeNerLines(Array.from({ length: 26 }, (_, i) => ({ id: String(i), text: "a".repeat(2000) })), backend)).rejects.toThrow();
    await expect(analyzeNerLines([{ id: "a", text: "a" }], { ...backend,
      infer: async () => [{ tokenIndex: 1, label: "O", score: NaN }],
    })).rejects.toThrow();
  });
});
