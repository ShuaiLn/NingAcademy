import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { PHASE2_LIMITS } from "../_lib/local-ai/phase2-limits.generated";
import { validateConfirmation } from "../_lib/ocr-import/validation";

const require = createRequire(import.meta.url);
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node") as {
  encodeReply(value: unknown): Promise<string | FormData>;
};

const configuredLimitBytes = 3 * 1024 * 1024;

describe("Phase 2 Server Action transport boundary", () => {
  it("carries the maximum valid confirmation through the real React Flight encoder", async () => {
    // U+0001 is valid input and expands to a six-byte JSON escape, making this
    // larger on the wire than four-byte Unicode text or ordinary ASCII text.
    const expansion = "\u0001";
    const words = Array.from({ length: PHASE2_LIMITS.maxBulkItems }, (_, index) => ({
      term: String(index).padStart(3, "0") + expansion.repeat(PHASE2_LIMITS.maxTermLength - 3),
      meaning: expansion.repeat(PHASE2_LIMITS.maxMeaningLength),
      exampleSentence: expansion.repeat(PHASE2_LIMITS.maxExampleLength),
    }));
    const id = "42000000-0000-0000-0000-000000000001";
    expect(validateConfirmation(id, words)).toHaveLength(PHASE2_LIMITS.maxBulkItems);

    const encoded = await encodeReply([id, words]);
    expect(typeof encoded).toBe("string");
    const wireBytes = Buffer.byteLength(encoded as string, "utf8");
    expect(wireBytes).toBeGreaterThan(1024 * 1024);
    expect(wireBytes).toBeLessThan(configuredLimitBytes);
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe("3mb");
  });
});
