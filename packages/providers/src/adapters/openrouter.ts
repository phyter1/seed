import { BaseProviderAdapter } from "../base";
import { resolveApiKey } from "../env-keys";
import { invokeOpenAICompatible, listOpenAICompatibleModels } from "../openai-compatible-client";
import type { ProviderInvocationOptions, ProviderInvocationResult } from "../types";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

function openRouterHeaders(): Record<string, string> {
  // OpenRouter requests include HTTP-Referer + X-Title for attribution.
  // These are advisory; missing them doesn't reject the request, but
  // setting them keeps OpenRouter's dashboard honest about traffic
  // origin. Both are overridable via env.
  return {
    "HTTP-Referer": process.env.SEED_OPENROUTER_REFERER ?? "https://seed.phytertek.com",
    "X-Title": process.env.SEED_OPENROUTER_TITLE ?? "seed",
  };
}

export class OpenRouterProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: "openrouter",
      displayName: "OpenRouter",
      locality: "cloud",
      // OpenRouter routes to everything from midtier to frontier. Tag
      // as midtier by default; challenge-round escalation logic may
      // override per-model.
      tier: "midtier",
      defaultBaseUrl: DEFAULT_BASE_URL,
      capabilities: {
        tools: true,
        structuredOutput: true,
        vision: true,
        reasoning: true,
      },
      notes: ["Multi-provider aggregator through an OpenAI-compatible API surface."],
    });
  }

  override async listModels(): Promise<string[]> {
    const apiKey = resolveApiKey("openrouter");
    return listOpenAICompatibleModels(
      this.defaultBaseUrl ?? DEFAULT_BASE_URL,
      apiKey,
      openRouterHeaders(),
    );
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
    const apiKey = resolveApiKey("openrouter", options.apiKey);
    return invokeOpenAICompatible({
      baseUrl: options.baseUrl ?? this.defaultBaseUrl ?? DEFAULT_BASE_URL,
      apiKey,
      options,
      extraHeaders: openRouterHeaders(),
    });
  }
}
