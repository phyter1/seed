import { describe, expect, test } from "bun:test";
import { OllamaProviderAdapter } from "./ollama";

describe("OllamaProviderAdapter", () => {
  test("definition has local locality and local tier", () => {
    const adapter = new OllamaProviderAdapter();
    expect(adapter.id).toBe("ollama");
    expect(adapter.displayName).toBe("Ollama");
    expect(adapter.locality).toBe("local");
    expect(adapter.tier).toBe("local");
  });

  test("capabilities are booleans with expected defaults", () => {
    const adapter = new OllamaProviderAdapter();
    const caps = adapter.capabilities;
    expect(typeof caps.tools).toBe("boolean");
    expect(typeof caps.structuredOutput).toBe("boolean");
    expect(typeof caps.vision).toBe("boolean");
    expect(typeof caps.reasoning).toBe("boolean");
    expect(caps.tools).toBe(false);
    expect(caps.structuredOutput).toBe(false);
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(true);
  });

  test("defaultBaseUrl is not set", () => {
    const adapter = new OllamaProviderAdapter();
    expect(adapter.defaultBaseUrl).toBeUndefined();
  });
});
