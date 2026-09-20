import { PHASE2_LIMITS as limits } from "../local-ai/phase2-limits.generated";
import type { ConfirmedWord } from "./contracts";
import { textHasObviousPii } from "./stage1";
// PostgreSQL's ARE `\s` under the project's UTF-8 locale differs from
// JavaScript `\s` for a few Unicode spaces. Keep this explicit class aligned
// with private.normalize_spelling(text), excluding BOM, NBSP, figure space,
// and narrow NBSP from the spacing class.
const POSTGRES_SPACING = /[\u0009-\u000D\u0020\u0085\u2000-\u2006\u2008-\u200A\u2028\u2029\u205F\u3000]+/gu;
export const trimPostgresSpaces = (value: string) => value.replace(POSTGRES_SPACING, " ").replace(/^ +| +$/gu, "");
export const normalizePersonalTerm = (term: string) => [...trimPostgresSpaces(term)]
  .map(character => character === "\u0130" ? "i" : character.toLowerCase())
  .join("");
export function validateConfirmation(id: unknown, input: unknown): ConfirmedWord[] | null {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || !Array.isArray(input) || !input.length || input.length > limits.maxBulkItems) return null;
  const seen = new Set<string>(); const words: ConfirmedWord[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !["term", "meaning", "exampleSentence"].includes(key))
      || typeof item.term !== "string" || (item.meaning != null && typeof item.meaning !== "string")
      || (item.exampleSentence != null && typeof item.exampleSentence !== "string")) return null;
    const word = { term: trimPostgresSpaces(item.term), meaning: item.meaning == null ? null : trimPostgresSpaces(item.meaning) || null,
      exampleSentence: item.exampleSentence == null ? null : trimPostgresSpaces(item.exampleSentence) || null };
    const normalized = normalizePersonalTerm(word.term);
    if (!normalized || seen.has(normalized) || [...word.term].length > limits.maxTermLength
      || [...(word.meaning ?? "")].length > limits.maxMeaningLength || [...(word.exampleSentence ?? "")].length > limits.maxExampleLength
      || [word.term, word.meaning, word.exampleSentence].some(value => value !== null && (value.includes("\0") || /[\uD800-\uDFFF]/u.test(value) || textHasObviousPii(value)))) return null;
    seen.add(normalized); words.push(word);
  }
  return words;
}
