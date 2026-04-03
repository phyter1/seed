import type { ProviderAdapter, ProviderId } from "./types";
import { AnthropicProviderAdapter } from "./adapters/anthropic";
import { GeminiProviderAdapter } from "./adapters/gemini";
import { MLXOpenAICompatibleProviderAdapter } from "./adapters/mlx";
import { OllamaProviderAdapter } from "./adapters/ollama";
import { OpenAICompatibleProviderAdapter } from "./adapters/openai-compatible";
import { OpenAIProviderAdapter } from "./adapters/openai";
import { OpenRouterProviderAdapter } from "./adapters/openrouter";

export const PROVIDER_ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  anthropic: new AnthropicProviderAdapter(),
  openai: new OpenAIProviderAdapter(),
  gemini: new GeminiProviderAdapter(),
  openrouter: new OpenRouterProviderAdapter(),
  ollama: new OllamaProviderAdapter(),
  mlx_openai_compatible: new MLXOpenAICompatibleProviderAdapter(),
  openai_compatible: new OpenAICompatibleProviderAdapter(),
};

export function getProviderAdapter(id: ProviderId): ProviderAdapter {
  return PROVIDER_ADAPTERS[id];
}

export function listProviderAdapters(): ProviderAdapter[] {
  return Object.values(PROVIDER_ADAPTERS);
}

export type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderDefinition,
  ProviderId,
  ProviderInvocationOptions,
  ProviderInvocationResult,
  ProviderLocality,
} from "./types";
