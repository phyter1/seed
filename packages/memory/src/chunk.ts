/**
 * Recursive character text splitter. Splits on paragraphs, then sentences,
 * then words. Ported from agent.py's chunk_text.
 */

export const CHUNK_SIZE = 800;
export const CHUNK_OVERLAP = 160;
export const CHUNK_THRESHOLD = 1200;

export function chunkText(
  text: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP
): string[] {
  if (text.length <= CHUNK_THRESHOLD) return [text];

  const separators = ["\n\n", "\n", ". ", " "];

  function split(t: string, sepIdx: number = 0): string[] {
    if (sepIdx >= separators.length || t.length <= chunkSize) {
      return t.trim() ? [t] : [];
    }
    const sep = separators[sepIdx]!;
    const parts = t.split(sep);
    let current = "";
    const result: string[] = [];
    for (const part of parts) {
      const candidate = current ? current + sep + part : part;
      if (candidate.length <= chunkSize) {
        current = candidate;
      } else {
        if (current) result.push(current);
        if (part.length > chunkSize) {
          result.push(...split(part, sepIdx + 1));
          current = "";
        } else {
          current = part;
        }
      }
    }
    if (current.trim()) result.push(current);
    return result;
  }

  const rawChunks = split(text);
  const chunks: string[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    let chunk = rawChunks[i]!;
    if (i > 0 && overlap > 0) {
      const prev = rawChunks[i - 1]!;
      let overlapText = prev.length > overlap ? prev.slice(-overlap) : prev;
      const spaceIdx = overlapText.indexOf(" ");
      if (spaceIdx > 0) overlapText = overlapText.slice(spaceIdx + 1);
      chunk = overlapText + " " + chunk;
    }
    chunks.push(chunk.trim());
  }
  return chunks.filter((c) => c.length > 0);
}
