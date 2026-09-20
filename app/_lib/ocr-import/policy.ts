import profile from "../../../docs/personalized-english/phase2/runtime-profile.v1.json";
import institution from "../../../docs/personalized-english/phase2/institution-patterns.v1.json";
import gazetteer from "../../../docs/personalized-english/phase2/gazetteer.v1.json";
import { PHASE2_LIMITS as limits } from "../local-ai/phase2-limits.generated";
import type { NerLineEvidence } from "../local-ai/models/ner-lines";
import type { LineDispositionResult, NormalizedLine } from "./contracts";
import { correctEntities, type CorrectedEvidence } from "./corrections";
import type { DictionaryMatch } from "./dictionary";
import { mapSpan, validBox, validConfidence } from "./normalization";
import { escapePattern, textHasObviousPii } from "./stage1";
export interface LinePolicyInput {
  line: NormalizedLine; ner: NerLineEvidence; corrected: CorrectedEvidence;
  validNonblankLineCount: number; stage1: boolean; cjkDominant: boolean;
  lowEnglishMatch: boolean; publicEntity: boolean; positionalInstitution: boolean;
}
export function structuralIntegrityReason(line: NormalizedLine): string | null {
  if (!validBox(line.box, line.image)) return "invalid_line_geometry";
  if (!validConfidence(line.confidence)) return "invalid_line_confidence";
  if (!line.mappingSafe) return "unsafe_span_mapping";
  return null;
}
export function structuralReason(line: NormalizedLine): string | null {
  const integrity = structuralIntegrityReason(line);
  if (integrity) return integrity;
  if (line.text.length > limits.maxNormalizedUtf16Units) return "input_too_large";
  return null;
}
export function countStructurallyValidNonblankLines(lines: readonly NormalizedLine[]) {
  return lines.filter(line => line.text.length > 0 && structuralIntegrityReason(line) === null).length;
}
export function computeLineSignals(line: NormalizedLine, ner: NerLineEvidence, validNonblankLineCount: number,
  lookup: (word: string) => DictionaryMatch): LinePolicyInput {
  const corrected = correctEntities(line.text, ner);
  const latin = [...line.text.matchAll(/[a-z]+(?:['’-][a-z]+)*/giu)].map(match => match[0]);
  const letters = [...line.text.matchAll(/\p{L}/gu)].length;
  const cjk = [...line.text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)].length;
  const hasGazetteer = [...gazetteer.organizations, ...gazetteer.locations].some(value =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapePattern(value)}(?![\\p{L}\\p{N}])`, "iu").test(line.text));
  const org = corrected.entities.some(entity => entity.label === "ORG") || gazetteer.organizations.some(value =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapePattern(value)}(?![\\p{L}\\p{N}])`, "iu").test(line.text));
  const midpoint = (line.box.y0 + line.box.y1) / (2 * line.image.height);
  return { line, ner, corrected, validNonblankLineCount, stage1: textHasObviousPii(line.text), cjkDominant: letters > 0 && cjk / letters > 0.5,
    lowEnglishMatch: latin.length >= 5 && latin.filter(word => lookup(word) !== "unknown").length / latin.length < 0.35,
    publicEntity: hasGazetteer || corrected.entities.some(entity => ["ORG", "LOC"].includes(entity.label)),
    positionalInstitution: validNonblankLineCount >= profile.position.minimumValidNonblankLines &&
      (midpoint <= profile.position.edgeFraction || midpoint >= 1 - profile.position.edgeFraction) &&
      (org || institution.patterns.some(pattern => new RegExp(pattern.source, "i").test(line.text))) };
}
export function classifyLineDisposition(input: LinePolicyInput): LineDispositionResult {
  const { line, ner, corrected } = input;
  const reject = (reason: string): LineDispositionResult => ({ disposition: "never_offer", reason, suppressedWordIds: line.words.map(word => word.id) });
  const structural = structuralReason(line); if (structural) return reject(structural);
  if (ner.reason) return reject(ner.reason);
  if (!ner.didRun || !ner.nerRequired) throw new Error("Mandatory NER unavailable");
  if (ner.mappingSafe === false) return reject("unsafe_span_mapping");
  if (input.stage1) return reject("deterministic_high_risk_pii");
  if (input.positionalInstitution) return reject("header_footer_institution");
  if (input.cjkDominant) return reject("non_target_script");
  if (input.lowEnglishMatch) return reject("non_english_latin_low_match");
  if (corrected.ambiguous) return reject("ner_ambiguous");
  const suppressed = new Set<string>(); let delimiterBounded = false;
  for (const entity of corrected.entities) {
    const span = mapSpan(line, entity.start, entity.end);
    if (!span || !span.wordIds.length) return reject("unsafe_span_mapping");
    if (entity.label !== "PERSON") continue;
    for (const id of span.wordIds) suppressed.add(id);
    const indices = span.wordIds.map(id => line.words.findIndex(word => word.id === id));
    for (const direction of [-1, 1]) {
      let at = direction < 0 ? Math.min(...indices) : Math.max(...indices); let count = 0;
      for (;;) {
        const next = at + direction;
        const current = line.words[at];
        const gapStart = direction < 0 ? (next >= 0 ? line.words[next].end : 0) : current.end;
        const gapEnd = direction < 0 ? current.start : (next < line.words.length ? line.words[next].start : line.original.length);
        if (/[\/|\t;]/.test(line.original.slice(gapStart, gapEnd)) || /[\/|\t;]/.test(current.text)) { delimiterBounded = true; break; }
        if (next < 0 || next >= line.words.length) break;
        if (/^[\/|;]+$/.test(line.words[next].text)) { delimiterBounded = true; break; }
        if (count === limits.personExpansionWordsPerSide) return reject("person_boundary_uncertain");
        suppressed.add(line.words[next].id); at = next; count++;
      }
    }
  }
  if (suppressed.size) return { disposition: "word_only", reason: delimiterBounded ? "person_segment_removed" : "person_span_removed", suppressedWordIds: [...suppressed] };
  return { disposition: "full_offer", reason: input.publicEntity ? "public_entity_only" : "no_privacy_signal", suppressedWordIds: [] };
}
