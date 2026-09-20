import type { Box, NormalizedLine, NormalizedSpanMapEntry, OcrWord } from "./contracts";

export function validConfidence(value: number) { return Number.isFinite(value) && value >= 0 && value <= 100; }
export function validBox(box: Box, image: { width: number; height: number }) {
  return !!box && [box.x0, box.y0, box.x1, box.y1, image.width, image.height].every(Number.isFinite)
    && image.width > 0 && image.height > 0 && box.x0 >= 0 && box.y0 >= 0
    && box.x1 > box.x0 && box.y1 > box.y0 && box.x1 <= image.width && box.y1 <= image.height;
}

export function normalizeLine(input: Omit<NormalizedLine, "text" | "map" | "mappingSafe">): NormalizedLine {
  const map: NormalizedSpanMapEntry[] = []; let text = ""; let safe = true; let previous = 0;
  const ids = new Set<string>();
  for (const word of input.words) {
    if (ids.has(word.id) || !word.id || !Number.isInteger(word.start) || !Number.isInteger(word.end)
      || word.start < previous || word.end <= word.start || word.end > input.original.length
      || input.original.slice(word.start, word.end) !== word.text) safe = false;
    ids.add(word.id); previous = word.end;
  }
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  for (const part of segmenter.segment(input.original)) {
    const originalStart = part.index, originalEnd = part.index + part.segment.length;
    const wordIds = input.words.filter(w => w.start < originalEnd && w.end > originalStart).map(w => w.id);
    const normalized = part.segment.normalize("NFKC").replace(/\s+/gu, " ");
    if (normalized !== " " && (!wordIds.length || wordIds.length > 1)) safe = false;
    for (const character of normalized) {
      if (character === " " && (!text.length || text.endsWith(" "))) {
        if (text.endsWith(" ")) {
          const last = map.pop()!;
          map.push({ ...last, originalEnd, wordIds: [...new Set([...last.wordIds, ...wordIds])] });
        }
        continue;
      }
      map.push({ start: text.length, end: text.length + character.length, originalStart, originalEnd, wordIds });
      text += character;
    }
  }
  if (text.endsWith(" ")) { text = text.slice(0, -1); map.pop(); }
  if (text !== input.original.normalize("NFKC").replace(/\s+/gu, " ").trim()) safe = false;
  return Object.freeze({ ...input, text, map: Object.freeze(map), mappingSafe: safe });
}

export function mapSpan(line: NormalizedLine, start: number, end: number) {
  if (!line.mappingSafe || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > line.text.length) return null;
  const entries = line.map.filter(entry => entry.start < end && entry.end > start);
  if (!entries.length || entries[0].start !== start || entries.at(-1)!.end !== end) return null;
  return { start: entries[0].originalStart, end: entries.at(-1)!.originalEnd,
    wordIds: [...new Set(entries.flatMap(entry => entry.wordIds))] };
}

export interface RecognizedLine { text: string; confidence: number; bbox: Box; words: { text: string; confidence: number; bbox: Box }[] }
export function constructLines(lines: readonly RecognizedLine[], image: { width: number; height: number }): NormalizedLine[] {
  return lines.map((line, index) => {
    // Match sequentially against the actual OCR line. Never synthesize a different line.
    let cursor = 0; const words: OcrWord[] = line.words.map((word, wi) => {
      const start = line.text.indexOf(word.text, cursor);
      if (start >= 0) cursor = start + word.text.length;
      return { id: `l${index}:w${wi}`, text: word.text, confidence: word.confidence, box: word.bbox,
        start, end: start + word.text.length };
    });
    return normalizeLine({ id: `l${index}`, original: line.text, words, confidence: line.confidence, box: line.bbox, image });
  });
}
