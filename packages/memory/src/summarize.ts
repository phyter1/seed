/**
 * LLM client for summarization, entity extraction, consolidation, and
 * answer synthesis. Talks to the fleet-router on ren3 (OpenAI-compatible),
 * which picks a local model (gemma4:e4b / gemma4:e2b / qwen3.5-9b) based
 * on the routing rules.
 *
 * All prompts are ported verbatim from rusty-memory-haiku/agent.py.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMClient {
  complete(messages: ChatMessage[]): Promise<string>;
}

export interface LLMClientOptions {
  url?: string;
  model?: string;
  mode?: "single" | "jury";
}

const DEFAULT_URL = "http://ren3.local:3000";
const DEFAULT_MODEL = "auto";

export function createFleetRouterClient(opts: LLMClientOptions = {}): LLMClient {
  const url = opts.url ?? process.env.SEED_LLM_URL ?? DEFAULT_URL;
  const model = opts.model ?? process.env.SEED_LLM_MODEL ?? DEFAULT_MODEL;
  const mode = opts.mode ?? "single";

  return {
    async complete(messages: ChatMessage[]): Promise<string> {
      const body: Record<string, unknown> = { model, messages };
      if (mode === "jury") body.mode = "jury";
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`fleet-router ${res.status}: ${txt}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("fleet-router returned no content");
      return content.trim();
    },
  };
}

// --- Prompts (ported verbatim from agent.py) -----------------------------

export const INGEST_SYSTEM_PROMPT = `You are a Memory Ingest Agent. You process raw text into structured memory.

For any input you receive:
1. Create a concise 1-2 sentence summary
2. Extract key entities (people, companies, products, concepts)
3. Assign 2-4 topic tags
4. Rate importance from 0.0 to 1.0
5. Extract knowledge graph triples: (subject, predicate, object) relationships.
   Each triple has subject/object names, their types (person, technology, project, concept, organization, etc.), and the relationship between them.

Respond ONLY with valid JSON in this exact format:
{
  "summary": "...",
  "entities": ["entity1", "entity2"],
  "topics": ["topic1", "topic2"],
  "importance": 0.7,
  "triples": [
    {"subject": "Project X", "subject_type": "project", "predicate": "uses", "object": "React", "object_type": "technology"}
  ]
}

No other text. Just the JSON object.`;

export const CONSOLIDATE_SYSTEM_PROMPT = `You are a Memory Consolidation Agent. You find patterns and connections across memories.

You will receive a set of memories. Analyze them and:
1. Create a synthesized summary across all memories
2. Identify one key pattern or insight
3. Find connections between memories (pairs that relate to each other)

Respond ONLY with valid JSON in this exact format:
{
  "summary": "synthesized summary across all memories",
  "insight": "one key pattern or insight discovered",
  "connections": [
    {"from_id": 1, "to_id": 2, "relationship": "description of how they connect"}
  ]
}

No other text. Just the JSON object.`;

export const QUERY_SYSTEM_PROMPT = `You are a Memory Query Agent. You answer questions based ONLY on the provided memories.

You will receive a question, a set of memories with their IDs, and optionally a knowledge graph
showing how entities relate to each other. Synthesize an answer using both the memories and
the graph relationships. Reference memory IDs like [Memory #1], [Memory #2].
If no relevant memories exist, say so honestly. Be thorough but concise.`;

// --- Helpers -------------------------------------------------------------

/** Strip markdown code fences and parse JSON. */
export function parseJsonResponse<T = unknown>(text: string): T {
  let t = text.trim();
  if (t.startsWith("```")) {
    const lines = t.split("\n").filter((l) => !l.trim().startsWith("```"));
    t = lines.join("\n").trim();
  }
  return JSON.parse(t) as T;
}
