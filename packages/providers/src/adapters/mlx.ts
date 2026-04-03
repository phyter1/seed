import { BaseProviderAdapter } from "../base";

export class MLXOpenAICompatibleProviderAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: "mlx_openai_compatible",
      displayName: "MLX (OpenAI-compatible)",
      locality: "local",
      capabilities: {
        tools: false,
        structuredOutput: false,
        vision: false,
        reasoning: true,
      },
      notes: ["Local MLX server exposed through an OpenAI-compatible endpoint."],
    });
  }
}
