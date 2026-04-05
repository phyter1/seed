// Shared OpenAI-compatible chat client.
//
// Used by adapters whose APIs are drop-in OpenAI: OpenAI itself,
// OpenRouter, Cerebras, Groq. Callers supply base URL + API key +
// optional extra headers (OpenRouter wants X-Title / HTTP-Referer).
//
// Keep this deliberately thin — no retries, no rate-limit handling,
// no streaming. The challenge-round logic that consumes this will
// own its own retry/escalation policy.

import type { ProviderInvocationOptions, ProviderInvocationResult } from "./types";

export interface OpenAICompatibleInvokeArgs {
  baseUrl: string;
  apiKey: string;
  options: ProviderInvocationOptions;
  extraHeaders?: Record<string, string>;
}

interface OpenAIChatResponse {
  id?: string;
  model?: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export async function invokeOpenAICompatible({
  baseUrl,
  apiKey,
  options,
  extraHeaders,
}: OpenAICompatibleInvokeArgs): Promise<ProviderInvocationResult> {
  const url = `${stripTrailingSlash(baseUrl)}/chat/completions`;
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...(extraHeaders ?? {}),
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await safeReadText(res);
    throw new Error(`OpenAI-compatible invoke failed: ${res.status} ${res.statusText}${errText ? ` — ${errText}` : ""}`);
  }

  const data = (await res.json()) as OpenAIChatResponse;
  const content = data.choices?.[0]?.message?.content ?? "";

  return {
    content,
    model: data.model ?? options.model,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
    raw: data,
  };
}

export async function listOpenAICompatibleModels(
  baseUrl: string,
  apiKey: string,
  extraHeaders?: Record<string, string>,
): Promise<string[]> {
  const url = `${stripTrailingSlash(baseUrl)}/models`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(extraHeaders ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`list models failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return (data.data ?? []).map((m) => m.id);
}

function stripTrailingSlash(u: string): string {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.length > 500 ? `${t.slice(0, 500)}…` : t;
  } catch {
    return "";
  }
}
