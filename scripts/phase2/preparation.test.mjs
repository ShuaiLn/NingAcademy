import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { worksheets, calibration, corrections, institutions, validatePreparation, checkPlanHash, canonicalPlanSha256, evaluateStudy } from "./preparation.mjs";

test("final plan stays canonical-content-identical across Git line endings and revised corpus remains exact", () => {
  const plan = readFileSync(new URL("../../docs/p1/PERSONAL_WORD_OCR_PHASE2_IMPLEMENTATION_PLAN.md", import.meta.url), "utf8");
  assert.equal(canonicalPlanSha256(plan.replace(/\r\n/g, "\n")), calibration.sourcePlanSha256);
  assert.equal(canonicalPlanSha256(plan.replace(/\r\n?|\n/g, "\r\n")), calibration.sourcePlanSha256);
  assert.notEqual(canonicalPlanSha256(`${plan}\nchanged`), calibration.sourcePlanSha256);
  assert.equal(checkPlanHash(), calibration.sourcePlanSha256);
  assert.equal(validatePreparation().calibrationLines, 50);
});
test("missing, duplicate and misallocated lines fail closed", () => {
  const copy = structuredClone(calibration); copy.cases[0].group = "clean-edge";
  assert.throws(() => validatePreparation(worksheets, copy));
  copy.cases.pop(); assert.throws(() => validatePreparation(worksheets, copy));
  assert.throws(() => validatePreparation(worksheets.slice(1)));
});
test("unregistered correction rules and institution fixtures are rejected", () => {
  const copy = structuredClone(corrections); copy.rules[0].fixtureIds = ["missing"];
  assert.throws(() => validatePreparation(worksheets, calibration, copy));
  const pattern = structuredClone(institutions); pattern.patterns[0].fixtureIds = [];
  assert.throws(() => validatePreparation(worksheets, calibration, corrections, pattern));
});
test("geometry fixtures honor six-line gate and cropped allocation", () => {
  const copy = structuredClone(calibration); copy.cases[0].image.validNonblankLines = 5;
  assert.throws(() => validatePreparation(worksheets, copy));
});
test("local confirmation or automated typing cannot close product-value gate", () => {
  const records = worksheets.flatMap(sheet => ["ocr", "manual"].map(mode => ({
    worksheetId: sheet.id, mode, observer: "human", endpoint: "local-confirmation",
    selectedCount: sheet.words.length, expectedCount: sheet.words.length, localConfirmationMs: mode === "ocr" ? 30 : 100,
    databaseSaveMs: null,
  })));
  assert.equal(evaluateStudy(records).eligible, false);
  assert.equal(evaluateStudy(records).medianOcrToManualRatio, null);
});
test("numeric speed threshold is 60%, never implicit owner approval", () => {
  const records = worksheets.flatMap(sheet => ["ocr", "manual"].map(mode => ({
    worksheetId: sheet.id, mode, observer: "human", endpoint: "capture-to-save", actualCameraCapture: true,
    selectedCount: sheet.words.length, expectedCount: sheet.words.length,
    captureToSaveMs: mode === "ocr" ? 60 : 100, databaseSaveMs: 5,
  })));
  assert.equal(evaluateStudy(records).meetsNumericThreshold, true);
  assert.equal(evaluateStudy(records).gate, "OWNER_REVIEW_REQUIRED");
  records[0].captureToSaveMs = 90; records[2].captureToSaveMs = 90; records[4].captureToSaveMs = 90;
  records[6].captureToSaveMs = 90; records[8].captureToSaveMs = 90; records[10].captureToSaveMs = 90;
  assert.equal(evaluateStudy(records).meetsNumericThreshold, false);
  records[0].observer = "automated"; assert.equal(evaluateStudy(records).eligible, false);
});
test("nonfinite measurements and content-bearing extra fields are rejected", () => {
  assert.throws(() => evaluateStudy([{ localConfirmationMs: NaN }]));
  assert.throws(() => evaluateStudy([{ rawOcrText: "private" }]));
});
