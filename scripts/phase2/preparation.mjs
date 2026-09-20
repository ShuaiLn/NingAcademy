import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../../", import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), "utf8"));
export const worksheets = read("scripts/phase2/study/worksheets.json");
export const calibration = read("docs/personalized-english/phase2/calibration.draft.json");
export const corrections = read("docs/personalized-english/phase2/correction-fixtures.draft.json");
export const institutions = read("docs/personalized-english/phase2/institution-patterns.draft.json");

export function validatePreparation(sheets = worksheets, corpus = calibration, registry = corrections, patterns = institutions) {
  const fail = reason => { throw new Error(reason); };
  if (sheets.length !== 10 || new Set(sheets.map(s => s.id)).size !== 10 ||
      sheets.some(s => s.words.length < 5 || s.words.length > 10 || new Set(s.words).size !== s.words.length)) fail("Ten distinct 5–10-word worksheets required");
  const allocation = { "institution-edge": 10, "clean-edge": 8, "cropped-org": 8, stage1: 8, "interior-org-loc": 8, "boundary-mapping-size": 8 };
  if (corpus.cases.length !== 50 || new Set(corpus.cases.map(c => c.id)).size !== 50) fail("50 unique calibration lines required");
  for (const [group, count] of Object.entries(allocation)) {
    if (corpus.cases.filter(c => c.group === group).length !== count) fail("Calibration allocation changed");
  }
  if (corpus.cases.some(c => c.observed !== null || !c.provenance.startsWith("new synthetic"))) fail("Preparation cannot claim observations or external provenance");
  for (const c of corpus.cases) {
    if ((c.group === "institution-edge" || c.group === "clean-edge") &&
        (c.image.validNonblankLines < 6 || (c.image.midpointFraction > .15 && c.image.midpointFraction < .85))) fail("Full-page positional fixture invalid");
    if (c.group === "cropped-org" && (c.image.validNonblankLines < 3 || c.image.validNonblankLines > 5)) fail("Cropped fixture must have 3–5 valid lines");
  }
  const fixtureIds = new Set(registry.fixtures.map(f => f.id));
  if (fixtureIds.size !== registry.fixtures.length) fail("Duplicate correction fixture");
  for (const rule of registry.rules) {
    if (!rule.id || !rule.version || !rule.reason || !rule.fixtureIds.length || rule.fixtureIds.some(id => !fixtureIds.has(id))) fail("Correction rule has no registered fixture");
  }
  for (const pattern of patterns.patterns) {
    if (!pattern.id || !pattern.reason || !pattern.fixtureIds.length || pattern.fixtureIds.some(id => !corpus.cases.some(c => c.id === id))) fail("Institution pattern metadata/fixture missing");
    new RegExp(pattern.pattern, pattern.flags);
  }
  return { worksheets: 10, calibrationLines: 50, correctionFixtures: fixtureIds.size,
    status: "PREPARATION_VALID_NOT_CALIBRATED" };
}

export function canonicalPlanSha256(text) {
  // The authoritative attachment was supplied with CRLF endings. Git stores
  // text as LF and Windows checks it out as CRLF, so hash the canonical CRLF
  // representation while still rejecting every content change.
  const canonicalBytes = Buffer.from(text.replace(/\r\n?|\n/g, "\n").replace(/\n/g, "\r\n"), "utf8");
  return createHash("sha256").update(canonicalBytes).digest("hex");
}

export function checkPlanHash() {
  const text = readFileSync(new URL("docs/p1/PERSONAL_WORD_OCR_PHASE2_IMPLEMENTATION_PLAN.md", root), "utf8");
  const digest = canonicalPlanSha256(text);
  if (digest !== "7bd35176435c104e2966c44f50b22f141d7fb2dfebe7fadb89a44300f8bf798e") throw new Error("Authoritative plan changed");
  return digest;
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};

// Records are human-study evidence, never learner text. Caller must retain separate owner review.
export function evaluateStudy(records) {
  const allowed = new Set(["worksheetId", "mode", "observer", "endpoint", "selectedCount", "expectedCount",
    "localConfirmationMs", "captureToSaveMs", "databaseSaveMs", "actualCameraCapture", "preflightMs", "decodeMs", "fixtureEncodeMs", "resizedEncodeMs",
    "ocrAssetMs", "ocrInitMs", "ocrInferenceMs", "ocrTeardownMs", "nerAssetMs", "nerInitMs", "nerInferenceMs", "nerTeardownMs", "studyRestrictionMs", "toReviewMs"]);
  if (!Array.isArray(records) || records.some(r => !r || typeof r !== "object" ||
      Object.keys(r).some(key => !allowed.has(key)))) throw new Error("Invalid study record shape");
  if (records.some(r => Object.entries(r).some(([key, value]) => key.endsWith("Ms") && value !== null &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0)))) throw new Error("Invalid measurement");
  const pairs = worksheets.map(sheet => ({ sheet,
    ocr: records.filter(r => r.worksheetId === sheet.id && r.mode === "ocr"),
    manual: records.filter(r => r.worksheetId === sheet.id && r.mode === "manual") }));
  const complete = records.length === 20 && pairs.every(p => p.ocr.length === 1 && p.manual.length === 1 &&
    [...p.ocr, ...p.manual].every(r => r.selectedCount === p.sheet.words.length && r.expectedCount === p.sheet.words.length));
  const eligible = complete && records.every(r => r.observer === "human" && r.endpoint === "capture-to-save" &&
    typeof r.captureToSaveMs === "number" && r.captureToSaveMs > 0 &&
    typeof r.databaseSaveMs === "number" && r.databaseSaveMs >= 0 &&
    (r.mode !== "ocr" || r.actualCameraCapture === true));
  const ratio = eligible ? median(pairs.map(p => p.ocr[0].captureToSaveMs)) / median(pairs.map(p => p.manual[0].captureToSaveMs)) : null;
  return { complete, eligible, medianOcrToManualRatio: ratio, threshold: 0.6,
    meetsNumericThreshold: ratio === null ? null : ratio <= 0.6,
    gate: eligible ? "OWNER_REVIEW_REQUIRED" : "INCOMPLETE_OR_NONQUALIFYING_MEASUREMENTS" };
}
