import type { JurorResponse } from "./types";

/**
 * mlx-vlm response shape. `input_tokens`/`output_tokens` replaced mlx-lm's
 * `prompt_tokens`/`completion_tokens`; mlx-vlm also returns richer
 * throughput/memory telemetry.
 */
interface OpenAIChatResponse {
  id?: string;
  model?: string;
  choices: {
    message: { role: string; content: string };
    finish_reason: string;
  }[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    prompt_tps?: number;
    generation_tps?: number;
    peak_memory?: number;
  };
}

export async function queryMLX(
  host: string,
  model: string,
  prompt: string,
  options: { temperature?: number; timeoutMs?: number; enableThinking?: boolean } = {}
): Promise<JurorResponse> {
  const { temperature = 0.7, timeoutMs = 30000, enableThinking } = options;
  const start = Date.now();
  const nodeName = host.split(":")[0].split(".")[0];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: 512,
    };
    if (enableThinking !== undefined) body.enable_thinking = enableThinking;

    const res = await fetch(`http://${host}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`MLX ${host} returned ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as OpenAIChatResponse;
    const durationMs = Date.now() - start;
    const totalTokens = data.usage?.output_tokens ?? 0;
    const tokensPerSecond = durationMs > 0 ? (totalTokens / durationMs) * 1000 : 0;

    return {
      node: nodeName,
      model,
      response: data.choices[0]?.message?.content?.trim() ?? "",
      tokensPerSecond: Math.round(tokensPerSecond * 100) / 100,
      totalTokens,
      durationMs,
    };
  } catch (err) {
    return {
      node: nodeName,
      model,
      response: "",
      tokensPerSecond: 0,
      totalTokens: 0,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function queryMLXChat(
  host: string,
  model: string,
  messages: { role: string; content: string }[],
  options: { temperature?: number; timeoutMs?: number; maxTokens?: number; enableThinking?: boolean } = {}
): Promise<JurorResponse> {
  const { temperature = 0.7, timeoutMs = 30000, maxTokens = 512, enableThinking } = options;
  const start = Date.now();
  const nodeName = host.split(":")[0].split(".")[0];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (enableThinking !== undefined) body.enable_thinking = enableThinking;

    const res = await fetch(`http://${host}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`MLX ${host} returned ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as OpenAIChatResponse;
    const durationMs = Date.now() - start;
    const totalTokens = data.usage?.output_tokens ?? 0;
    const tokensPerSecond = durationMs > 0 ? (totalTokens / durationMs) * 1000 : 0;

    return {
      node: nodeName,
      model,
      response: data.choices[0]?.message?.content?.trim() ?? "",
      tokensPerSecond: Math.round(tokensPerSecond * 100) / 100,
      totalTokens,
      durationMs,
    };
  } catch (err) {
    return {
      node: nodeName,
      model,
      response: "",
      tokensPerSecond: 0,
      totalTokens: 0,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function listMLXModels(host: string): Promise<string[]> {
  try {
    const res = await fetch(`http://${host}/v1/models`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((m: { id: string }) => m.id);
  } catch {
    return [];
  }
}
