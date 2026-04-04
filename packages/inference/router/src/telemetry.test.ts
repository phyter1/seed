/**
 * Tests for the router telemetry module.
 *
 * Covers:
 * - Endpoint resolution priority (env var > seed.config.json > null)
 * - Event builder shape and defaults
 * - Fire-and-forget semantics: emit returns immediately and never throws,
 *   even when the HTTP endpoint rejects, errors, or hangs.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, writeFileSync, existsSync } from "node:fs";
import {
  buildInferenceEvent,
  createTelemetryEmitter,
  resolveTelemetryEndpoint,
  samplerPresetLabel,
} from "./telemetry";

// ── Endpoint Resolution ────────────────────────────────────────────────────

describe("resolveTelemetryEndpoint", () => {
  const CONFIG_PATH = "/tmp/seed-telemetry-test.config.json";
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TELEMETRY_ENDPOINT;
    process.env.SEED_CONFIG = CONFIG_PATH;
    if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
  });

  afterEach(() => {
    if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
    process.env = { ...originalEnv };
  });

  test("returns null when no env var and no config file", () => {
    expect(resolveTelemetryEndpoint()).toBeNull();
  });

  test("returns env var when set", () => {
    process.env.TELEMETRY_ENDPOINT = "http://control-plane.local:4000/otlp/v1/logs";
    expect(resolveTelemetryEndpoint()).toBe("http://control-plane.local:4000/otlp/v1/logs");
  });

  test("trims whitespace from env var", () => {
    process.env.TELEMETRY_ENDPOINT = "  http://host:4000/ingest  ";
    expect(resolveTelemetryEndpoint()).toBe("http://host:4000/ingest");
  });

  test("falls back to seed.config.json telemetry.endpoint", () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({
      telemetry: { endpoint: "http://config.local:4000/ingest" },
    }));
    expect(resolveTelemetryEndpoint()).toBe("http://config.local:4000/ingest");
  });

  test("env var wins over config file", () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({
      telemetry: { endpoint: "http://config.local:4000/ingest" },
    }));
    process.env.TELEMETRY_ENDPOINT = "http://env.local:9999/ingest";
    expect(resolveTelemetryEndpoint()).toBe("http://env.local:9999/ingest");
  });

  test("returns null when config has no telemetry block", () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({ providers: {}, models: [] }));
    expect(resolveTelemetryEndpoint()).toBeNull();
  });

  test("returns null when telemetry.endpoint is empty string", () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({ telemetry: { endpoint: "" } }));
    expect(resolveTelemetryEndpoint()).toBeNull();
  });

  test("returns null on malformed config file (no throw)", () => {
    writeFileSync(CONFIG_PATH, "{ this is not: valid json");
    expect(resolveTelemetryEndpoint()).toBeNull();
  });
});

// ── Event Builder ──────────────────────────────────────────────────────────

describe("buildInferenceEvent", () => {
  test("constructs an inference_request event with required attributes", () => {
    const evt = buildInferenceEvent({
      model: "gemma4:e4b",
      machine: "ren1",
      provider: "ollama",
      route_type: "keyword",
      route_pattern: "code",
      tokens_prompt: 42,
      tokens_completion: 128,
      duration_ms: 3100,
      status: "success",
      thinking_mode: false,
      sampler_preset: "t=0.3/max=4096",
    });

    expect(evt.service_name).toBe("fleet-router");
    expect(evt.event_type).toBe("inference_request");
    expect(typeof evt.timestamp).toBe("string");
    // ISO timestamp shape
    expect(evt.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(evt.attributes.model).toBe("gemma4:e4b");
    expect(evt.attributes.machine).toBe("ren1");
    expect(evt.attributes.provider).toBe("ollama");
    expect(evt.attributes.route_type).toBe("keyword");
    expect(evt.attributes.route_pattern).toBe("code");
    expect(evt.attributes.tokens_prompt).toBe(42);
    expect(evt.attributes.tokens_completion).toBe(128);
    expect(evt.attributes.duration_ms).toBe(3100);
    expect(evt.attributes.status).toBe("success");
    expect(evt.attributes.thinking_mode).toBe(false);
    expect(evt.attributes.sampler_preset).toBe("t=0.3/max=4096");
  });

  test("allows custom event_type for jury events", () => {
    const evt = buildInferenceEvent({
      event_type: "jury_juror",
      model: "gemma4:e2b",
      machine: "ren2",
      provider: "ollama",
      route_type: "jury",
      route_pattern: "juror",
      tokens_prompt: 10,
      tokens_completion: 20,
      duration_ms: 500,
      status: "success",
      thinking_mode: false,
      sampler_preset: "t=0.5/max=512",
    });
    expect(evt.event_type).toBe("jury_juror");
  });

  test("merges extra attributes into attributes", () => {
    const evt = buildInferenceEvent({
      model: "m",
      machine: "ren3",
      provider: "mlx",
      route_type: "jury",
      route_pattern: "juror",
      tokens_prompt: 0,
      tokens_completion: 0,
      duration_ms: 0,
      status: "error",
      thinking_mode: false,
      sampler_preset: "t=0.7/max=2048",
      extra: { juror_index: 3, jury_size: 6, error: "timeout" },
    });
    expect(evt.attributes.juror_index).toBe(3);
    expect(evt.attributes.jury_size).toBe(6);
    expect(evt.attributes.error).toBe("timeout");
  });
});

// ── samplerPresetLabel ─────────────────────────────────────────────────────

describe("samplerPresetLabel", () => {
  test("formats temperature and maxTokens into a stable label", () => {
    expect(samplerPresetLabel(0.3, 4096)).toBe("t=0.3/max=4096");
    expect(samplerPresetLabel(0.7, 2048)).toBe("t=0.7/max=2048");
  });
});

// ── Fire-and-Forget Emitter ────────────────────────────────────────────────

describe("createTelemetryEmitter", () => {
  const sampleEvent = buildInferenceEvent({
    model: "m",
    machine: "ren1",
    provider: "ollama",
    route_type: "keyword",
    route_pattern: "default",
    tokens_prompt: 1,
    tokens_completion: 1,
    duration_ms: 1,
    status: "success",
    thinking_mode: false,
    sampler_preset: "t=0.7/max=2048",
  });

  test("is a no-op when endpoint is null", () => {
    const emitter = createTelemetryEmitter(null);
    expect(emitter.endpoint).toBeNull();
    // Must not throw, must not touch fetch.
    expect(() => emitter.emit(sampleEvent)).not.toThrow();
  });

  test("returns synchronously (does not await fetch)", () => {
    // Replace fetch with a never-resolving promise to prove emit doesn't block.
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Promise<Response>(() => { /* never resolves */ });
    }) as unknown as typeof fetch;

    try {
      const emitter = createTelemetryEmitter("http://telemetry.local/ingest");
      const startedAt = Date.now();
      emitter.emit(sampleEvent);
      const elapsed = Date.now() - startedAt;
      // emit must return essentially immediately
      expect(elapsed).toBeLessThan(50);
      expect(called).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("swallows errors when fetch rejects (no unhandled rejection)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    try {
      const emitter = createTelemetryEmitter("http://telemetry.local/ingest");
      expect(() => emitter.emit(sampleEvent)).not.toThrow();
      // Let the rejected promise settle; the catch handler attached inside
      // emit() must prevent an unhandled rejection.
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("sends event as JSON POST to the endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const emitter = createTelemetryEmitter("http://telemetry.local/ingest");
      emitter.emit(sampleEvent);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(capturedUrl).toBe("http://telemetry.local/ingest");
      expect(capturedInit?.method).toBe("POST");
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      const parsed = JSON.parse(capturedInit?.body as string);
      expect(parsed.service_name).toBe("fleet-router");
      expect(parsed.event_type).toBe("inference_request");
      expect(parsed.attributes.model).toBe("m");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
