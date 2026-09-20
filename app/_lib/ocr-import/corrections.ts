import gazetteer from "../../../docs/personalized-english/phase2/gazetteer.v1.json";
import correctionRules from "../../../docs/personalized-english/phase2/ner-correction-rules.v1.json";
import type { NerLineEvidence } from "../local-ai/models/ner-lines";
import { escapePattern } from "./stage1";
declare const rawBrand: unique symbol;
declare const correctedBrand: unique symbol;
export type RawEntity = Readonly<{ label: string; score: number; start: number; end: number; tokenIndices: readonly number[]; [rawBrand]: true }>;
export type CorrectedEntity = Readonly<{ label: string; start: number; end: number; rawEvidence: readonly RawEntity[];
  correction: Readonly<{ id: string; version: 1; operation: "none" | "relabel" | "omitted-addition" | "split-merge"; reason: string }>;
  [correctedBrand]: true }>;
export interface CorrectedEvidence { readonly raw: readonly RawEntity[]; readonly entities: readonly CorrectedEntity[]; readonly ambiguous: boolean }
const organizationRule = (() => {
  const rule = correctionRules.rules.find(candidate => candidate.id === "organization-exact-v1");
  if (!rule || rule.version !== 1) throw new Error("Invalid governed NER correction rule");
  return rule;
})();
export function correctEntities(text: string, evidence: NerLineEvidence): CorrectedEvidence {
  let ambiguous = evidence.mappingSafe === false; const raw: RawEntity[] = [];
  for (const token of evidence.tokens) {
    const label = token.label.replace(/^[BI]-/, "").replace(/^PER$/, "PERSON").replace(/^(GPE|LOCATION)$/, "LOC");
    const start = token.start, end = token.end;
    if (start === undefined || end === undefined || !Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end <= start || end > text.length || !Number.isFinite(token.score)) { ambiguous = true; continue; }
    const prior = raw.at(-1);
    // BIO subwords may conservatively map to the same original lexical span.
    if (prior && prior.label === label && start <= prior.end && end >= prior.start) {
      raw[raw.length - 1] = Object.freeze({ ...prior, start: Math.min(start, prior.start), end: Math.max(end, prior.end),
        score: Math.min(prior.score, token.score), tokenIndices: Object.freeze([...prior.tokenIndices, token.tokenIndex]) });
    } else {
      if (prior && start < prior.end) ambiguous = true;
      raw.push(Object.freeze({ label, score: token.score, start, end, tokenIndices: Object.freeze([token.tokenIndex]) }) as RawEntity);
    }
  }
  const entities: CorrectedEntity[] = raw.map(entity => Object.freeze({ label: entity.label, start: entity.start, end: entity.end,
    rawEvidence: Object.freeze([entity]), correction: Object.freeze({ id: "raw", version: 1, operation: "none", reason: "Unmodified model evidence" }) }) as CorrectedEntity);
  for (const organization of [...gazetteer.organizations].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapePattern(organization)}(?![\\p{L}\\p{M}\\p{N}])`, "giu");
    for (const match of text.matchAll(pattern)) {
      const start = match.index, end = start + match[0].length;
      const overlapping = entities.filter(entity => entity.start < end && entity.end > start);
      if (overlapping.some(entity => entity.label === "PERSON" || entity.start < start || entity.end > end)) {
        if (overlapping.some(entity => entity.label === "PERSON")) ambiguous = true;
        continue;
      }
      if (overlapping.length === 1 && overlapping[0].label === "ORG" && overlapping[0].start === start && overlapping[0].end === end) continue;
      const operation = overlapping.length === 0 ? "omitted-addition" : overlapping.length === 1 ? "relabel" : "split-merge";
      for (const entity of overlapping) entities.splice(entities.indexOf(entity), 1);
      entities.push(Object.freeze({ label: "ORG", start, end, rawEvidence: Object.freeze(overlapping.flatMap(entity => entity.rawEvidence)),
        correction: Object.freeze({ id: organizationRule.id, version: organizationRule.version as 1, operation,
          reason: organizationRule.reason }) }) as CorrectedEntity);
    }
  }
  return Object.freeze({ raw: Object.freeze(raw), entities: Object.freeze(entities.sort((a, b) => a.start - b.start)), ambiguous });
}
