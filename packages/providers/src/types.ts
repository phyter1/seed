export type ProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "openrouter"
  | "cerebras"
  | "groq"
  | "ollama"
  | "mlx_openai_compatible"
  | "openai_compatible";

export type ProviderLocality = "local" | "cloud";

/**
 * Escalation tier for the jury challenge round and any future tiered
 * routing. "local" = on-fleet inference, "midtier" = cheap/fast cloud
 * (gemini-flash, groq, cerebras, most openrouter models), "frontier" =
 * opus/gpt-5 class. Tier is a provider-level default; specific models
 * (e.g. openrouter/claude-opus) may override in a per-model table.
 */
export type ProviderTier = "local" | "midtier" | "frontier";

export interface ProviderCapabilities {
  tools: boolean;
  structuredOutput: boolean;
  vision: boolean;
  reasoning: boolean;
}

export interface ProviderInvocationOptions {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  /** Optional per-call API key override. Falls back to env-var resolution. */
  apiKey?: string;
  /** Optional per-call base URL override. Falls back to defaultBaseUrl. */
  baseUrl?: string;
}

export interface ProviderInvocationResult {
  content: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  raw?: unknown;
}

export interface ProviderDefinition {
  id: ProviderId;
  displayName: string;
  locality: ProviderLocality;
  tier: ProviderTier;
  defaultBaseUrl?: string;
  capabilities: ProviderCapabilities;
  notes?: string[];
}

export interface ProviderAdapter extends ProviderDefinition {
  listModels(): Promise<string[]>;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
  invoke(options: ProviderInvocationOptions): Promise<ProviderInvocationResult>;
}
