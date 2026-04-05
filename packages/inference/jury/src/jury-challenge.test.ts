import { describe, expect, test } from "bun:test";
import { runJury } from "./jury";
import { makeDefaultAggregator } from "./default-aggregator";
import type { ChallengeConfig } from "./challenge";
import type {
  ChatMessage,
  InvokeResult,
  JurorAssignment,
  JuryRequest,
} from "./types";

function juror(id: string, content: string): JurorAssignment {
  return {
    id,
    invoke: async (): Promise<InvokeResult> => ({ content, completionTokens: 10 }),
  };
}

const baseMessages: ChatMessage[] = [
  { role: "user", content: "what is the capital of france?" },
];

function findingsJson(confidence = 0.9, escalation_requested = false): string {
  return JSON.stringify({
    contradictions: [],
    errors: ["one juror drifted off-topic"],
    gaps: [],
    confidence,
    escalation_requested,
  });
}

describe("runJury + challenge integration", () => {
  test("runs challenge when enabled and includes findings in response", async () => {
    const config: ChallengeConfig = {
      enabled: true,
      invokers: {
        local: async () => ({ content: findingsJson() }),
      },
    };
    const res = await runJury({
      messages: baseMessages,
      jurors: [juror("a", "Paris"), juror("b", "Paris.")],
      aggregator: async () => "Paris.",
      challenge: config,
    });
    expect(res.challenge).toBeDefined();
    expect(res.challenge!.findings.errors).toEqual(["one juror drifted off-topic"]);
    expect(res.challenge!.tier).toBe("local");
  });

  test("skips challenge when enabled:false", async () => {
    const res = await runJury({
      messages: baseMessages,
      jurors: [juror("a", "Paris"), juror("b", "Paris.")],
      aggregator: async () => "Paris.",
      challenge: { enabled: false, invokers: {} },
    });
    expect(res.challenge).toBeUndefined();
  });

  test("skips challenge when challenge undefined", async () => {
    const res = await runJury({
      messages: baseMessages,
      jurors: [juror("a", "Paris"), juror("b", "Paris.")],
      aggregator: async () => "Paris.",
    });
    expect(res.challenge).toBeUndefined();
  });

  test("passes challenge findings to aggregator context", async () => {
    let received: unknown = null;
    const config: ChallengeConfig = {
      enabled: true,
      invokers: {
        local: async () => ({ content: findingsJson(0.82) }),
      },
    };
    await runJury({
      messages: baseMessages,
      jurors: [juror("a", "Paris"), juror("b", "Paris.")],
      aggregator: async (ctx) => {
        received = ctx.challenge;
        return "ok";
      },
      challenge: config,
    });
    expect(received).not.toBeNull();
    const r = received as { tier: string; findings: { confidence: number } };
    expect(r.tier).toBe("local");
    expect(r.findings.confidence).toBe(0.82);
  });

  test("fires onChallengeComplete telemetry hook", async () => {
    let captured: unknown = null;
    const req: JuryRequest = {
      messages: baseMessages,
      jurors: [juror("a", "Paris"), juror("b", "Paris.")],
      aggregator: async () => "Paris.",
      challenge: {
        enabled: true,
        invokers: { local: async () => ({ content: findingsJson() }) },
      },
      onChallengeComplete: (r) => {
        captured = r;
      },
    };
    await runJury(req);
    expect(captured).not.toBeNull();
  });

  test("default aggregator weaves findings into prompt", async () => {
    let sentPrompt = "";
    const aggregator = makeDefaultAggregator({
      invoke: async (msgs) => {
        sentPrompt = msgs[msgs.length - 1].content;
        return { content: "synthesized" };
      },
    });
    const config: ChallengeConfig = {
      enabled: true,
      invokers: {
        local: async () =>
          ({
            content: JSON.stringify({
              contradictions: ["A says X, B says Y"],
              errors: ["B miscounted"],
              gaps: ["neither addressed time-of-day"],
              confidence: 0.85,
              escalation_requested: false,
            }),
          }),
      },
    };
    await runJury({
      messages: baseMessages,
      jurors: [juror("a", "A-response"), juror("b", "B-response")],
      aggregator,
      challenge: config,
    });
    expect(sentPrompt).toContain("Quality review");
    expect(sentPrompt).toContain("A says X, B says Y");
    expect(sentPrompt).toContain("B miscounted");
    expect(sentPrompt).toContain("neither addressed time-of-day");
    expect(sentPrompt).toContain("Incorporate corrections");
  });

  test("default aggregator skips review block when findings empty", async () => {
    let sentPrompt = "";
    const aggregator = makeDefaultAggregator({
      invoke: async (msgs) => {
        sentPrompt = msgs[msgs.length - 1].content;
        return { content: "synthesized" };
      },
    });
    const config: ChallengeConfig = {
      enabled: true,
      invokers: {
        local: async () =>
          ({
            content: JSON.stringify({
              contradictions: [],
              errors: [],
              gaps: [],
              confidence: 0.95,
              escalation_requested: false,
            }),
          }),
      },
    };
    await runJury({
      messages: baseMessages,
      jurors: [juror("a", "A-response"), juror("b", "B-response")],
      aggregator,
      challenge: config,
    });
    expect(sentPrompt).not.toContain("Quality review");
    expect(sentPrompt).not.toContain("Incorporate corrections");
  });

  test("sensitivity=SENSITIVE + sensitivityLock forces local tier", async () => {
    let localCalls = 0;
    let midtierCalls = 0;
    const config: ChallengeConfig = {
      enabled: true,
      escalate: true,
      sensitivityLock: true,
      invokers: {
        local: async () => {
          localCalls++;
          return { content: findingsJson(0.3) };
        },
        midtier: async () => {
          midtierCalls++;
          return { content: findingsJson(0.9) };
        },
      },
    };
    const res = await runJury({
      messages: baseMessages,
      jurors: [juror("a", "Paris"), juror("b", "Paris.")],
      aggregator: async () => "ok",
      challenge: config,
      sensitivity: "SENSITIVE",
    });
    expect(localCalls).toBe(1);
    expect(midtierCalls).toBe(0);
    expect(res.challenge!.cappedByTier).toBe("local");
  });
});
