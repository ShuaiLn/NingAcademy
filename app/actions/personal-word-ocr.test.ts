import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/app/_lib/ocr-import/feature", () => ({ PERSONAL_WORD_OCR_ENABLED: true }));
vi.mock("@/utils/supabase/server", () => ({ createClient: mocks.createClient }));

import { confirmOcrWordsBulk } from "./personal-word-ocr";

const importId = "42000000-0000-0000-0000-000000000001";

beforeEach(() => {
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "student" } }, error: null });
  mocks.rpc.mockResolvedValue({
    data: [{ personal_word_id: "word", source_id: "source", term: "read", ocr_item_index: 0 }],
    error: null,
  });
});

describe("confirmOcrWordsBulk", () => {
  it("rejects an invalid or content-bearing shape before authentication", async () => {
    const result = await confirmOcrWordsBulk(importId, [{ term: "read", rawOcr: "private" }]);
    expect(result.ok).toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("re-authenticates and never invokes the RPC for an unauthenticated caller", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await confirmOcrWordsBulk(importId, [{ term: "read" }]);
    expect(result.ok).toBe(false);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("calls only the bulk RPC with canonical confirmed fields and revalidates", async () => {
    const result = await confirmOcrWordsBulk(importId, [{ term: "  read  ", meaning: "  阅读  ", exampleSentence: "" }]);
    expect(result).toEqual({ ok: true, count: 1 });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("upsert_personal_words_bulk_v1", {
      p_ocr_import_id: importId,
      p_words: [{ term: "read", meaning: "阅读", exampleSentence: null }],
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/student/personal-english");
  });

  it("returns generic failure and does not revalidate on RPC mismatch", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const result = await confirmOcrWordsBulk(importId, [{ term: "read" }]);
    expect(result).toEqual({ ok: false, error: "导入未完成，请检查所选内容后重试。" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
