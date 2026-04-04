import type { EmbedClient } from "./embed";
import type { ChatMessage, LLMClient } from "./summarize";

/** Deterministic embedder: hashes text into a 384-dim unit vector. */
export function createFakeEmbedder(): EmbedClient {
  return {
    async embed(text: string): Promise<number[]> {
      const vec = new Array<number>(384).fill(0);
      let h1 = 0x811c9dc5;
      let h2 = 0xcbf29ce4;
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x100000001b3 & 0xffffffff) >>> 0;
      }
      // Spread bits across 384 dims deterministically
      for (let i = 0; i < 384; i++) {
        const s = ((h1 + i * 2654435761) ^ (h2 + i * 40503)) >>> 0;
        vec[i] = ((s & 0xffff) / 0xffff) * 2 - 1;
      }
      // Normalize to unit length
      let mag = 0;
      for (const v of vec) mag += v * v;
      mag = Math.sqrt(mag);
      if (mag > 0) {
        for (let i = 0; i < 384; i++) vec[i]! /= mag;
      }
      return vec;
    },
  };
}

/** Scriptable LLM: returns canned responses based on the system prompt. */
export interface FakeLLMScript {
  /** Response for ingest-style prompts. */
  ingest?: {
    summary: string;
    entities: string[];
    topics: string[];
    importance: number;
    triples?: Array<{
      subject: string;
      subject_type?: string;
      predicate: string;
      object: string;
      object_type?: string;
    }>;
  };
  /** Response for consolidate-style prompts. */
  consolidate?: {
    summary: string;
    insight: string;
    connections?: Array<{ from_id: number; to_id: number; relationship: string }>;
  };
  /** Response for query prompts (plain text answer). */
  query?: string;
  /**
   * Responses for evaluate prompts (deep query). Consumed in order; when
   * exhausted, falls back to returning `{"sufficient": true}`.
   */
  evaluate?: Array<{
    sufficient: boolean;
    reason?: string;
    refined_query?: string;
    explore_entities?: string[];
  }>;
  /** Override: return this exact string for any call. */
  raw?: string;
  /** Track calls for assertions. */
  calls?: ChatMessage[][];
}

export function createFakeLLM(script: FakeLLMScript): LLMClient {
  script.calls = script.calls ?? [];
  return {
    async complete(messages: ChatMessage[]): Promise<string> {
      script.calls!.push(messages);
      if (script.raw !== undefined) return script.raw;
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      if (system.includes("Memory Ingest Agent") && script.ingest) {
        return JSON.stringify(script.ingest);
      }
      if (system.includes("Memory Consolidation Agent") && script.consolidate) {
        return JSON.stringify(script.consolidate);
      }
      if (system.includes("Memory Query Agent") && script.query !== undefined) {
        return script.query;
      }
      if (system.includes("Retrieval Evaluator")) {
        const next = script.evaluate?.shift();
        return JSON.stringify(next ?? { sufficient: true });
      }
      return "{}";
    },
  };
}
