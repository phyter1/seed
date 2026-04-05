import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AnthropicProviderAdapter } from "./anthropic";
import { jsonResponse, mockFetch, restoreFetch } from "../test-helpers";

describe("AnthropicProviderAdapter", () => {
  const original = process.env.SEED_ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.SEED_ANTHROPIC_API_KEY = "ak-test";
  });

  afterEach(() => {
    restoreFetch();
    if (original === undefined) delete process.env.SEED_ANTHROPIC_API_KEY;
    else process.env.SEED_ANTHROPIC_API_KEY = original;
  });

  test("definition is cloud + frontier", () => {
    const adapter = new AnthropicProviderAdapter();
    expect(adapter.id).toBe("anthropic");
    expect(adapter.tier).toBe("frontier");
    expect(adapter.defaultBaseUrl).toBe("https://api.anthropic.com/v1");
  });

  test("invoke() extracts system message and posts to /messages", async () => {
    const getCalls = mockFetch(() =>
      jsonResponse({
        id: "msg_01",
        type: "message",
        role: "assistant",
        model: "claude-3-5-sonnet-20241022",
        content: [{ type: "text", text: "hi there" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 8, output_tokens: 3 },
      }),
    );
    const adapter = new AnthropicProviderAdapter();
    const res = await adapter.invoke({
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hello" },
      ],
      temperature: 0.5,
      maxTokens: 512,
    });
    expect(res.content).toBe("hi there");
    expect(res.model).toBe("claude-3-5-sonnet-20241022");
    expect(res.usage?.promptTokens).toBe(8);
    expect(res.usage?.completionTokens).toBe(3);
    expect(res.usage?.totalTokens).toBe(11);

    const call = getCalls()[0];
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("ak-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(call.init.body as string);
    expect(body.system).toBe("be terse");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(body.max_tokens).toBe(512);
    expect(body.temperature).toBe(0.5);
  });

  test("invoke() joins multiple system messages", async () => {
    const getCalls = mockFetch(() =>
      jsonResponse({
        id: "m",
        type: "message",
        role: "assistant",
        model: "claude-3-haiku",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const adapter = new AnthropicProviderAdapter();
    await adapter.invoke({
      model: "claude-3-haiku",
      messages: [
        { role: "system", content: "first" },
        { role: "system", content: "second" },
        { role: "user", content: "hi" },
      ],
    });
    const body = JSON.parse(getCalls()[0].init.body as string);
    expect(body.system).toBe("first\n\nsecond");
  });

  test("invoke() defaults max_tokens when unspecified", async () => {
    const getCalls = mockFetch(() =>
      jsonResponse({
        id: "m",
        type: "message",
        role: "assistant",
        model: "claude-3-haiku",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const adapter = new AnthropicProviderAdapter();
    await adapter.invoke({
      model: "claude-3-haiku",
      messages: [{ role: "user", content: "hi" }],
    });
    const body = JSON.parse(getCalls()[0].init.body as string);
    expect(body.max_tokens).toBe(1024);
  });

  test("invoke() concatenates multiple text blocks in response", async () => {
    mockFetch(() =>
      jsonResponse({
        id: "m",
        type: "message",
        role: "assistant",
        model: "claude-3-haiku",
        content: [
          { type: "text", text: "part one. " },
          { type: "text", text: "part two." },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );
    const adapter = new AnthropicProviderAdapter();
    const res = await adapter.invoke({
      model: "claude-3-haiku",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.content).toBe("part one. part two.");
  });

  test("invoke() throws on non-2xx", async () => {
    mockFetch(() => new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 529 }));
    const adapter = new AnthropicProviderAdapter();
    await expect(
      adapter.invoke({
        model: "claude-3-haiku",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow(/529/);
  });

  test("listModels() strips 'models/' prefix not needed — anthropic returns ids directly", async () => {
    mockFetch(() =>
      jsonResponse({
        data: [{ id: "claude-3-5-sonnet-20241022" }, { id: "claude-3-haiku-20240307" }],
      }),
    );
    const adapter = new AnthropicProviderAdapter();
    const models = await adapter.listModels();
    expect(models).toEqual(["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"]);
  });
});
