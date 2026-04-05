import { describe, expect, test } from "bun:test";
import { runJury } from "./jury";
import type {
  AggregatorFn,
  ChatMessage,
  InvokeResult,
  JurorAssignment,
  JurorResult,
  JuryRequest,
} from "./types";

function ok(content: string, completionTokens = 10): InvokeResult {
  return { content, promptTokens: 5, completionTokens };
}

function juror(id: string, result: InvokeResult | Error, delayMs = 0): JurorAssignment {
  return {
    id,
    role: `juror-${id}`,
    invoke: async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const passThroughAggregator: AggregatorFn = async ({ jurors }) => {
  const valid = jurors.filter((j) => !j.error && j.content.length > 0);
  if (valid.length === 0) throw new Error("All jurors failed");
  return `consensus(${valid.map((j) => j.content).join("|")})`;
};

const baseMessages: ChatMessage[] = [
  { role: "system", content: "be terse" },
  { role: "user", content: "what is the capital of france?" },
];

describe("runJury", () => {
  test("fans out to all jurors and aggregates", async () => {
    const req: JuryRequest = {
      messages: baseMessages,
      jurors: [juror("a", ok("paris")), juror("b", ok("paris.")), juror("c", ok("PARIS"))],
      aggregator: passThroughAggregator,
    };
    const res = await runJury(req);
    expect(res.consensus).toBe("consensus(paris|paris.|PARIS)");
    expect(res.jurors).toHaveLength(3);
    expect(res.jurors.every((j) => j.error === null)).toBe(true);
    expect(res.agreement).toBeGreaterThan(0);
  });

  test("captures juror errors without failing the run", async () => {
    const req: JuryRequest = {
      messages: baseMessages,
      jurors: [juror("a", ok("paris")), juror("b", new Error("timeout"))],
      aggregator: passThroughAggregator,
    };
    const res = await runJury(req);
    expect(res.jurors[0].error).toBeNull();
    expect(res.jurors[1].error).toBe("timeout");
    expect(res.jurors[1].content).toBe("");
    expect(res.consensus).toBe("consensus(paris)");
  });

  test("throws if all jurors fail and aggregator signals", async () => {
    const req: JuryRequest = {
      messages: baseMessages,
      jurors: [juror("a", new Error("boom")), juror("b", new Error("boom"))],
      aggregator: passThroughAggregator,
    };
    await expect(runJury(req)).rejects.toThrow("All jurors failed");
  });

  test("throws if jurors array is empty", async () => {
    const req: JuryRequest = {
      messages: baseMessages,
      jurors: [],
      aggregator: passThroughAggregator,
    };
    await expect(runJury(req)).rejects.toThrow(/empty/);
  });

  test("honors explicit temperature override on juror", async () => {
    const temps: number[] = [];
    const j: JurorAssignment = {
      id: "temp-check",
      temperature: 0.77,
      invoke: async (_msgs, opts) => {
        temps.push(opts.temperature);
        return ok("x");
      },
    };
    await runJury({
      messages: baseMessages,
      jurors: [j],
      aggregator: passThroughAggregator,
    });
    expect(temps).toEqual([0.77]);
  });

  test("assigns default temperature cycle when jurors don't specify", async () => {
    const temps: number[] = [];
    const makeJ = (id: string): JurorAssignment => ({
      id,
      invoke: async (_msgs, opts) => {
        temps.push(opts.temperature);
        return ok("x");
      },
    });
    await runJury({
      messages: baseMessages,
      jurors: [makeJ("a"), makeJ("b"), makeJ("c"), makeJ("d"), makeJ("e")],
      aggregator: passThroughAggregator,
    });
    expect(temps).toEqual([0.3, 0.5, 0.7, 0.9, 0.3]);
  });

  test("passes maxTokens from request through to invoke", async () => {
    let capturedMax = 0;
    const j: JurorAssignment = {
      id: "max-check",
      invoke: async (_msgs, opts) => {
        capturedMax = opts.maxTokens;
        return ok("x");
      },
    };
    await runJury({
      messages: baseMessages,
      jurors: [j],
      aggregator: passThroughAggregator,
      maxTokens: 1024,
    });
    expect(capturedMax).toBe(1024);
  });

  test("defaults maxTokens to 512 when not specified", async () => {
    let capturedMax = 0;
    const j: JurorAssignment = {
      id: "max-check",
      invoke: async (_msgs, opts) => {
        capturedMax = opts.maxTokens;
        return ok("x");
      },
    };
    await runJury({
      messages: baseMessages,
      jurors: [j],
      aggregator: passThroughAggregator,
    });
    expect(capturedMax).toBe(512);
  });

  test("calls onJurorComplete for success and error", async () => {
    const completions: JurorResult[] = [];
    const req: JuryRequest = {
      messages: baseMessages,
      jurors: [juror("a", ok("paris")), juror("b", new Error("boom"))],
      aggregator: passThroughAggregator,
      onJurorComplete: (r) => completions.push(r),
    };
    await runJury(req);
    expect(completions).toHaveLength(2);
    const byId = Object.fromEntries(completions.map((c) => [c.id, c]));
    expect(byId.a.error).toBeNull();
    expect(byId.b.error).toBe("boom");
  });

  test("calls onAggregateComplete with success status", async () => {
    let info: { durationMs: number; status: string } | null = null;
    const req: JuryRequest = {
      messages: baseMessages,
      jurors: [juror("a", ok("paris"))],
      aggregator: passThroughAggregator,
      onAggregateComplete: (i) => {
        info = i;
      },
    };
    await runJury(req);
    expect(info).not.toBeNull();
    expect(info!.status).toBe("success");
    expect(info!.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("calls onAggregateComplete with error status when aggregator throws", async () => {
    let info: { status: string; error?: string } | null = null;
    const failingAggregator: AggregatorFn = async () => {
      throw new Error("aggregator down");
    };
    const req: JuryRequest = {
      messages: baseMessages,
      jurors: [juror("a", ok("paris"))],
      aggregator: failingAggregator,
      onAggregateComplete: (i) => {
        info = i;
      },
    };
    await expect(runJury(req)).rejects.toThrow("aggregator down");
    expect(info).not.toBeNull();
    expect(info!.status).toBe("error");
    expect(info!.error).toBe("aggregator down");
  });

  test("uses custom queue hook for each juror", async () => {
    const calls: string[] = [];
    const queue = async <T>(id: string, task: () => Promise<T>): Promise<T> => {
      calls.push(id);
      return task();
    };
    await runJury({
      messages: baseMessages,
      jurors: [juror("a", ok("x")), juror("b", ok("y"))],
      aggregator: passThroughAggregator,
      queue,
    });
    expect(calls.sort()).toEqual(["a", "b"]);
  });

  test("computes tokensPerSecond from completionTokens + duration", async () => {
    const j: JurorAssignment = {
      id: "slow",
      invoke: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { content: "ok", completionTokens: 100 };
      },
    };
    const res = await runJury({
      messages: baseMessages,
      jurors: [j],
      aggregator: passThroughAggregator,
    });
    expect(res.jurors[0].tokensPerSecond).toBeGreaterThan(0);
  });

  test("passes last user message as question to aggregator", async () => {
    let capturedQuestion = "";
    const ag: AggregatorFn = async ({ question }) => {
      capturedQuestion = question;
      return "ok";
    };
    await runJury({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "first" },
        { role: "assistant", content: "a" },
        { role: "user", content: "second" },
      ],
      jurors: [juror("a", ok("x"))],
      aggregator: ag,
    });
    expect(capturedQuestion).toBe("second");
  });

  test("single juror success is aggregated normally", async () => {
    const res = await runJury({
      messages: baseMessages,
      jurors: [juror("solo", ok("the only answer"))],
      aggregator: passThroughAggregator,
    });
    expect(res.consensus).toBe("consensus(the only answer)");
    expect(res.jurors).toHaveLength(1);
    expect(res.agreement).toBe(1);
  });

  test("fans out concurrently (total time ≈ slowest juror)", async () => {
    const start = Date.now();
    const res = await runJury({
      messages: baseMessages,
      jurors: [
        juror("a", ok("x"), 60),
        juror("b", ok("y"), 60),
        juror("c", ok("z"), 60),
      ],
      aggregator: passThroughAggregator,
    });
    const elapsed = Date.now() - start;
    // Sequential would be ≥180ms. Concurrent should be under 150ms
    // with generous headroom for CI jitter.
    expect(elapsed).toBeLessThan(150);
    expect(res.jurors).toHaveLength(3);
  });
});
