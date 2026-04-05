import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OpenAIProviderAdapter } from "./openai";
import { jsonResponse, mockFetch, restoreFetch } from "../test-helpers";

describe("OpenAIProviderAdapter", () => {
  const originalKey = process.env.SEED_OPENAI_API_KEY;

  beforeEach(() => {
    process.env.SEED_OPENAI_API_KEY = "sk-test-key";
  });

  afterEach(() => {
    restoreFetch();
    if (originalKey === undefined) delete process.env.SEED_OPENAI_API_KEY;
    else process.env.SEED_OPENAI_API_KEY = originalKey;
  });

  test("definition has cloud locality and frontier tier", () => {
    const adapter = new OpenAIProviderAdapter();
    expect(adapter.id).toBe("openai");
    expect(adapter.locality).toBe("cloud");
    expect(adapter.tier).toBe("frontier");
    expect(adapter.defaultBaseUrl).toBe("https://api.openai.com/v1");
  });

  test("invoke() posts to /chat/completions with Authorization header", async () => {
    const getCalls = mockFetch(() =>
      jsonResponse({
        id: "chatcmpl-1",
        model: "gpt-4o-mini",
        choices: [{ index: 0, message: { role: "assistant", content: "hello back" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }),
    );
    const adapter = new OpenAIProviderAdapter();
    const result = await adapter.invoke({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.7,
      maxTokens: 256,
    });
    expect(result.content).toBe("hello back");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.usage?.promptTokens).toBe(5);
    expect(result.usage?.completionTokens).toBe(3);
    expect(result.usage?.totalTokens).toBe(8);
    const calls = getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test-key");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(256);
  });

  test("invoke() honors per-call apiKey override", async () => {
    const getCalls = mockFetch(() =>
      jsonResponse({
        model: "gpt-4o",
        choices: [{ index: 0, message: { role: "assistant", content: "x" } }],
      }),
    );
    const adapter = new OpenAIProviderAdapter();
    await adapter.invoke({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      apiKey: "sk-override",
    });
    const headers = getCalls()[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-override");
  });

  test("invoke() throws on non-2xx response", async () => {
    mockFetch(() => new Response("rate limited", { status: 429 }));
    const adapter = new OpenAIProviderAdapter();
    await expect(
      adapter.invoke({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/429/);
  });

  test("invoke() throws with helpful message when key missing", async () => {
    delete process.env.SEED_OPENAI_API_KEY;
    const priorOpenAI = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const adapter = new OpenAIProviderAdapter();
    await expect(
      adapter.invoke({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/SEED_OPENAI_API_KEY/);
    if (priorOpenAI !== undefined) process.env.OPENAI_API_KEY = priorOpenAI;
  });

  test("listModels() parses OpenAI-style {data:[{id}]} response", async () => {
    mockFetch(() =>
      jsonResponse({
        object: "list",
        data: [
          { id: "gpt-4o", object: "model" },
          { id: "gpt-4o-mini", object: "model" },
        ],
      }),
    );
    const adapter = new OpenAIProviderAdapter();
    const models = await adapter.listModels();
    expect(models).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  test("healthCheck() returns ok:true when listModels succeeds", async () => {
    mockFetch(() => jsonResponse({ data: [{ id: "gpt-4o" }] }));
    const adapter = new OpenAIProviderAdapter();
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.message).toContain("1 models");
  });

  test("healthCheck() returns ok:false when listModels fails", async () => {
    mockFetch(() => new Response("unauthorized", { status: 401 }));
    const adapter = new OpenAIProviderAdapter();
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.message).toContain("401");
  });
});
