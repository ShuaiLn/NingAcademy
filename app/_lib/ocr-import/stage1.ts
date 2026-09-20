import data from "../../../docs/personalized-english/phase2/stage1-patterns.v1.json";
import inventory from "../../../docs/personalized-english/phase2/sensitive-labels.v1.json";
export const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const SENSITIVE_LABEL_SOURCE = "(^|[^a-z])(" + inventory.labels.map(escapePattern).join("|") + ")([ ]*[:#=-][ ]*|[ ]+)[^ ]";
const expressions = [...data.patterns.map(pattern => new RegExp(pattern.source, "i")), new RegExp(SENSITIVE_LABEL_SOURCE, "i")];
export function textHasObviousPii(input: string) {
  const text = input.normalize("NFKC").replace(/\s+/gu, " ");
  return expressions.some(expression => expression.test(text));
}
