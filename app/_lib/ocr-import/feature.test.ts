import { afterEach, describe, expect, it, vi } from "vitest";

const original = process.env.NEXT_PUBLIC_PERSONAL_WORD_OCR_ENABLED;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_PERSONAL_WORD_OCR_ENABLED;
  else process.env.NEXT_PUBLIC_PERSONAL_WORD_OCR_ENABLED = original;
  vi.resetModules();
});

describe("Phase 2 application rollback switch", () => {
  it("is enabled by default", async () => {
    delete process.env.NEXT_PUBLIC_PERSONAL_WORD_OCR_ENABLED;
    vi.resetModules();
    expect((await import("./feature")).PERSONAL_WORD_OCR_ENABLED).toBe(true);
  });

  it("disables the route and action only for the exact false value", async () => {
    process.env.NEXT_PUBLIC_PERSONAL_WORD_OCR_ENABLED = "false";
    vi.resetModules();
    expect((await import("./feature")).PERSONAL_WORD_OCR_ENABLED).toBe(false);
  });
});
