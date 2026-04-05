/**
 * Embedding client. Calls ollama's qwen3-embedding:0.6b model to produce
 * 1024-dim embeddings. On the memory host (ren1) this is a localhost call.
 *
 * Model is kept warm on ren1 via OLLAMA_KEEP_ALIVE=-1, so latency is ~20ms
 * after the first call.
 */
export interface EmbedClient {
  embed(text: string): Promise<number[]>;
}

export interface OllamaEmbedOptions {
  url?: string;
  model?: string;
  /** keep_alive value passed to Ollama. -1 keeps forever, "10m" etc. */
  keepAlive?: string | number;
}

const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "qwen3-embedding:0.6b";

export function createOllamaEmbedClient(opts: OllamaEmbedOptions = {}): EmbedClient {
  const url = opts.url ?? process.env.SEED_EMBED_URL ?? DEFAULT_URL;
  const model = opts.model ?? process.env.SEED_EMBED_MODEL ?? DEFAULT_MODEL;
  const keepAlive = opts.keepAlive ?? -1;

  return {
    async embed(text: string): Promise<number[]> {
      // Trim to 1000 chars to match the Python implementation.
      const prompt = text.slice(0, 1000);
      const res = await fetch(`${url}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, keep_alive: keepAlive }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`ollama embed ${res.status}: ${body}`);
      }
      const data = (await res.json()) as { embedding?: number[] };
      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new Error("ollama embed response missing 'embedding' array");
      }
      return data.embedding;
    },
  };
}
