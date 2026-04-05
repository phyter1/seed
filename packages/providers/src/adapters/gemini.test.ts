import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GeminiProviderAdapter } from "./gemini";
import { jsonResponse, mockFetch, restoreFetch } from "../test-helpers";

describe("GeminiProviderAdapter", () => {
  const original = process.env.SEED_GEMINI_API_KEY;

  beforeEach(() => {
    process.env.SEED_GEMINI_API_KEY = "gm-test";
  });

  afterEach(() => {
    restoreFetch();
    if (original === undefined) delete process.env.SEED_GEMINI_API_KEY;
    else process.env.SEED_GEMINI_API_KEY = original;
  });

  test("definition is cloud + midtier", () => {
    const adapter = new GeminiProviderAdapter();
    expect(adapter.id).toBe("gemini");
    expect(adapter.tier).toBe("midtier");
    expect(adapter.defaultBaseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  test("invoke() converts messages to Gemini contents with role mapping", async () => {
    const getCalls = mockFetch(() =>
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "answer" }], role: "model" },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      }),
    );
    const adapter = new GeminiProviderAdapter();
    const res = await adapter.invoke({
      model: "gemini-2.0-flash",
      messages: [
        { role: "system", content: "be a scholar" },
        { role: "user", content: "what is pi?" },
        { role: "assistant", content: "3.14" },
        { role: "user", content: "more digits?" },
      ],
      temperature: 0.2,
      maxTokens: 128,
    });
    expect(res.content).toBe("answer");
    expect(res.usage?.promptTokens).toBe(10);
    expect(res.usage?.completionTokens).toBe(5);
    expect(res.usage?.totalTokens).toBe(15);

    const call = getCalls()[0];
    expect(call.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    );
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("gm-test");
    const body = JSON.parse(call.init.body as string);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "be a scholar" }] });
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "what is pi?" }] },
      { role: "model", parts: [{ text: "3.14" }] },
      { role: "user", parts: [{ text: "more digits?" }] },
    ]);
    expect(body.generationConfig).toEqual({ temperature: 0.2, maxOutputTokens: 128 });
  });

  test("invoke() omits systemInstruction when no system messages", async () => {
    const getCalls = mockFetch(() =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "ok" }], role: "model" } }],
      }),
    );
    const adapter = new GeminiProviderAdapter();
    await adapter.invoke({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
    });
    const body = JSON.parse(getCalls()[0].init.body as string);
    expect(body.systemInstruction).toBeUndefined();
  });

  test("invoke() omits generationConfig when no sampling params", async () => {
    const getCalls = mockFetch(() =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: "ok" }], role: "model" } }] }),
    );
    const adapter = new GeminiProviderAdapter();
    await adapter.invoke({ model: "gemini-2.0-flash", messages: [{ role: "user", content: "hi" }] });
    const body = JSON.parse(getCalls()[0].init.body as string);
    expect(body.generationConfig).toBeUndefined();
  });

  test("invoke() URL-encodes model name", async () => {
    const getCalls = mockFetch(() =>
      jsonResponse({ candidates: [{ content: { parts: [{ text: "ok" }], role: "model" } }] }),
    );
    const adapter = new GeminiProviderAdapter();
    await adapter.invoke({
      model: "gemini-2.0-flash-thinking-exp-01-21",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(getCalls()[0].url).toContain("gemini-2.0-flash-thinking-exp-01-21:generateContent");
  });

  test("listModels() strips 'models/' prefix", async () => {
    mockFetch(() =>
      jsonResponse({
        models: [{ name: "models/gemini-2.0-flash" }, { name: "models/gemini-1.5-pro" }],
      }),
    );
    const adapter = new GeminiProviderAdapter();
    const models = await adapter.listModels();
    expect(models).toEqual(["gemini-2.0-flash", "gemini-1.5-pro"]);
  });

  test("invoke() throws on non-2xx with body excerpt", async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 }),
    );
    const adapter = new GeminiProviderAdapter();
    await expect(
      adapter.invoke({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/429/);
  });
});
