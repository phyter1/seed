import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OpenRouterProviderAdapter } from "./openrouter";
import { jsonResponse, mockFetch, restoreFetch } from "../test-helpers";

describe("OpenRouterProviderAdapter", () => {
  const original = process.env.SEED_OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.SEED_OPENROUTER_API_KEY = "or-test";
  });

  afterEach(() => {
    restoreFetch();
    if (original === undefined) delete process.env.SEED_OPENROUTER_API_KEY;
    else process.env.SEED_OPENROUTER_API_KEY = original;
  });

  test("definition is cloud + midtier with openrouter baseUrl", () => {
    const adapter = new OpenRouterProviderAdapter();
    expect(adapter.id).toBe("openrouter");
    expect(adapter.tier).toBe("midtier");
    expect(adapter.defaultBaseUrl).toBe("https://openrouter.ai/api/v1");
  });

  test("invoke() sends HTTP-Referer + X-Title headers", async () => {
    const getCalls = mockFetch(() =>
      jsonResponse({
        model: "anthropic/claude-3.5-sonnet",
        choices: [{ index: 0, message: { role: "assistant", content: "hi" } }],
      }),
    );
    const adapter = new OpenRouterProviderAdapter();
    await adapter.invoke({
      model: "anthropic/claude-3.5-sonnet",
      messages: [{ role: "user", content: "hello" }],
    });
    const headers = getCalls()[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer or-test");
    expect(headers["HTTP-Referer"]).toBeTruthy();
    expect(headers["X-Title"]).toBeTruthy();
  });

  test("invoke() overrides referer + title via env", async () => {
    process.env.SEED_OPENROUTER_REFERER = "https://custom.example";
    process.env.SEED_OPENROUTER_TITLE = "custom-agent";
    const getCalls = mockFetch(() =>
      jsonResponse({ model: "x", choices: [{ index: 0, message: { role: "assistant", content: "ok" } }] }),
    );
    const adapter = new OpenRouterProviderAdapter();
    await adapter.invoke({ model: "x", messages: [{ role: "user", content: "hi" }] });
    const headers = getCalls()[0].init.headers as Record<string, string>;
    expect(headers["HTTP-Referer"]).toBe("https://custom.example");
    expect(headers["X-Title"]).toBe("custom-agent");
    delete process.env.SEED_OPENROUTER_REFERER;
    delete process.env.SEED_OPENROUTER_TITLE;
  });
});
