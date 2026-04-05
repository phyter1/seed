import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { envKeyChain, resolveApiKey } from "./env-keys";

describe("resolveApiKey", () => {
  const snapshot: Record<string, string | undefined> = {};
  const keys = [
    "SEED_ANTHROPIC_API_KEY",
    "ANTHROPIC_API_KEY",
    "SEED_OPENAI_API_KEY",
    "OPENAI_API_KEY",
    "SEED_GEMINI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "SEED_OPENROUTER_API_KEY",
    "OPENROUTER_API_KEY",
    "SEED_CEREBRAS_API_KEY",
    "CEREBRAS_API_KEY",
    "SEED_GROQ_API_KEY",
    "GROQ_API_KEY",
  ];

  beforeEach(() => {
    for (const k of keys) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  test("returns override when provided", () => {
    expect(resolveApiKey("openai", "explicit")).toBe("explicit");
  });

  test("prefers SEED_-prefixed key over vendor default", () => {
    process.env.SEED_OPENAI_API_KEY = "seed-k";
    process.env.OPENAI_API_KEY = "vendor-k";
    expect(resolveApiKey("openai")).toBe("seed-k");
  });

  test("falls back to vendor default when SEED_ is unset", () => {
    process.env.ANTHROPIC_API_KEY = "anth-k";
    expect(resolveApiKey("anthropic")).toBe("anth-k");
  });

  test("gemini falls back through 3-chain", () => {
    process.env.GOOGLE_API_KEY = "goog-k";
    expect(resolveApiKey("gemini")).toBe("goog-k");
    process.env.GEMINI_API_KEY = "gem-k";
    expect(resolveApiKey("gemini")).toBe("gem-k");
    process.env.SEED_GEMINI_API_KEY = "seed-gem";
    expect(resolveApiKey("gemini")).toBe("seed-gem");
  });

  test("throws with chain listed when all unset", () => {
    expect(() => resolveApiKey("cerebras")).toThrow(/SEED_CEREBRAS_API_KEY.*CEREBRAS_API_KEY/);
  });

  test("empty string is treated as unset", () => {
    process.env.SEED_GROQ_API_KEY = "";
    process.env.GROQ_API_KEY = "actual";
    expect(resolveApiKey("groq")).toBe("actual");
  });

  test("envKeyChain exposes chain for each cloud provider", () => {
    expect(envKeyChain("openai")).toEqual(["SEED_OPENAI_API_KEY", "OPENAI_API_KEY"]);
    expect(envKeyChain("ollama")).toEqual([]);
  });
});
