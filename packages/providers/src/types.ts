export type ProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "openrouter"
  | "ollama"
  | "mlx_openai_compatible"
  | "openai_compatible";

export type ProviderLocality = "local" | "cloud";

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
  defaultBaseUrl?: string;
  capabilities: ProviderCapabilities;
  notes?: string[];
}

export interface ProviderAdapter extends ProviderDefinition {
  listModels(): Promise<string[]>;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
  invoke(options: ProviderInvocationOptions): Promise<ProviderInvocationResult>;
}
