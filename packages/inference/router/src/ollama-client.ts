import type { JurorResponse } from "./types.js";

interface OllamaGenerateResponse {
  model: string;
  response: string;
  total_duration: number;
  eval_count: number;
  eval_duration: number;
}

export async function queryOllama(
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

    const res = await fetch(`http://${host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Ollama ${host} returned ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as OllamaGenerateResponse;
    const durationMs = Date.now() - start;
    const evalDurationSec = data.eval_duration / 1e9;
    const tokensPerSecond = evalDurationSec > 0 ? data.eval_count / evalDurationSec : 0;

    return {
      node: nodeName,
      model,
      response: data.response.trim(),
      tokensPerSecond: Math.round(tokensPerSecond * 100) / 100,
      totalTokens: data.eval_count,
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

export async function queryOllamaChat(
  host: string,
  model: string,
  messages: { role: string; content: string }[],
  options: { temperature?: number; timeoutMs?: number } = {}
): Promise<JurorResponse> {
  const { temperature = 0.7, timeoutMs = 30000 } = options;
  const start = Date.now();
  const nodeName = host.split(":")[0].split(".")[0];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`http://${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: { temperature },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Ollama ${host} returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const durationMs = Date.now() - start;
    const evalDurationSec = (data.eval_duration || 1) / 1e9;
    const tokensPerSecond = evalDurationSec > 0 ? (data.eval_count || 0) / evalDurationSec : 0;

    return {
      node: nodeName,
      model,
      response: data.message?.content?.trim() || "",
      tokensPerSecond: Math.round(tokensPerSecond * 100) / 100,
      totalTokens: data.eval_count || 0,
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

export async function listModels(host: string): Promise<string[]> {
  try {
    const res = await fetch(`http://${host}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m: { name: string }) => m.name);
  } catch {
    return [];
  }
}
