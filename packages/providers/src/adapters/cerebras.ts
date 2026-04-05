import { BaseProviderAdapter } from "../base";
import { resolveApiKey } from "../env-keys";
import { invokeOpenAICompatible, listOpenAICompatibleModels } from "../openai-compatible-client";
import type { ProviderInvocationOptions, ProviderInvocationResult } from "../types";

const DEFAULT_BASE_URL = "https://api.cerebras.ai/v1";

export class CerebrasProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: "cerebras",
      displayName: "Cerebras",
      locality: "cloud",
      tier: "midtier",
      defaultBaseUrl: DEFAULT_BASE_URL,
      capabilities: {
        tools: true,
        structuredOutput: true,
        vision: false,
        reasoning: true,
      },
      notes: ["Ultra-fast inference for Llama-family and Qwen-family models via OpenAI-compatible API."],
    });
  }

  override async listModels(): Promise<string[]> {
    const apiKey = resolveApiKey("cerebras");
    return listOpenAICompatibleModels(this.defaultBaseUrl ?? DEFAULT_BASE_URL, apiKey);
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
    const apiKey = resolveApiKey("cerebras", options.apiKey);
    return invokeOpenAICompatible({
      baseUrl: options.baseUrl ?? this.defaultBaseUrl ?? DEFAULT_BASE_URL,
      apiKey,
      options,
    });
  }
}
