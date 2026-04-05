import { BaseProviderAdapter } from "../base";
import { resolveApiKey } from "../env-keys";
import type { ProviderInvocationOptions, ProviderInvocationResult } from "../types";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// Gemini has its own wire format:
// - endpoint is /models/{model}:generateContent
// - request: { contents: [{role, parts:[{text}]}], systemInstruction, generationConfig }
// - roles are "user" | "model" (not "assistant")
// - auth via x-goog-api-key header

interface GeminiPart {
  text: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content: { parts: GeminiPart[]; role: string };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export class GeminiProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: "gemini",
      displayName: "Gemini",
      locality: "cloud",
      tier: "midtier",
      defaultBaseUrl: DEFAULT_BASE_URL,
      capabilities: {
        tools: true,
        structuredOutput: true,
        vision: true,
        reasoning: true,
      },
      notes: ["Cloud provider for Gemini API and Vertex-backed Gemini models."],
    });
  }

  override async listModels(): Promise<string[]> {
    const apiKey = resolveApiKey("gemini");
    const baseUrl = this.defaultBaseUrl ?? DEFAULT_BASE_URL;
    const res = await fetch(`${baseUrl}/models`, {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!res.ok) {
      throw new Error(`gemini list models failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    // Gemini returns "models/gemini-1.5-flash"; strip the prefix.
    return (data.models ?? []).map((m) => m.name.replace(/^models\//, ""));
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
    const apiKey = resolveApiKey("gemini", options.apiKey);
    const baseUrl = options.baseUrl ?? this.defaultBaseUrl ?? DEFAULT_BASE_URL;

    const systemMessages = options.messages.filter((m) => m.role === "system").map((m) => m.content);
    const systemInstruction =
      systemMessages.length > 0 ? { parts: [{ text: systemMessages.join("\n\n") }] } : undefined;

    const contents: GeminiContent[] = options.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const generationConfig: Record<string, unknown> = {};
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;

    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

    const url = `${baseUrl}/models/${encodeURIComponent(options.model)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`gemini invoke failed: ${res.status} ${res.statusText}${errText ? ` — ${errText.slice(0, 500)}` : ""}`);
    }

    const data = (await res.json()) as GeminiResponse;
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const content = parts.map((p) => p.text).join("");

    return {
      content,
      model: options.model,
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount,
            completionTokens: data.usageMetadata.candidatesTokenCount,
            totalTokens: data.usageMetadata.totalTokenCount,
          }
        : undefined,
      raw: data,
    };
  }
}
