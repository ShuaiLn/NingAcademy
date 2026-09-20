import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { constructLines, mapSpan, normalizeLine } from "./normalization";
import { classifyLineDisposition, computeLineSignals, countStructurallyValidNonblankLines } from "./policy";
import { correctEntities } from "./corrections";
import { EnglishDictionary } from "./dictionary";
import { extractReview } from "./candidates";
import { textHasObviousPii } from "./stage1";
import { mapModelTokens } from "./token-spans";
import { normalizePersonalTerm, validateConfirmation } from "./validation";
import { nerBatches } from "./pipeline";
import fixtures from "../../../docs/personalized-english/phase2/correction-fixtures.v1.json";
import labels from "../../../docs/personalized-english/phase2/sensitive-labels.v1.json";
import holdout from "../../../docs/personalized-english/phase2/privacy-holdout.v1.json";
import runtimeProfile from "../../../docs/personalized-english/phase2/runtime-profile.v1.json";
import governedLiterals from "../../../scripts/phase2/policy-test-literals.generated.json";
import { PHASE2_LIMITS } from "../local-ai/phase2-limits.generated";
import type { NerLineEvidence } from "../local-ai/models/ner-lines";
const dictionary = new EnglishDictionary(readFileSync("public/local-ai-assets/dictionary/frequencywords-v1/words.utf8"), readFileSync("public/local-ai-assets/dictionary/frequencywords-v1/offsets.u32le"));
const lookup = (word: string) => dictionary.lookup(word);
function line(text: string, y = 40) {
  return constructLines([{ text, confidence: 95, bbox: { x0: 0, y0: y, x1: 100, y1: y + 10 }, words: [...text.matchAll(/\S+/gu)].map(match =>
    ({ text: match[0], confidence: 95, bbox: { x0: 0, y0: y, x1: 100, y1: y + 10 } })) }], { width: 100, height: 100 })[0];
}
const evidence = (tokens: NerLineEvidence["tokens"] = []): NerLineEvidence => ({ id: "l0", didRun: true, nerRequired: true, reason: null, encodedLength: 10, mappingSafe: true, tokens });
function classify(text: string, tokens: NerLineEvidence["tokens"] = [], count = 6, y = 40) {
  const item = line(text, y); return classifyLineDisposition(computeLineSignals(item, evidence(tokens), count, lookup));
}
const person = (start: number, end: number) => ({ tokenIndex: 1, start, end, label: "B-PERSON", score: 0.99 });
describe("reversible normalization and geometry", () => {
  it("maps NFKC ligatures and collapsed tabs to original OCR words", () => {
    const item = line("oﬃce\t  supplies"); expect(item.text).toBe("office supplies"); expect(item.mappingSafe).toBe(true);
    expect(mapSpan(item, 0, 6)).toEqual({ start: 0, end: 4, wordIds: ["l0:w0"] });
    expect(mapSpan(item, 6, 7)).toEqual({ start: 4, end: 7, wordIds: [] });
  });
  it("maps composed graphemes, full width and surrogate pairs", () => {
    for (const value of ["e\u0301", "Ｍicrosoft", "😀", "ﬃ"]) expect(line(value).mappingSafe).toBe(true);
    expect(mapSpan(line("😀"), 0, 1)).toBeNull();
    expect(mapSpan(line("word"), -1, 3)).toBeNull();
  });
  it("rejects uncovered non-whitespace and inconsistent word order", () => {
    const item = line("one two");
    expect(normalizeLine({ ...item, words: [...item.words].reverse() }).mappingSafe).toBe(false);
    expect(normalizeLine({ ...item, words: item.words.slice(1) }).mappingSafe).toBe(false);
  });
  it.each([NaN, Infinity, -1, 101])("invalid line confidence %s rejects the line", confidence => {
    const item = { ...line("read"), confidence };
    expect(classifyLineDisposition(computeLineSignals(item, evidence(), 6, lookup)).reason).toBe("invalid_line_confidence");
  });
  it("invalid line geometry rejects but invalid word geometry only hides that candidate", () => {
    const item = line("read write");
    const invalid = { ...item, box: { ...item.box, x1: 101 } };
    expect(classifyLineDisposition(computeLineSignals(invalid, evidence(), 6, lookup)).reason).toBe("invalid_line_geometry");
    const word = { ...item, words: [{ ...item.words[0], confidence: NaN }, { ...item.words[1], box: { ...item.words[1].box, x1: 101 } }] };
    expect(extractReview([{ line: word, decision: classify("read write") }], lookup).candidates).toHaveLength(0);
  });
});
describe("mandatory complete privacy policy", () => {
  it("counts an oversized but structurally valid sixth line for the positional privacy gate", () => {
    for (const edgeY of [0, 90]) {
      const lines = [line("Acme Academy", edgeY), line("read", 20), line("write", 35), line("book", 50), line("lesson", 65), line("a".repeat(2001), 80)];
      const validNonblankLineCount = countStructurallyValidNonblankLines(lines);
      expect(validNonblankLineCount).toBe(6);
      expect(classifyLineDisposition(computeLineSignals(lines[0], evidence(), validNonblankLineCount, lookup)).reason)
        .toBe("header_footer_institution");
    }
  });
  it.each(labels.labels)("whole-line high-risk label %s", label => expect(classify(label + ": John Smith / Costco Wholesale").reason).toBe("deterministic_high_risk_pii"));
  it.each(["learner@example.invalid", "+1 555-123-4567", "Member ID: A123", "DOB: 2000-01-01", "https://example.invalid/users/alex", "123 Main Street"])("formatted PII %s", text => expect(textHasObviousPii(text)).toBe(true));
  it("Employee never recovers right-hand candidates", () => expect(classify("Employee: John Smith / Costco Wholesale", [person(10,20)]).disposition).toBe("never_offer"));
  it("PERSON delimiter preserves safe right-side words without sanitizedText", () => {
    const item = line("Maria Garcia | complete the workplace safety checklist");
    const decision = classify(item.text, [person(0,12)]);
    expect(decision.reason).toBe("person_segment_removed");
    const review = extractReview([{ line: item, decision }], lookup);
    expect(review.safeWords).toEqual(["complete", "the", "workplace", "safety", "checklist"]); expect(review.sanitizedText).toBe("");
    expect(JSON.stringify(review)).not.toMatch(/Maria|Garcia|rawEvidence|original|tokenIndex/);
  });
  it.each(["/", "|", "\t", ";"])("PERSON stops at delimiter %s", delimiter => {
    const original = `Maria Garcia ${delimiter} read the book`;
    const item = line(original); const decision = classifyLineDisposition(computeLineSignals(item, evidence([person(0,12)]),6,lookup));
    expect(extractReview([{ line:item, decision }],lookup).safeWords).toEqual(["read","the","book"]);
  });
  it("four-word exhaustion rejects line, line boundary permits word_only", () => {
    expect(classify("Maria reads the book in class today", [person(0,5)]).reason).toBe("person_boundary_uncertain");
    expect(classify("Maria reads the book", [person(0,5)]).disposition).toBe("word_only");
  });
  it("bare entities are equivalent and not an allowlist", () => {
    expect(classify("Costco").reason).toBe("public_entity_only");
    expect(classify("Acme", [{ ...person(0,4), label: "B-ORG" }]).reason).toBe("public_entity_only");
    expect(classify("Email: Costco").reason).toBe("deterministic_high_risk_pii");
  });
  it("CJK dominates before Latin extraction; unknown single words do not block", () => {
    expect(classify("这是中文教学内容 read").reason).toBe("non_target_script");
    expect(classify("qzxqzx").disposition).toBe("full_offer");
    expect(classify("qzxqzx qzxzx qzzxq qxxzz zzzqq").reason).toBe("non_english_latin_low_match");
    expect(classify("qzxqzx qzxzx qzzxq qxxzz").disposition).toBe("full_offer");
  });
  it("missing mandatory NER aborts import, token overflow is line-local", () => {
    const item=line("read");
    expect(() => classifyLineDisposition(computeLineSignals(item,{...evidence(),didRun:false},6,lookup))).toThrow();
    expect(classifyLineDisposition(computeLineSignals(item,{...evidence(),didRun:false,nerRequired:false,reason:"ner_input_too_large"},6,lookup)).reason).toBe("ner_input_too_large");
  });
  it("complete signals are computed even when Stage 1 wins", () => {
    const input=computeLineSignals(line("Name: Maria Microsoft",5),evidence([person(6,21)]),6,lookup);
    expect(input.stage1).toBe(true); expect(input.corrected.ambiguous).toBe(true); expect(input.positionalInstitution).toBe(true);
    expect(classifyLineDisposition(input).reason).toBe("deterministic_high_risk_pii");
  });
});
describe("every registered correction/institution fixture", () => {
  for (const fixture of fixtures.fixtures) it(fixture.id, () => {
    if ("lineCount" in fixture) { expect(classify(fixture.text,[],fixture.lineCount!,fixture.y!).reason).toBe(fixture.expected); return; }
    const item=line(fixture.text);
    if(fixture.expected==="mapped") { expect(item.mappingSafe).toBe(true); return; }
    const tokens = fixture.tokens?.map((token,index)=>({...token,tokenIndex:index+1,score:0.9})) ?? (fixture.label ? [{label:fixture.label,start:fixture.start!,end:fixture.end!,tokenIndex:1,score:0.9}] : []);
    const before=JSON.stringify(tokens); const result=correctEntities(item.text,evidence(tokens));
    expect(JSON.stringify(tokens)).toBe(before); expect(Object.isFrozen(result.raw)).toBe(true);
    if(fixture.expected==="ambiguous") expect(result.ambiguous).toBe(true);
    else if(fixture.expected==="empty") expect(result.entities).toHaveLength(0);
    else { expect(result.entities[0].label).toBe("ORG"); expect(result.entities[0].correction.id).toBe("organization-exact-v1");
      expect(result.entities[0].correction.reason).toBeTruthy(); expect(Object.isFrozen(result.entities[0])).toBe(true);
      if (["relabel", "omitted-addition", "split-merge"].includes(fixture.id))
        expect(result.entities[0].correction.operation).toBe(fixture.id);
      if(tokens.length) expect(result.entities[0].rawEvidence.length).toBeGreaterThan(0); }
  });
});
describe("300-case synthetic policy holdout dry run", () => {
  it("meets the unchanged release thresholds at policy level", () => {
    const observations = [...holdout.sensitive, ...holdout.clean].map(item => {
      const y = item.image.midpointFraction * 100 - 5;
      const normalized = line(item.text, y);
      const decision = classifyLineDisposition(computeLineSignals(normalized, evidence(), item.image.validNonblankLines, lookup));
      const review = extractReview([{ line: normalized, decision }], lookup);
      return { id: item.id, disposition: decision.disposition, reason: decision.reason,
        safeWords: review.safeWords.map(word => word.toLowerCase()) };
    });
    const byId = new Map(observations.map(item => [item.id, item]));
    const sensitiveBlocked = holdout.sensitive.filter(item => byId.get(item.id)?.disposition === "never_offer").length;
    const falseSuppressed = holdout.clean.filter(item => byId.get(item.id)?.disposition === "never_offer").length;
    const personSuppressed = holdout.clean.filter(item => byId.get(item.id)?.reason.startsWith("person_")).length;
    const expected = holdout.clean.flatMap(item => item.teachingTerms);
    const recalled = holdout.clean.reduce((total, item) => total + item.teachingTerms.filter(term => byId.get(item.id)?.safeWords.includes(term)).length, 0);
    const p = sensitiveBlocked / 150, z = 1.959963984540054;
    const wilson = (p + z*z/(2*150) - z*Math.sqrt((p*(1-p)+z*z/(4*150))/150))/(1+z*z/150);
    expect(sensitiveBlocked).toBeGreaterThanOrEqual(148);
    expect(wilson).toBeGreaterThanOrEqual(0.95);
    expect(falseSuppressed / 150).toBeLessThanOrEqual(0.15);
    expect(recalled / expected.length).toBeGreaterThanOrEqual(0.75);
    expect(personSuppressed / 150).toBeLessThanOrEqual(0.03);
  });
});
describe("dictionary, confidence, batching and payload boundary", () => {
  it("consumes the generated governed limits, runtime profile, morphology, and fixture registry", () => {
    expect(governedLiterals.limits).toEqual(PHASE2_LIMITS);
    expect(governedLiterals.runtimeProfile).toEqual(runtimeProfile);
    expect(governedLiterals.fixtureIds).toEqual(fixtures.fixtures.map(fixture => fixture.id));
    expect(governedLiterals.morphology.rules.map(rule => rule.suffix)).toEqual(["'s", "ies", "s", "es", "ing", "ed", "er", "est"]);
  });
  it.each(governedLiterals.normalizationParity)("matches PostgreSQL normalize_spelling: $label", fixture => {
    expect(normalizePersonalTerm(fixture.input)).toBe(fixture.expected);
  });
  it("uses the exact candidate and morphology without blocking unknowns", () => {
    expect(lookup("book")).toBe("known"); expect(lookup("qzxqzx")).toBe("unknown");
    expect(lookup("photosynthesis's")).toBe("known_inflected");
  });
  it.each([[95,"read",true,"normal"],[95,"qzxqzx",false,"possible_typo"],[85,"read",false,"confirm"],[20,"read",false,"must_review"]] as const)("confidence %s %s", (confidence,term,selected,state)=> {
    const item=line(term); const review=extractReview([{line:{...item,words:item.words.map(word=>({...word,confidence}))},decision:classify(term)}],lookup);
    expect(review.candidates[0]).toMatchObject({selected,state});
  });
  it("batches 100 lines / 50K characters and skips oversize before tokenization", () => {
    const lines=Array.from({length:101},(_,i)=>({...line("read"),id:String(i)})); expect(nerBatches(lines).map(batch=>batch.length)).toEqual([100,1]);
    expect(nerBatches([line("a".repeat(2001))])).toEqual([]);
    expect(nerBatches(Array.from({length:30},(_,i)=>({...line("a".repeat(2000)),id:String(i)}))).map(batch=>batch.length)).toEqual([25,5]);
  });
  it("token mapping validates actual full IDs and rejects ambiguous tokenization", () => {
    expect(mapModelTokens("read book",[101,1,2,102],word=>word==="read"?[1]:[2]).safe).toBe(true);
    expect(mapModelTokens("read book",[101,7,2,102],word=>word==="read"?[1]:[2]).safe).toBe(false);
  });
  it("application boundary allows only confirmed fields and DB character lengths", () => {
    const id="42000000-0000-0000-0000-000000000001";
    expect(validateConfirmation(id,[{term:"word",meaning:"😀".repeat(1000)}])).not.toBeNull();
    for (const words of [[],[{term:"word",raw:"no"}],[{term:"word"},{term:" WORD "}],[{term:"word",meaning:"Name: John"}],[{term:"a".repeat(101)}],[{term:"word",meaning:"\ud800"}]]) expect(validateConfirmation(id,words)).toBeNull();
    expect(validateConfirmation(id, [{ term: "word", meaning: "\t\n", exampleSentence: "\r\n" }]))
      .toEqual([{ term: "word", meaning: null, exampleSentence: null }]);
  });
});
