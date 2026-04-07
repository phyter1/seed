/**
 * Tests for the routing module — keyword-based classification and sampler presets.
 */

import { describe, test, expect } from "bun:test";
import { routeRequest, classifyMessages, getSamplerSettings } from "./routing";
import type { ModelEntry } from "./types";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    machine: "mlx_ren3",
    host: "ren3.local:8080",
    provider: "openai_compatible",
    model: "mlx-community/Qwen3.5-9B-MLX-4bit",
    tags: ["general"],
    priority: 1,
    ...overrides,
  };
}

function makeFleet(): ModelEntry[] {
  return [
    makeEntry(),
    makeEntry({
      machine: "ollama_ren1",
      host: "ren1.local:11434",
      provider: "ollama",
      model: "gemma4:e2b",
      tags: ["general"],
      priority: 2,
    }),
    makeEntry({
      machine: "ollama_ren2",
      host: "ren2.local:11434",
      provider: "ollama",
      model: "gemma4:e4b",
      tags: ["code"],
      priority: 3,
    }),
  ];
}

// ── routeRequest ──────────────────────────────────────────────────────────

describe("routeRequest", () => {
  test("returns explicit model when requested", () => {
    const fleet = makeFleet();
    const result = routeRequest(fleet, "hello", { model: "gemma4:e2b" });
    expect(result.entry.model).toBe("gemma4:e2b");
    expect(result.reason).toContain("explicit");
    expect(result.needsThinking).toBe(false);
  });

  test("routes math/reasoning content to fallback", () => {
    const fleet = makeFleet();
    const result = routeRequest(fleet, "calculate the integral of x^2 dx");
    expect(result.entry.provider).toBe("openai_compatible");
    expect(result.reason).toBe("math/reasoning");
    expect(result.needsThinking).toBe(false);
  });

  test("routes code content to code entry", () => {
    const fleet = makeFleet();
    const result = routeRequest(fleet, "refactor this typescript function");
    expect(result.entry.tags).toContain("code");
    expect(result.reason).toBe("code task");
  });

  test("routes reasoning content to fallback", () => {
    const fleet = makeFleet();
    const result = routeRequest(fleet, "analyze the trade-offs between these architectures");
    expect(result.entry.provider).toBe("openai_compatible");
    expect(result.reason).toBe("reasoning");
  });

  test("defaults to fast general-purpose", () => {
    const fleet = makeFleet();
    const result = routeRequest(fleet, "what is the weather today?");
    expect(result.reason).toBe("default (general, fast)");
  });

  test("routes fast/simple tasks", () => {
    const fleet = makeFleet();
    const result = routeRequest(fleet, "hello there");
    expect(result.reason).toBe("fast/simple task");
  });

  test("explicit thinking requested routes to thinking entry", () => {
    const fleet = [
      makeEntry({ thinking: true, tags: ["deep-reasoning"] }),
      makeEntry({ machine: "ollama_ren1", provider: "ollama", model: "gemma4:e2b", priority: 2 }),
    ];
    const result = routeRequest(fleet, "anything", { thinking: true });
    expect(result.needsThinking).toBe(true);
    expect(result.reason).toBe("explicit thinking requested");
  });

  test("ignores model=auto", () => {
    const fleet = makeFleet();
    const result = routeRequest(fleet, "hello", { model: "auto" });
    expect(result.reason).toBe("fast/simple task");
  });
});

// ── getSamplerSettings ────────────────────────────────────────────────────

describe("getSamplerSettings", () => {
  test("returns thinking preset for thinking=true", () => {
    const settings = getSamplerSettings(true, "anything");
    expect(settings.temperature).toBe(0.6);
    expect(settings.maxTokens).toBe(8192);
  });

  test("returns code preset for code tasks", () => {
    const settings = getSamplerSettings(false, "code task");
    expect(settings.temperature).toBe(0.3);
    expect(settings.maxTokens).toBe(4096);
  });

  test("returns classification preset for fast tasks", () => {
    const settings = getSamplerSettings(false, "fast/simple task");
    expect(settings.temperature).toBe(0.3);
    expect(settings.maxTokens).toBe(256);
  });

  test("returns default preset", () => {
    const settings = getSamplerSettings(false, "math/reasoning");
    expect(settings.temperature).toBe(0.7);
    expect(settings.maxTokens).toBe(2048);
  });
});

// ── classifyMessages ──────────────────────────────────────────────────────

describe("classifyMessages", () => {
  test("delegates to identity profile for sensitive content", () => {
    const result = classifyMessages([
      { role: "user", content: "my API key is sk-abc123def456ghi789jkl012" },
    ]);
    expect(result.level).toBe("SENSITIVE");
    expect(result.local_only).toBe(true);
  });

  test("delegates to identity profile for general content", () => {
    const result = classifyMessages([
      { role: "user", content: "What is the weather like today?" },
    ]);
    expect(result.level).toBe("GENERAL");
    expect(result.local_only).toBe(false);
  });
});
