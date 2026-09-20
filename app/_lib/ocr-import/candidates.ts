import type { LineDispositionResult, NormalizedLine, ReviewCandidate, ReviewResult } from "./contracts";
import type { DictionaryMatch } from "./dictionary";
import { mapSpan, validBox, validConfidence } from "./normalization";
import { PHASE2_LIMITS as limits } from "../local-ai/phase2-limits.generated";
import profile from "../../../docs/personalized-english/phase2/runtime-profile.v1.json";
export function extractReview(lines: readonly { line: NormalizedLine; decision: LineDispositionResult }[], lookup: (term: string) => DictionaryMatch): ReviewResult {
  const candidates: ReviewCandidate[] = [], sanitized: string[] = []; const seen = new Set<string>(); let removedLineCount = 0;
  for (const { line, decision } of lines) {
    if (decision.disposition === "never_offer") { removedLineCount++; continue; }
    if (decision.disposition === "full_offer") sanitized.push(line.text);
    else removedLineCount++;
    const suppressed = new Set(decision.suppressedWordIds);
    for (const match of line.text.matchAll(/(?<![\p{L}\p{N}])[a-z]+(?:['’-][a-z]+)*(?![\p{L}\p{N}])/giu)) {
      const term = match[0].replaceAll("’", "'"); const key = term.toLowerCase();
      if ([...term].length > limits.maxTermLength || seen.has(key)) continue;
      const mapped = mapSpan(line, match.index, match.index + match[0].length);
      if (!mapped || !mapped.wordIds.length || mapped.wordIds.some(id => suppressed.has(id))) continue;
      const words = line.words.filter(word => mapped.wordIds.includes(word.id));
      if (words.some(word => !validConfidence(word.confidence) || !validBox(word.box, line.image))) continue;
      const confidence = Math.min(...words.map(word => word.confidence)); const dictionary = lookup(term);
      const state = confidence < profile.confidenceBands.confirmMinimum ? "must_review"
        : confidence < profile.confidenceBands.normalMinimum ? "confirm"
          : dictionary === "unknown" ? "possible_typo" : "normal";
      candidates.push(Object.freeze({ id: `candidate-${candidates.length}`, term, confidence, dictionary, state, selected: state === "normal",
        disposition: decision.disposition, exampleSentence: decision.disposition === "full_offer" && [...line.text].length <= limits.maxExampleLength ? line.text : null }));
      seen.add(key);
    }
  }
  return Object.freeze({ candidates: Object.freeze(candidates), safeWords: Object.freeze(candidates.map(candidate => candidate.term)),
    sanitizedText: sanitized.join("\n"), removedLineCount });
}
