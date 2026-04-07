import { describe, expect, test } from "bun:test";
import { OpenAICompatibleProviderAdapter } from "./openai-compatible";

describe("OpenAICompatibleProviderAdapter", () => {
  test("definition has cloud locality and local tier", () => {
    const adapter = new OpenAICompatibleProviderAdapter();
    expect(adapter.id).toBe("openai_compatible");
    expect(adapter.displayName).toBe("OpenAI-Compatible Endpoint");
    expect(adapter.locality).toBe("cloud");
    expect(adapter.tier).toBe("local");
  });

  test("capabilities are booleans with expected defaults", () => {
    const adapter = new OpenAICompatibleProviderAdapter();
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
    const adapter = new OpenAICompatibleProviderAdapter();
    expect(adapter.defaultBaseUrl).toBeUndefined();
  });
});
