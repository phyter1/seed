/**
 * Extract the first valid JSON object or array from messy LLM output.
 *
 * Handles several common failure modes:
 *   - `<think>...</think>` reasoning preambles (stripped first)
 *   - Markdown code fences (```json, ```, ````json, etc.) around the payload
 *   - Prose before and after the JSON
 *   - Nested objects and arrays (via string-aware brace counting)
 *
 * Returns `null` when no valid JSON can be extracted. Does not attempt to
 * recover from a malformed first candidate — if the first balanced-brace
 * window fails to parse, gives up. Ported from the Python implementation
 * at existential/engine/lexbox/utils.py with the same semantics and tests.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function extractJson(text: string): JsonValue | null {
  if (!text) return null;

  // Step 1: strip <think>...</think> tags (DOTALL).
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");

  // Step 2: strip markdown code fences, keep content inside.
  //   matches ```, ````, etc. with optional `json`/`JSON` language tag
  //   and optional trailing whitespace + newline.
  cleaned = cleaned.replace(/`{3,}(?:json|JSON)?\s*\n?/g, "");

  // Step 3: find the first { or [.
  const startMatch = cleaned.search(/[{[]/);
  if (startMatch === -1) return null;

  // Step 4: brace-count to find the matching close, string-aware.
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startMatch; i < cleaned.length; i++) {
    const c = cleaned[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"' && !escape) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{" || c === "[") {
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        const candidate = cleaned.slice(startMatch, i + 1);
        try {
          return JSON.parse(candidate) as JsonValue;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}
