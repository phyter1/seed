/**
 * Tests for the mlx-lifecycle module — readiness probes and port-free wait.
 *
 * Tests for waitForMlxReady and waitMlxPortFree using mocked fetch and net.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { waitForMlxReady } from "./mlx-lifecycle";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── waitForMlxReady ───────────────────────────────────────────────────────

describe("waitForMlxReady", () => {
  test("resolves when /v1/models responds OK", async () => {
    let callCount = 0;
    globalThis.fetch = (async (url: string) => {
      callCount++;
      if (url.includes("/v1/models")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await waitForMlxReady("localhost:8080", 5000);
    expect(result).toBe(true);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  test("resolves true after initial failures followed by success", async () => {
    let callCount = 0;
    globalThis.fetch = (async (url: string) => {
      callCount++;
      if (callCount < 3) {
        throw new Error("not ready");
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await waitForMlxReady("localhost:8080", 10000);
    expect(result).toBe(true);
    expect(callCount).toBe(3);
  });

  test("times out and returns false when server never responds", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    const result = await waitForMlxReady("localhost:8080", 1000);
    expect(result).toBe(false);
  });
});
