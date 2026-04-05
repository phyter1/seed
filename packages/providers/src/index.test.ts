import { describe, expect, test } from "bun:test";
import { getProviderAdapter, listProviderAdapters, listProviderAdaptersByTier, PROVIDER_ADAPTERS } from "./index";

describe("provider registry", () => {
  test("exposes all 9 registered providers", () => {
    const ids: string[] = listProviderAdapters().map((p) => p.id).sort();
    expect(ids).toEqual(
      [
        "anthropic",
        "openai",
        "gemini",
        "openrouter",
        "cerebras",
        "groq",
        "ollama",
        "mlx_openai_compatible",
        "openai_compatible",
      ].sort(),
    );
  });

  test("each provider carries a tier", () => {
    for (const adapter of listProviderAdapters()) {
      expect(["local", "midtier", "frontier"]).toContain(adapter.tier);
    }
  });

  test("getProviderAdapter looks up by id", () => {
    expect(getProviderAdapter("openai").id).toBe("openai");
    expect(getProviderAdapter("cerebras").id).toBe("cerebras");
  });

  test("listProviderAdaptersByTier filters correctly", () => {
    const frontier = listProviderAdaptersByTier("frontier").map((p) => p.id).sort();
    expect(frontier).toEqual(["anthropic", "openai"]);

    const midtier = listProviderAdaptersByTier("midtier").map((p) => p.id).sort();
    expect(midtier).toEqual(["cerebras", "gemini", "groq", "openrouter"]);

    const local = listProviderAdaptersByTier("local").map((p) => p.id).sort();
    expect(local).toEqual(["mlx_openai_compatible", "ollama", "openai_compatible"]);
  });

  test("PROVIDER_ADAPTERS dictionary is stable", () => {
    expect(PROVIDER_ADAPTERS.openai.displayName).toBe("OpenAI");
    expect(PROVIDER_ADAPTERS.cerebras.displayName).toBe("Cerebras");
    expect(PROVIDER_ADAPTERS.groq.displayName).toBe("Groq");
  });
});
