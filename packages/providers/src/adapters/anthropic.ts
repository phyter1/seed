import { BaseProviderAdapter } from "../base";
import { resolveApiKey } from "../env-keys";
import type { ProviderInvocationOptions, ProviderInvocationResult } from "../types";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 1024;

// Anthropic's /v1/messages API is not OpenAI-compatible:
// - system prompt lives at top level, not in messages[]
// - max_tokens is required, not optional
// - response shape is { content: [{type:"text", text: "..."}], usage: {input_tokens, output_tokens} }
// - auth header is x-api-key, not Authorization
// - anthropic-version header required
// So this adapter owns its own transport.

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{ type: string; text: string }>;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: "anthropic",
      displayName: "Anthropic",
      locality: "cloud",
      tier: "frontier",
      defaultBaseUrl: DEFAULT_BASE_URL,
      capabilities: {
        tools: true,
        structuredOutput: true,
        vision: true,
        reasoning: true,
      },
      notes: ["Cloud provider for Claude-family models."],
    });
  }

  override async listModels(): Promise<string[]> {
    const apiKey = resolveApiKey("anthropic");
    const baseUrl = this.defaultBaseUrl ?? DEFAULT_BASE_URL;
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
    });
    if (!res.ok) {
      throw new Error(`anthropic list models failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => m.id);
  }

  override async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      const models = await this.listModels();
      return { ok: true, message: `${models.length} models available` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  override async invoke(options: ProviderInvocationOptions): Promise<ProviderInvocationResult> {
    const apiKey = resolveApiKey("anthropic", options.apiKey);
    const baseUrl = options.baseUrl ?? this.defaultBaseUrl ?? DEFAULT_BASE_URL;

    // Split system prompt out of messages (Anthropic expects it at top level).
    const systemMessages = options.messages.filter((m) => m.role === "system").map((m) => m.content);
    const system = systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;
    const messages: AnthropicMessage[] = options.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const body: Record<string, unknown> = {
      model: options.model,
      messages,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (system) body.system = system;
    if (options.temperature !== undefined) body.temperature = options.temperature;

    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`anthropic invoke failed: ${res.status} ${res.statusText}${errText ? ` — ${errText.slice(0, 500)}` : ""}`);
    }

    const data = (await res.json()) as AnthropicResponse;
    const content = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    return {
      content,
      model: data.model,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      raw: data,
    };
  }
}
