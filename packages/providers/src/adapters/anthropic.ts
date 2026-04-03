import { BaseProviderAdapter } from "../base";

export class AnthropicProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: "anthropic",
      displayName: "Anthropic",
      locality: "cloud",
      capabilities: {
        tools: true,
        structuredOutput: true,
        vision: true,
        reasoning: true,
      },
      notes: ["Cloud provider for Claude-family models."],
    });
  }
}
