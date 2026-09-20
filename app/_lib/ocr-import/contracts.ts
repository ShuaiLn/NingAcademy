export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface OcrWord {
  readonly id: string; readonly text: string; readonly confidence: number;
  readonly box: Box; readonly start: number; readonly end: number;
}
export interface NormalizedSpanMapEntry {
  readonly start: number; readonly end: number;
  readonly originalStart: number; readonly originalEnd: number;
  readonly wordIds: readonly string[];
}
export interface NormalizedLine {
  readonly id: string; readonly original: string; readonly text: string;
  readonly words: readonly OcrWord[]; readonly map: readonly NormalizedSpanMapEntry[];
  readonly confidence: number; readonly box: Box;
  readonly image: { width: number; height: number }; readonly mappingSafe: boolean;
}
export type Disposition = "never_offer" | "word_only" | "full_offer";
export interface LineDispositionResult {
  readonly disposition: Disposition; readonly reason: string; readonly suppressedWordIds: readonly string[];
}
export interface ReviewCandidate {
  readonly id: string; readonly term: string; readonly confidence: number;
  readonly dictionary: "known" | "known_inflected" | "unknown";
  readonly state: "normal" | "confirm" | "must_review" | "possible_typo";
  readonly selected: boolean; readonly disposition: "word_only" | "full_offer";
  readonly exampleSentence: string | null;
}
// This is the only result allowed to cross into React state. No raw OCR/NER/maps.
export interface ReviewResult {
  readonly candidates: readonly ReviewCandidate[]; readonly safeWords: readonly string[];
  readonly sanitizedText: string; readonly removedLineCount: number;
}
export interface ConfirmedWord { term: string; meaning: string | null; exampleSentence: string | null }
export type ImportStage = "checking" | "decoding" | "ocr" | "ner" | "privacy";
