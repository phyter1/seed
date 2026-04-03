import { BaseProviderAdapter } from "../base";

export class GeminiProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: "gemini",
      displayName: "Gemini",
      locality: "cloud",
      capabilities: {
        tools: true,
        structuredOutput: true,
        vision: true,
        reasoning: true,
      },
      notes: ["Cloud provider for Gemini API and Vertex-backed Gemini models."],
    });
  }
}
