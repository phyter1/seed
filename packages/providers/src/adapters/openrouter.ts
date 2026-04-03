import { BaseProviderAdapter } from "../base";

export class OpenRouterProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: "openrouter",
      displayName: "OpenRouter",
      locality: "cloud",
      defaultBaseUrl: "https://openrouter.ai/api/v1",
      capabilities: {
        tools: true,
        structuredOutput: true,
        vision: true,
        reasoning: true,
      },
      notes: ["Multi-provider aggregator through an OpenAI-compatible API surface."],
    });
  }
}
