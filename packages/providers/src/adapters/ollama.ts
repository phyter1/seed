import { BaseProviderAdapter } from "../base";

export class OllamaProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: "ollama",
      displayName: "Ollama",
      locality: "local",
      tier: "local",
      capabilities: {
        tools: false,
        structuredOutput: false,
        vision: false,
        reasoning: true,
      },
      notes: ["Local provider with model-specific capability differences."],
    });
  }
}
