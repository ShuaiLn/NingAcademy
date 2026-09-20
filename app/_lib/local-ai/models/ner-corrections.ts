export interface RawNerEntity {
  entity_group: string;
  score: number;
  word: string;
  start?: number;
  end?: number;
}

export interface NormalizedNerEntity {
  text: string;
  label: string;
  score: number | null;
  rawLabel: string | null;
  start: number | null;
  end: number | null;
  correction: "none" | "known-organization";
  rawEvidence: RawNerEntity[];
}

export interface NerCorrectionResult {
  normalizedText: string;
  rawEntities: RawNerEntity[];
  entities: NormalizedNerEntity[];
}

export const PHASE0_KNOWN_ORGANIZATIONS = [
  "Amazon",
  "Apple",
  "Google",
  "Microsoft",
  "OpenAI",
] as const;

export function normalizeCapturedText(text: string) {
  if (typeof text !== "string") throw new TypeError("NER input must be a string");
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function analyzeNerEntities(
  input: string,
  rawEntities: RawNerEntity[],
  knownOrganizations: readonly string[] = PHASE0_KNOWN_ORGANIZATIONS,
): NerCorrectionResult {
  const normalizedText = normalizeCapturedText(input);
  const preservedRaw = rawEntities.map((entity) => ({ ...entity }));
  return {
    normalizedText,
    rawEntities: preservedRaw,
    entities: correctNerEntities(normalizedText, preservedRaw, knownOrganizations),
  };
}

export function correctNerEntities(
  input: string,
  rawEntities: RawNerEntity[],
  knownOrganizations: readonly string[] = PHASE0_KNOWN_ORGANIZATIONS,
): NormalizedNerEntity[] {
  const normalizedInput = normalizeCapturedText(input);
  const entities: NormalizedNerEntity[] = rawEntities.map((entity) => ({
    text: entity.word.replace(/##/g, "").trim(),
    label: entity.entity_group,
    score: entity.score,
    rawLabel: entity.entity_group,
    start: entity.start ?? null,
    end: entity.end ?? null,
    correction: "none",
    rawEvidence: [{ ...entity }],
  }));

  for (const organization of [...knownOrganizations].sort((a, b) => b.length - a.length)) {
    const expression = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(organization)})(?=$|[^\\p{L}\\p{N}])`, "giu");
    for (let match = expression.exec(normalizedInput); match; match = expression.exec(normalizedInput)) {
      const start = match.index + match[1].length;
      const end = start + match[2].length;
      const overlapping = entities.filter((entity) => (
        entity.start !== null && entity.end !== null && entity.start < end && entity.end > start
      ));

      if (overlapping.length > 0) {
        const exact = overlapping.length === 1
          && overlapping[0].start === start
          && overlapping[0].end === end;
        if (exact) {
          const existing = overlapping[0];
          if (existing.label !== "ORG") {
            existing.label = "ORG";
            existing.correction = "known-organization";
          }
          continue;
        }

        for (const entity of overlapping) entities.splice(entities.indexOf(entity), 1);
        entities.push({
          text: match[2],
          label: "ORG",
          score: Math.max(...overlapping.map((entity) => entity.score ?? 0)),
          rawLabel: [...new Set(overlapping.map((entity) => entity.rawLabel).filter(Boolean))].join("+") || null,
          start,
          end,
          correction: "known-organization",
          rawEvidence: overlapping.flatMap((entity) => entity.rawEvidence.map((raw) => ({ ...raw }))),
        });
        continue;
      }

      const existing = entities.find(
        (entity) => entity.start === null
          && entity.text.localeCompare(organization, undefined, { sensitivity: "base" }) === 0,
      );
      if (existing) {
        if (existing.label !== "ORG") {
          existing.label = "ORG";
          existing.correction = "known-organization";
        }
        continue;
      }

      entities.push({
        text: match[2],
        label: "ORG",
        score: null,
        rawLabel: null,
        start,
        end: start + match[2].length,
        correction: "known-organization",
        rawEvidence: [],
      });
    }
  }

  return entities;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
