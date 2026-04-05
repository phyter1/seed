import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CerebrasProviderAdapter } from "./cerebras";
import { jsonResponse, mockFetch, restoreFetch } from "../test-helpers";

describe("CerebrasProviderAdapter", () => {
  const original = process.env.SEED_CEREBRAS_API_KEY;

  beforeEach(() => {
    process.env.SEED_CEREBRAS_API_KEY = "cb-test";
  });

  afterEach(() => {
    restoreFetch();
    if (original === undefined) delete process.env.SEED_CEREBRAS_API_KEY;
    else process.env.SEED_CEREBRAS_API_KEY = original;
  });

  test("definition is cloud + midtier", () => {
    const adapter = new CerebrasProviderAdapter();
    expect(adapter.id).toBe("cerebras");
    expect(adapter.tier).toBe("midtier");
    expect(adapter.defaultBaseUrl).toBe("https://api.cerebras.ai/v1");
  });

  test("invoke() posts to cerebras /chat/completions", async () => {
    const getCalls = mockFetch(() =>
      jsonResponse({
        model: "llama-3.3-70b",
        choices: [{ index: 0, message: { role: "assistant", content: "fast response" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    const adapter = new CerebrasProviderAdapter();
    const res = await adapter.invoke({
      model: "llama-3.3-70b",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.content).toBe("fast response");
    expect(getCalls()[0].url).toBe("https://api.cerebras.ai/v1/chat/completions");
  });
});
