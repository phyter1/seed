/**
 * Tests for mlx-client — the mlx-vlm chat-completion client.
 *
 * Covers the contract with mlx_vlm.server:
 *   - `input_tokens` / `output_tokens` are parsed (not `prompt_tokens` /
 *     `completion_tokens`, which mlx-lm used).
 *   - `enable_thinking` flows into the request body when provided, and is
 *     omitted otherwise so mlx-vlm's default (false) applies.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { queryMLXChat } from "./mlx-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installFakeFetch(responseBody: unknown, captured: { url?: string; body?: string }) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    captured.url = url;
    captured.body = init?.body as string | undefined;
    return new Response(JSON.stringify(responseBody), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("queryMLXChat — mlx-vlm usage shape", () => {
  test("parses input_tokens / output_tokens from mlx-vlm response", async () => {
    const captured: { url?: string; body?: string } = {};
    installFakeFetch(
      {
        model: "mlx-community/Qwen3.5-9B-MLX-4bit",
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "2491", tool_calls: [] },
        }],
        usage: {
          input_tokens: 28,
          output_tokens: 5,
          total_tokens: 33,
          prompt_tps: 75.6,
          generation_tps: 35.0,
          peak_memory: 8.72,
        },
      },
      captured,
    );

    const res = await queryMLXChat(
      "ren3.local:8080",
      "mlx-community/Qwen3.5-9B-MLX-4bit",
      [{ role: "user", content: "What is 47 * 53? Answer with just the number." }],
    );

    expect(res.node).toBe("ren3");
    expect(res.response).toBe("2491");
    expect(res.totalTokens).toBe(5);
    expect(res.error).toBeUndefined();
  });

  test("defaults totalTokens to 0 when usage is absent", async () => {
    const captured: { url?: string; body?: string } = {};
    installFakeFetch(
      {
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "ok", tool_calls: [] },
        }],
      },
      captured,
    );

    const res = await queryMLXChat(
      "ren3.local:8080",
      "mlx-community/gemma-4-e2b-it-4bit",
      [{ role: "user", content: "hi" }],
    );

    expect(res.totalTokens).toBe(0);
    expect(res.response).toBe("ok");
  });
});

describe("queryMLXChat — enable_thinking request shape", () => {
  test("includes enable_thinking: true in body when opted in", async () => {
    const captured: { url?: string; body?: string } = {};
    installFakeFetch(
      { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "" } }] },
      captured,
    );

    await queryMLXChat(
      "ren3.local:8080",
      "mlx-community/Qwen3.5-9B-MLX-4bit",
      [{ role: "user", content: "hi" }],
      { enableThinking: true },
    );

    const body = JSON.parse(captured.body ?? "{}");
    expect(body.enable_thinking).toBe(true);
  });

  test("includes enable_thinking: false in body when explicitly disabled", async () => {
    const captured: { url?: string; body?: string } = {};
    installFakeFetch(
      { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "" } }] },
      captured,
    );

    await queryMLXChat(
      "ren3.local:8080",
      "mlx-community/Qwen3.5-9B-MLX-4bit",
      [{ role: "user", content: "hi" }],
      { enableThinking: false },
    );

    const body = JSON.parse(captured.body ?? "{}");
    expect(body.enable_thinking).toBe(false);
  });

  test("omits enable_thinking when not provided (mlx-vlm default of false applies)", async () => {
    const captured: { url?: string; body?: string } = {};
    installFakeFetch(
      { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "" } }] },
      captured,
    );

    await queryMLXChat(
      "ren3.local:8080",
      "mlx-community/gemma-4-e2b-it-4bit",
      [{ role: "user", content: "hi" }],
    );

    const body = JSON.parse(captured.body ?? "{}");
    expect("enable_thinking" in body).toBe(false);
  });
});
