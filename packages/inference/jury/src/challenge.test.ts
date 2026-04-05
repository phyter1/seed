import { describe, expect, test } from "bun:test";
import { runChallenge, type ChallengeConfig, type ChallengerInvoke } from "./challenge";
import type { InvokeResult, JurorResult } from "./types";

function juror(id: string, content: string, error: string | null = null): JurorResult {
  return { id, content, error, durationMs: 10, tokensPerSecond: 50 };
}

function findingsJson(
  opts: {
    contradictions?: string[];
    errors?: string[];
    gaps?: string[];
    confidence?: number;
    escalation_requested?: boolean;
  } = {},
): string {
  return JSON.stringify({
    contradictions: opts.contradictions ?? [],
    errors: opts.errors ?? [],
    gaps: opts.gaps ?? [],
    confidence: opts.confidence ?? 0.9,
    escalation_requested: opts.escalation_requested ?? false,
  });
}

function makeInvoker(content: string | Error, delayMs = 0): ChallengerInvoke {
  return async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    if (content instanceof Error) throw content;
    return { content, completionTokens: 20 } satisfies InvokeResult;
  };
}

const jurors: JurorResult[] = [
  juror("a", "Paris is the capital."),
  juror("b", "The capital is Paris."),
];

const baseArgs = {
  question: "what is the capital of france?",
  jurors,
};

describe("runChallenge", () => {
  test("parses findings and returns result at start tier", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      invokers: {
        local: makeInvoker(
          findingsJson({ errors: ["one juror missed punctuation"], confidence: 0.88 }),
        ),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.tier).toBe("local");
    expect(result.findings.confidence).toBe(0.88);
    expect(result.findings.errors).toEqual(["one juror missed punctuation"]);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].parseOk).toBe(true);
    expect(result.escalationExhausted).toBe(false);
    expect(result.cappedByTier).toBeNull();
  });

  test("escalates to midtier when local returns low confidence", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      confidenceThreshold: 0.7,
      invokers: {
        local: makeInvoker(findingsJson({ confidence: 0.4 })),
        midtier: makeInvoker(findingsJson({ confidence: 0.88, errors: ["fixed"] })),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.tier).toBe("midtier");
    expect(result.findings.confidence).toBe(0.88);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].tier).toBe("local");
    expect(result.attempts[1].tier).toBe("midtier");
  });

  test("escalates when escalation_requested is true even if confidence is high", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      invokers: {
        local: makeInvoker(findingsJson({ confidence: 0.95, escalation_requested: true })),
        midtier: makeInvoker(findingsJson({ confidence: 0.9 })),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.tier).toBe("midtier");
  });

  test("escalates on parse failure", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      invokers: {
        local: makeInvoker("not json at all, sorry"),
        midtier: makeInvoker(findingsJson({ confidence: 0.9 })),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.tier).toBe("midtier");
    expect(result.attempts[0].parseOk).toBe(false);
    expect(result.attempts[1].parseOk).toBe(true);
  });

  test("stops at maxTier when set below frontier", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      maxTier: "midtier",
      invokers: {
        local: makeInvoker(findingsJson({ confidence: 0.4 })),
        midtier: makeInvoker(findingsJson({ confidence: 0.5 })),
        frontier: makeInvoker(findingsJson({ confidence: 0.95 })),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.tier).toBe("midtier");
    expect(result.findings.confidence).toBe(0.5);
    expect(result.attempts).toHaveLength(2);
  });

  test("escalates through all three tiers when each requests escalation", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      invokers: {
        local: makeInvoker(findingsJson({ escalation_requested: true })),
        midtier: makeInvoker(findingsJson({ escalation_requested: true })),
        frontier: makeInvoker(findingsJson({ confidence: 0.98 })),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.tier).toBe("frontier");
    expect(result.attempts.map((a) => a.tier)).toEqual(["local", "midtier", "frontier"]);
  });

  test("does not escalate when escalate:false", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: false,
      invokers: {
        local: makeInvoker(findingsJson({ confidence: 0.2 })),
        midtier: makeInvoker(findingsJson({ confidence: 0.95 })),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.tier).toBe("local");
    expect(result.findings.confidence).toBe(0.2);
    expect(result.attempts).toHaveLength(1);
  });

  test("sensitivityLock + SENSITIVE forces maxTier to local", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      sensitivityLock: true,
      startTier: "local",
      invokers: {
        local: makeInvoker(findingsJson({ confidence: 0.3 })),
        midtier: makeInvoker(findingsJson({ confidence: 0.9 })),
      },
    };
    const result = await runChallenge({
      ...baseArgs,
      config,
      sensitivity: "SENSITIVE",
    });
    expect(result.tier).toBe("local");
    expect(result.cappedByTier).toBe("local");
    // Only one attempt — escalation would go to midtier but cap blocks it.
    expect(result.attempts).toHaveLength(1);
  });

  test("sensitivityLock + GENERAL does not cap", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      sensitivityLock: true,
      invokers: {
        local: makeInvoker(findingsJson({ confidence: 0.3 })),
        midtier: makeInvoker(findingsJson({ confidence: 0.9 })),
      },
    };
    const result = await runChallenge({
      ...baseArgs,
      config,
      sensitivity: "GENERAL",
    });
    expect(result.tier).toBe("midtier");
    expect(result.cappedByTier).toBeNull();
  });

  test("downgrades startTier when it exceeds sensitivity cap", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      sensitivityLock: true,
      startTier: "frontier",
      invokers: {
        local: makeInvoker(findingsJson({ confidence: 0.9 })),
        frontier: makeInvoker(findingsJson({ confidence: 0.98 })),
      },
    };
    const result = await runChallenge({
      ...baseArgs,
      config,
      sensitivity: "SENSITIVE",
    });
    expect(result.tier).toBe("local");
    expect(result.cappedByTier).toBe("local");
  });

  test("strict mode sets escalationExhausted when confidence stays below threshold", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      strictness: "strict",
      confidenceThreshold: 0.9,
      invokers: {
        local: makeInvoker(findingsJson({ confidence: 0.4 })),
        midtier: makeInvoker(findingsJson({ confidence: 0.5 })),
        frontier: makeInvoker(findingsJson({ confidence: 0.6 })),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.tier).toBe("frontier");
    expect(result.escalationExhausted).toBe(true);
  });

  test("advisory mode never sets escalationExhausted from low confidence", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      strictness: "advisory",
      confidenceThreshold: 0.9,
      invokers: {
        local: makeInvoker(findingsJson({ confidence: 0.1 })),
        midtier: makeInvoker(findingsJson({ confidence: 0.2 })),
        frontier: makeInvoker(findingsJson({ confidence: 0.3 })),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.escalationExhausted).toBe(false);
  });

  test("skips tier when invoker missing, continues to next if escalate:true", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      invokers: {
        // No local invoker.
        midtier: makeInvoker(findingsJson({ confidence: 0.9 })),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.tier).toBe("midtier");
    expect(result.attempts[0].tier).toBe("local");
    expect(result.attempts[0].error).toContain("no invoker configured");
  });

  test("returns empty findings + exhausted when all tiers fail", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      invokers: {
        local: makeInvoker("garbage"),
        midtier: makeInvoker("also garbage"),
        frontier: makeInvoker("still garbage"),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.findings.confidence).toBe(0);
    expect(result.findings.contradictions).toEqual([]);
    expect(result.escalationExhausted).toBe(true);
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts.every((a) => !a.parseOk)).toBe(true);
  });

  test("captures invoker error in attempt", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      invokers: {
        local: makeInvoker(new Error("network timeout")),
        midtier: makeInvoker(findingsJson({ confidence: 0.9 })),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.attempts[0].error).toBe("network timeout");
    expect(result.tier).toBe("midtier");
  });

  test("handles JSON wrapped in markdown fences", async () => {
    const wrapped = `Sure, here's the review:\n\`\`\`json\n${findingsJson({ confidence: 0.85 })}\n\`\`\``;
    const config: ChallengeConfig = {
      enabled: true,
      invokers: { local: makeInvoker(wrapped) },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.findings.confidence).toBe(0.85);
  });

  test("handles JSON with <think> tags", async () => {
    const wrapped = `<think>let me analyze...</think>${findingsJson({ confidence: 0.77 })}`;
    const config: ChallengeConfig = {
      enabled: true,
      invokers: { local: makeInvoker(wrapped) },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.findings.confidence).toBe(0.77);
  });

  test("clamps confidence to [0, 1]", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      invokers: {
        local: makeInvoker(JSON.stringify({ confidence: 1.5, contradictions: [], errors: [], gaps: [] })),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    expect(result.findings.confidence).toBe(1);
  });

  test("rejects response with non-numeric confidence", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      escalate: false,
      invokers: {
        local: makeInvoker(
          JSON.stringify({ confidence: "high", contradictions: [], errors: [], gaps: [] }),
        ),
      },
    };
    const result = await runChallenge({ ...baseArgs, config });
    // Parse failure — confidence isn't a number, so findings aren't extracted.
    expect(result.attempts[0].parseOk).toBe(false);
    expect(result.escalationExhausted).toBe(true);
  });

  test("passes only valid jurors into the challenger prompt", async () => {
    let captured = "";
    const config: ChallengeConfig = {
      enabled: true,
      invokers: {
        local: async (msgs) => {
          captured = msgs[msgs.length - 1].content;
          return { content: findingsJson({ confidence: 0.9 }) };
        },
      },
    };
    const jurorsWithFail: JurorResult[] = [
      juror("ok1", "good response"),
      juror("fail", "", "timeout"),
      juror("ok2", "another good response"),
    ];
    await runChallenge({ question: "q", jurors: jurorsWithFail, config });
    expect(captured).toContain("ok1");
    expect(captured).toContain("ok2");
    expect(captured).not.toContain("Juror 3 (fail)");
  });

  test("uses custom systemPrompt when provided", async () => {
    let sysCaptured = "";
    const config: ChallengeConfig = {
      enabled: true,
      systemPrompt: "you are a code reviewer",
      invokers: {
        local: async (msgs) => {
          sysCaptured = msgs[0].content;
          return { content: findingsJson({ confidence: 0.9 }) };
        },
      },
    };
    await runChallenge({ ...baseArgs, config });
    expect(sysCaptured).toBe("you are a code reviewer");
  });
});
