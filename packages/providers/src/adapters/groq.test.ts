import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GroqProviderAdapter } from "./groq";
import { jsonResponse, mockFetch, restoreFetch } from "../test-helpers";

describe("GroqProviderAdapter", () => {
  const original = process.env.SEED_GROQ_API_KEY;

  beforeEach(() => {
    process.env.SEED_GROQ_API_KEY = "gq-test";
  });

  afterEach(() => {
    restoreFetch();
    if (original === undefined) delete process.env.SEED_GROQ_API_KEY;
    else process.env.SEED_GROQ_API_KEY = original;
  });

  test("definition is cloud + midtier", () => {
    const adapter = new GroqProviderAdapter();
    expect(adapter.id).toBe("groq");
    expect(adapter.tier).toBe("midtier");
    expect(adapter.defaultBaseUrl).toBe("https://api.groq.com/openai/v1");
  });

  test("invoke() posts to groq /chat/completions", async () => {
    const getCalls = mockFetch(() =>
      jsonResponse({
        model: "llama-3.3-70b-versatile",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
      }),
    );
    const adapter = new GroqProviderAdapter();
    const res = await adapter.invoke({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.content).toBe("ok");
    expect(getCalls()[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const headers = getCalls()[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer gq-test");
  });
});
