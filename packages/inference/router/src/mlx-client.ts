import type { JurorResponse } from "./types.js";

const MLX_DEFAULT_HOST = "Ryans-MacBook-Pro.local:8080";

interface OpenAIChatResponse {
  id: string;
  choices: {
    message: { role: string; content: string };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function queryMLX(
  host: string,
  model: string,
  prompt: string,
  options: { temperature?: number; timeoutMs?: number } = {}
): Promise<JurorResponse> {
  const { temperature = 0.7, timeoutMs = 30000 } = options;
  const start = Date.now();
  const nodeName = host.split(":")[0].split(".")[0];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`http://${host}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: 512,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`MLX ${host} returned ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as OpenAIChatResponse;
    const durationMs = Date.now() - start;
    const totalTokens = data.usage?.completion_tokens ?? 0;
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
  options: { temperature?: number; timeoutMs?: number; maxTokens?: number } = {}
): Promise<JurorResponse> {
  const { temperature = 0.7, timeoutMs = 30000, maxTokens = 512 } = options;
  const start = Date.now();
  const nodeName = host.split(":")[0].split(".")[0];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`http://${host}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`MLX ${host} returned ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as OpenAIChatResponse;
    const durationMs = Date.now() - start;
    const totalTokens = data.usage?.completion_tokens ?? 0;
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

export async function listMLXModels(host: string = MLX_DEFAULT_HOST): Promise<string[]> {
  try {
    const res = await fetch(`http://${host}/v1/models`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((m: { id: string }) => m.id);
  } catch {
    return [];
  }
}
