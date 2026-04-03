import { BaseProviderAdapter } from "../base";

export class OpenAICompatibleProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: "openai_compatible",
      displayName: "OpenAI-Compatible Endpoint",
      locality: "cloud",
      capabilities: {
        tools: false,
        structuredOutput: false,
        vision: false,
        reasoning: true,
      },
      notes: ["Generic adapter for endpoints that expose an OpenAI-compatible API surface."],
    });
  }
}
