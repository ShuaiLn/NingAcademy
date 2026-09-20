// The pinned JS tokenizer exposes IDs but no offsets. Re-encode complete lexical
// pieces and require exact equality to the *actual* full-line encoding. A mismatch
// is unsafe mapping, never a guessed offset. Subwords retain conservative ranges.
export function mapModelTokens(text: string, fullIds: readonly number[], encode: (text: string) => readonly number[]) {
  const spans: ({ start: number; end: number } | null)[] = [null]; const ids: number[] = [];
  for (const match of text.matchAll(/[\p{L}\p{M}\p{N}]+|[^\s]/gu)) {
    const encoded = encode(match[0]);
    for (const id of encoded) { ids.push(id); spans.push({ start: match.index, end: match.index + match[0].length }); }
  }
  spans.push(null);
  const safe = fullIds.length === ids.length + 2 && ids.every((id, i) => id === fullIds[i + 1]);
  return { safe, spans: safe ? spans : fullIds.map(() => null) };
}
