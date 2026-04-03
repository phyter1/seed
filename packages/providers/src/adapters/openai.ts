import { BaseProviderAdapter } from "../base";

export class OpenAIProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: "openai",
      displayName: "OpenAI",
      locality: "cloud",
      capabilities: {
        tools: true,
        structuredOutput: true,
        vision: true,
        reasoning: true,
      },
      notes: ["Cloud provider for GPT-family models and Codex-aligned backends."],
    });
  }
}
