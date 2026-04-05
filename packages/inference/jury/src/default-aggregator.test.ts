import { describe, expect, test } from "bun:test";
import { makeDefaultAggregator } from "./default-aggregator";
import type { ChatMessage, InvokeResult, JurorResult } from "./types";

function juror(id: string, content: string, error: string | null = null): JurorResult {
  return {
    id,
    content,
    error,
    durationMs: 10,
    tokensPerSecond: 50,
  };
}

describe("makeDefaultAggregator", () => {
  test("short-circuits to single juror when only one is valid", async () => {
    let invoked = false;
    const invoke = async (): Promise<InvokeResult> => {
      invoked = true;
      return { content: "should not be called" };
    };
    const aggregator = makeDefaultAggregator({ invoke });
    const result = await aggregator({
      question: "q",
      jurors: [juror("a", "alpha"), juror("b", "", "timeout")],
      maxTokens: 256,
    });
    expect(result).toBe("alpha");
    expect(invoked).toBe(false);
  });

  test("throws when all jurors failed", async () => {
    const invoke = async (): Promise<InvokeResult> => ({ content: "" });
    const aggregator = makeDefaultAggregator({ invoke });
    await expect(
      aggregator({
        question: "q",
        jurors: [juror("a", "", "err"), juror("b", "", "err")],
        maxTokens: 256,
      }),
    ).rejects.toThrow("All jurors failed");
  });

  test("synthesizes when multiple jurors valid", async () => {
    let captured: { messages: ChatMessage[]; temperature: number; maxTokens: number } | null = null;
    const invoke = async (
      messages: ChatMessage[],
      opts: { temperature: number; maxTokens: number },
    ): Promise<InvokeResult> => {
      captured = { messages, temperature: opts.temperature, maxTokens: opts.maxTokens };
      return { content: "synthesized answer" };
    };
    const aggregator = makeDefaultAggregator({ invoke });
    const result = await aggregator({
      question: "what is the capital of france?",
      jurors: [juror("a", "Paris."), juror("b", "The capital is Paris.")],
      maxTokens: 256,
    });
    expect(result).toBe("synthesized answer");
    expect(captured).not.toBeNull();
    expect(captured!.temperature).toBe(0.3);
    expect(captured!.maxTokens).toBe(256);
    const userPrompt = captured!.messages.find((m) => m.role === "user")!.content;
    expect(userPrompt).toContain("what is the capital of france?");
    expect(userPrompt).toContain("Paris.");
    expect(userPrompt).toContain("The capital is Paris.");
    expect(userPrompt).toContain("Juror 1");
    expect(userPrompt).toContain("Juror 2");
  });

  test("honors custom temperature", async () => {
    let captured = 0;
    const invoke = async (_m: ChatMessage[], opts: { temperature: number; maxTokens: number }) => {
      captured = opts.temperature;
      return { content: "x" };
    };
    const aggregator = makeDefaultAggregator({ invoke, temperature: 0.9 });
    await aggregator({
      question: "q",
      jurors: [juror("a", "one"), juror("b", "two")],
      maxTokens: 100,
    });
    expect(captured).toBe(0.9);
  });

  test("prepends custom system prompt when provided", async () => {
    let messages: ChatMessage[] = [];
    const invoke = async (m: ChatMessage[]) => {
      messages = m;
      return { content: "x" };
    };
    const aggregator = makeDefaultAggregator({ invoke, systemPrompt: "be a pirate" });
    await aggregator({
      question: "q",
      jurors: [juror("a", "one"), juror("b", "two")],
      maxTokens: 100,
    });
    expect(messages[0]).toEqual({ role: "system", content: "be a pirate" });
    expect(messages).toHaveLength(2);
  });

  test("includes juror role in prompt label when provided", async () => {
    let captured = "";
    const invoke = async (m: ChatMessage[]) => {
      captured = m.find((x) => x.role === "user")!.content;
      return { content: "x" };
    };
    const aggregator = makeDefaultAggregator({ invoke });
    const jRoles: JurorResult[] = [
      { ...juror("gemma4:e2b@ren1", "a"), role: "fast-reviewer" },
      { ...juror("gemma4:e4b@ren2", "b"), role: "quality-reviewer" },
    ];
    await aggregator({ question: "q", jurors: jRoles, maxTokens: 100 });
    expect(captured).toContain("fast-reviewer — gemma4:e2b@ren1");
    expect(captured).toContain("quality-reviewer — gemma4:e4b@ren2");
  });
});
