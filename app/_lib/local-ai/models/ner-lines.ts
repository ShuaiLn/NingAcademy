// Bounded raw-evidence API shared by the Phase 2 study and production pipeline.
import { PHASE2_LIMITS as limits } from "../phase2-limits.generated";
export interface NerLineInput { readonly id: string; readonly text: string }
export interface RawTokenEvidence {
  readonly tokenIndex: number;
  readonly label: string;
  readonly score: number;
  readonly start?: number;
  readonly end?: number;
}
export type NerLineEvidence = Readonly<{
  id: string;
  didRun: boolean;
  nerRequired: boolean;
  reason: "input_too_large" | "ner_input_too_large" | null;
  encodedLength: number | null;
  tokens: readonly RawTokenEvidence[];
  mappingSafe?: boolean;
}>;

export interface NerLineBackend<T> {
  tokenize(text: string): { encoded: T; length: number; mappingSafe?: boolean };
  infer(encoded: T): Promise<readonly RawTokenEvidence[]>;
}

export async function analyzeNerLines<T>(
  lines: readonly NerLineInput[], backend: NerLineBackend<T>,
): Promise<readonly NerLineEvidence[]> {
  if (!Array.isArray(lines) || lines.length > limits.maxNerBatchLines ||
      lines.some(line => typeof line?.id !== "string" || !line.id || typeof line.text !== "string") ||
      new Set(lines.map(line => line.id)).size !== lines.length ||
      lines.reduce((sum, line) => sum + line.text.length, 0) > limits.maxNerBatchCharacters) {
    throw new Error("Invalid NER batch");
  }
  const results: NerLineEvidence[] = [];
  for (const line of lines) {
    if (line.text.length > limits.maxNormalizedUtf16Units) {
      results.push(Object.freeze({ id: line.id, didRun: false, nerRequired: false,
        reason: "input_too_large", encodedLength: null, tokens: Object.freeze([]) }));
      continue;
    }
    const { encoded, length, mappingSafe } = backend.tokenize(line.text);
    if (!Number.isInteger(length) || length < 2) throw new Error("Invalid tokenization");
    if (length > limits.maxNerInputIds) {
      results.push(Object.freeze({ id: line.id, didRun: false, nerRequired: false,
        reason: "ner_input_too_large", encodedLength: length, tokens: Object.freeze([]) }));
      continue;
    }
    // No partial result escapes when any eligible line fails mandatory inference.
    const tokens = await backend.infer(encoded);
    if (!Array.isArray(tokens) || tokens.some(token =>
      !Number.isInteger(token.tokenIndex) || token.tokenIndex < 0 || token.tokenIndex >= length ||
      typeof token.label !== "string" || !Number.isFinite(token.score) || token.score < 0 || token.score > 1)) {
      throw new Error("Invalid NER evidence");
    }
    results.push(Object.freeze({ id: line.id, didRun: true, nerRequired: true,
      reason: null, encodedLength: length, mappingSafe,
      tokens: Object.freeze(tokens.map(token => Object.freeze({ ...token }))) }));
  }
  return Object.freeze(results);
}
