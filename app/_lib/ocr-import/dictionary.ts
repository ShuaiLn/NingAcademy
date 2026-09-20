import morphology from "../../../docs/personalized-english/phase2/morphology.v1.json";
export type DictionaryMatch = "known" | "known_inflected" | "unknown";
type MorphologyRule =
  | { kind: "strip"; suffix: string; minimumStemLength: number }
  | { kind: "replace"; suffix: string; replacement: string; minimumStemLength: number }
  | { kind: "stem_variants"; suffix: string; minimumStemLength: number };
export class EnglishDictionary {
  private readonly offsets: DataView;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  constructor(private readonly bytes: Uint8Array, offsets: Uint8Array) {
    if (offsets.byteLength < 8 || offsets.byteLength % 4) throw new Error("Invalid dictionary");
    this.offsets = new DataView(offsets.buffer, offsets.byteOffset, offsets.byteLength);
    let previous = -1, last = "";
    for (let i = 0; i < offsets.byteLength / 4; i++) {
      const value = this.offsets.getUint32(i * 4, true);
      if (value <= previous || value > bytes.length || (i === 0 && value !== 0)) throw new Error("Invalid dictionary offsets");
      if (i) {
        const word = this.decoder.decode(bytes.subarray(previous, value - 1));
        if (bytes[value - 1] !== 10 || !/^[a-z]+(?:['-][a-z]+)*$/.test(word) || word <= last) throw new Error("Invalid dictionary order");
        last = word;
      }
      previous = value;
    }
    if (previous !== bytes.length) throw new Error("Invalid dictionary end");
  }
  private contains(word: string) {
    let low = 0, high = this.offsets.byteLength / 4 - 2;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const entry = this.decoder.decode(this.bytes.subarray(this.offsets.getUint32(mid * 4, true), this.offsets.getUint32((mid + 1) * 4, true) - 1));
      if (entry === word) return true;
      if (entry < word) low = mid + 1; else high = mid - 1;
    }
    return false;
  }
  lookup(input: string): DictionaryMatch {
    const word = input.normalize("NFKC").toLowerCase().replaceAll("’", "'");
    if (this.contains(word)) return "known";
    const bases: string[] = [];
    const irregular = (morphology.irregulars as Record<string, string>)[word];
    if (irregular) bases.push(irregular);
    for (const rule of morphology.rules as readonly MorphologyRule[]) {
      if (!word.endsWith(rule.suffix)) continue;
      const stem = word.slice(0, -rule.suffix.length);
      if (stem.length < rule.minimumStemLength) continue;
      if (rule.kind === "replace") bases.push(stem + rule.replacement);
      else if (rule.kind === "strip") bases.push(stem);
      else {
        bases.push(stem, stem + "e");
        if (/([b-df-hj-np-tv-z])\1$/.test(stem)) bases.push(stem.slice(0, -1));
        if (stem.endsWith("i")) bases.push(stem.slice(0, -1) + "y");
      }
    }
    return bases.some(base => this.contains(base)) ? "known_inflected" : "unknown";
  }
}
