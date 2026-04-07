/**
 * Tests for the clients module — OpenAI-compatible and Ollama HTTP clients.
 *
 * Uses globalThis.fetch mocking (matching existing test patterns in the repo).
 */

import { describe, test, expect, afterEach } from "bun:test";
import { callOpenAICompatible, callOllama } from "./clients";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installFakeFetch(
  responseBody: unknown,
  status = 200,
  captured: { url?: string; body?: string; method?: string } = {},
) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.url = typeof url === "string" ? url : url.toString();
    captured.body = init?.body as string | undefined;
    captured.method = init?.method;
    if (status >= 400) {
      return new Response(JSON.stringify(responseBody), { status });
    }
    return new Response(JSON.stringify(responseBody), { status });
  }) as unknown as typeof fetch;
  return captured;
}

// ── callOpenAICompatible ──────────────────────────────────────────────────

describe("callOpenAICompatible", () => {
  test("sends correct URL and body", async () => {
    const captured = installFakeFetch({
      model: "test-model",
      choices: [{ message: { content: "hello world", role: "assistant" } }],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });

    await callOpenAICompatible(
      "ren3.local:8080",
      "test-model",
      [{ role: "user", content: "hi" }],
      { temperature: 0.5, maxTokens: 1024 },
    );

    expect(captured.url).toBe("http://ren3.local:8080/v1/chat/completions");
    expect(captured.method).toBe("POST");
    const body = JSON.parse(captured.body!);
    expect(body.model).toBe("test-model");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(1024);
  });

  test("parses response correctly", async () => {
    installFakeFetch({
      model: "test-model",
      choices: [{ message: { content: "response text", reasoning: "thought process" } }],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });

    const result = await callOpenAICompatible(
      "ren3.local:8080",
      "test-model",
      [{ role: "user", content: "hi" }],
    );

    expect(result.content).toBe("response text");
    expect(result.reasoning).toBe("thought process");
    expect(result.model).toBe("test-model");
    expect(result.usage?.input_tokens).toBe(10);
    expect(result.usage?.output_tokens).toBe(20);
  });

  test("throws on non-2xx", async () => {
    installFakeFetch({ error: "bad request" }, 400);

    await expect(
      callOpenAICompatible("ren3.local:8080", "test-model", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("OpenAI-compatible ren3.local:8080 error: 400");
  });

  test("includes enable_thinking when set", async () => {
    const captured = installFakeFetch({
      choices: [{ message: { content: "ok" } }],
    });

    await callOpenAICompatible(
      "ren3.local:8080",
      "test-model",
      [{ role: "user", content: "hi" }],
      { enableThinking: true },
    );

    const body = JSON.parse(captured.body!);
    expect(body.enable_thinking).toBe(true);
  });

  test("omits enable_thinking when not set", async () => {
    const captured = installFakeFetch({
      choices: [{ message: { content: "ok" } }],
    });

    await callOpenAICompatible(
      "ren3.local:8080",
      "test-model",
      [{ role: "user", content: "hi" }],
    );

    const body = JSON.parse(captured.body!);
    expect("enable_thinking" in body).toBe(false);
  });
});

// ── callOllama ────────────────────────────────────────────────────────────

describe("callOllama", () => {
  test("sends to /api/chat with correct body", async () => {
    const captured = installFakeFetch({
      model: "gemma4:e2b",
      message: { content: "ollama response" },
      prompt_eval_count: 15,
      eval_count: 25,
    });

    await callOllama(
      "ren1.local:11434",
      "gemma4:e2b",
      [{ role: "user", content: "hi" }],
      { temperature: 0.5, maxTokens: 512 },
    );

    expect(captured.url).toBe("http://ren1.local:11434/api/chat");
    const body = JSON.parse(captured.body!);
    expect(body.model).toBe("gemma4:e2b");
    expect(body.stream).toBe(false);
    expect(body.options.temperature).toBe(0.5);
    expect(body.options.num_predict).toBe(512);
  });

  test("maps response to ChatResponse shape", async () => {
    installFakeFetch({
      model: "gemma4:e2b",
      message: { content: "the answer is 42" },
      prompt_eval_count: 15,
      eval_count: 25,
    });

    const result = await callOllama(
      "ren1.local:11434",
      "gemma4:e2b",
      [{ role: "user", content: "what is the answer?" }],
    );

    expect(result.content).toBe("the answer is 42");
    expect(result.model).toBe("gemma4:e2b");
    expect(result.usage?.input_tokens).toBe(15);
    expect(result.usage?.output_tokens).toBe(25);
    expect(result.usage?.total_tokens).toBe(40);
  });

  test("throws on non-2xx", async () => {
    installFakeFetch({ error: "model not found" }, 404);

    await expect(
      callOllama("ren1.local:11434", "missing-model", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("Ollama ren1.local:11434 error: 404");
  });

  test("defaults to 0.7 temperature and 2048 maxTokens", async () => {
    const captured = installFakeFetch({
      model: "gemma4:e2b",
      message: { content: "ok" },
    });

    await callOllama(
      "ren1.local:11434",
      "gemma4:e2b",
      [{ role: "user", content: "hi" }],
    );

    const body = JSON.parse(captured.body!);
    expect(body.options.temperature).toBe(0.7);
    expect(body.options.num_predict).toBe(2048);
  });
});
