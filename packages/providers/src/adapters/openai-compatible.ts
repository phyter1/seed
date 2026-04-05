import { BaseProviderAdapter } from "../base";

export class OpenAICompatibleProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: "openai_compatible",
      displayName: "OpenAI-Compatible Endpoint",
      locality: "cloud",
      // Generic endpoint — tier depends on what the caller points it
      // at. Default to local since seed most often uses this adapter
      // against on-fleet endpoints; callers override at construction
      // if pointing at a cloud endpoint.
      tier: "local",
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
