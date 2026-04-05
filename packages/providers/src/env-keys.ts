// Resolve API keys from environment, preferring SEED_-prefixed names
// and falling back to vendor-canonical names.

import type { ProviderId } from "./types";

const ENV_KEY_CHAINS: Partial<Record<ProviderId, string[]>> = {
  anthropic: ["SEED_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"],
  openai: ["SEED_OPENAI_API_KEY", "OPENAI_API_KEY"],
  gemini: ["SEED_GEMINI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
  openrouter: ["SEED_OPENROUTER_API_KEY", "OPENROUTER_API_KEY"],
  cerebras: ["SEED_CEREBRAS_API_KEY", "CEREBRAS_API_KEY"],
  groq: ["SEED_GROQ_API_KEY", "GROQ_API_KEY"],
};

export function resolveApiKey(providerId: ProviderId, override?: string): string {
  if (override && override.length > 0) return override;
  const chain = ENV_KEY_CHAINS[providerId];
  if (!chain) {
    throw new Error(`No env-key chain registered for provider "${providerId}"`);
  }
  for (const name of chain) {
    const v = process.env[name];
    if (v && v.length > 0) return v;
  }
  throw new Error(
    `Missing API key for provider "${providerId}". Set one of: ${chain.join(", ")}`,
  );
}

export function envKeyChain(providerId: ProviderId): string[] {
  return ENV_KEY_CHAINS[providerId] ?? [];
}
