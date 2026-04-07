/**
 * Tests for the jury-wiring module — task building, assignments, aggregator,
 * SSE formatting, and juror result mapping.
 */

import { describe, test, expect } from "bun:test";
import {
  buildJuryTasks,
  buildJurorAssignments,
  toRouterJuror,
  sseEvent,
  makeRouterAggregator,
  aggregatorMachine,
  JURY_TEMPERATURES,
  type JuryTask,
} from "./jury-wiring";
import type { ModelEntry } from "./types";
import type { JurorResult as SeedJurorResult } from "@seed/jury";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(machine: string, model: string): ModelEntry {
  return {
    machine,
    host: `${machine}.local:11434`,
    provider: "ollama",
    model,
    tags: ["general"],
    priority: 1,
  };
}

function makeMlxEntry(): ModelEntry {
  return {
    machine: "mlx_ren3",
    host: "ren3.local:8080",
    provider: "openai_compatible",
    model: "mlx-community/Qwen3.5-9B-MLX-4bit",
    tags: ["general"],
    priority: 1,
  };
}

// ── buildJuryTasks ────────────────────────────────────────────────────────

describe("buildJuryTasks", () => {
  test("generates tasks for all machine/model combinations", () => {
    const juryModels = [
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren2", "gemma4:e4b"),
    ];
    const ollamaMachines = [
      { name: "ren1", host: "ren1.local:11434" },
      { name: "ren2", host: "ren2.local:11434" },
    ];

    const tasks = buildJuryTasks(juryModels, ollamaMachines);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].jurorId).toBe("gemma4:e2b@ren1");
    expect(tasks[1].jurorId).toBe("gemma4:e4b@ren2");
    expect(tasks[0].index).toBe(0);
    expect(tasks[1].index).toBe(1);
  });

  test("assigns temperatures in round-robin from JURY_TEMPERATURES", () => {
    const juryModels = [
      makeEntry("ren1", "gemma4:e2b"),
      makeEntry("ren2", "gemma4:e4b"),
      makeEntry("ren1", "gemma4:e4b"),
    ];
    const ollamaMachines = [
      { name: "ren1", host: "ren1.local:11434" },
      { name: "ren2", host: "ren2.local:11434" },
    ];

    const tasks = buildJuryTasks(juryModels, ollamaMachines);
    expect(tasks[0].temperature).toBe(JURY_TEMPERATURES[0]);
    expect(tasks[1].temperature).toBe(JURY_TEMPERATURES[1]);
    expect(tasks[2].temperature).toBe(JURY_TEMPERATURES[2]);
  });

  test("returns empty array when no matching models", () => {
    const tasks = buildJuryTasks([], [{ name: "ren1", host: "ren1.local:11434" }]);
    expect(tasks).toHaveLength(0);
  });
});

// ── buildJurorAssignments ─────────────────────────────────────────────────

describe("buildJurorAssignments", () => {
  test("creates assignments with invoke functions", () => {
    const juryModels = [makeEntry("ren1", "gemma4:e2b")];
    const ollamaMachines = [{ name: "ren1", host: "ren1.local:11434" }];
    const tasks = buildJuryTasks(juryModels, ollamaMachines);

    const mockCallOllama = async () => ({
      content: "test response",
      model: "gemma4:e2b",
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });

    const assignments = buildJurorAssignments(tasks, mockCallOllama);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].id).toBe("gemma4:e2b@ren1");
    expect(typeof assignments[0].invoke).toBe("function");
  });

  test("invoke calls callOllama with correct parameters", async () => {
    const juryModels = [makeEntry("ren1", "gemma4:e2b")];
    const ollamaMachines = [{ name: "ren1", host: "ren1.local:11434" }];
    const tasks = buildJuryTasks(juryModels, ollamaMachines);

    let capturedArgs: unknown[] = [];
    const mockCallOllama = async (...args: unknown[]) => {
      capturedArgs = args;
      return {
        content: "test response",
        model: "gemma4:e2b",
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      };
    };

    const assignments = buildJurorAssignments(tasks, mockCallOllama as any);
    const result = await assignments[0].invoke(
      [{ role: "user", content: "hi" }],
      { temperature: 0.5, maxTokens: 512 },
    );

    expect(capturedArgs[0]).toBe("ren1.local:11434");
    expect(capturedArgs[1]).toBe("gemma4:e2b");
    expect(result.content).toBe("test response");
    expect(result.promptTokens).toBe(10);
    expect(result.completionTokens).toBe(20);
  });
});

// ── aggregatorMachine ─────────────────────────────────────────────────────

describe("aggregatorMachine", () => {
  test("returns the openai_compatible machine name", () => {
    const fleet = [makeMlxEntry(), makeEntry("ren1", "gemma4:e2b")];
    expect(aggregatorMachine(fleet)).toBe("mlx_ren3");
  });

  test("returns 'mlx' when no openai_compatible entry exists", () => {
    const fleet = [makeEntry("ren1", "gemma4:e2b")];
    expect(aggregatorMachine(fleet)).toBe("mlx");
  });
});

// ── toRouterJuror ─────────────────────────────────────────────────────────

describe("toRouterJuror", () => {
  test("maps seed juror result to router shape", () => {
    const task: JuryTask = {
      entry: makeEntry("ren1", "gemma4:e2b"),
      temperature: 0.5,
      jurorId: "gemma4:e2b@ren1",
      index: 0,
    };
    const seedResult: SeedJurorResult = {
      id: "gemma4:e2b@ren1",
      content: "the answer",
      tokensPerSecond: 31.5,
      durationMs: 1500,
      error: null,
    };

    const result = toRouterJuror(seedResult, task);
    expect(result.machine).toBe("ren1");
    expect(result.model).toBe("gemma4:e2b");
    expect(result.content).toBe("the answer");
    expect(result.tokS).toBe(31.5);
    expect(result.wallS).toBe(1.5);
    expect(result.error).toBeNull();
  });

  test("preserves error from seed result", () => {
    const task: JuryTask = {
      entry: makeEntry("ren1", "gemma4:e2b"),
      temperature: 0.5,
      jurorId: "gemma4:e2b@ren1",
      index: 0,
    };
    const seedResult: SeedJurorResult = {
      id: "gemma4:e2b@ren1",
      content: "",
      tokensPerSecond: 0,
      durationMs: 500,
      error: "timeout",
    };

    const result = toRouterJuror(seedResult, task);
    expect(result.error).toBe("timeout");
    expect(result.content).toBe("");
  });
});

// ── sseEvent ──────────────────────────────────────────────────────────────

describe("sseEvent", () => {
  test("formats SSE correctly", () => {
    const result = sseEvent("juror.done", { machine: "ren1", answer: "42" });
    expect(result).toBe('event: juror.done\ndata: {"machine":"ren1","answer":"42"}\n\n');
  });

  test("handles nested data", () => {
    const result = sseEvent("test", { a: { b: 1 } });
    expect(result).toContain("event: test\n");
    expect(result).toContain('data: {"a":{"b":1}}\n\n');
  });
});

// ── makeRouterAggregator ──────────────────────────────────────────────────

describe("makeRouterAggregator", () => {
  test("returns single response when only one valid juror", async () => {
    const mockCallOpenAI = async () => ({
      content: "should not be called",
      model: "test",
    });

    const aggregator = makeRouterAggregator(
      "ren3.local:8080",
      "test-model",
      mockCallOpenAI,
      512,
    );

    const result = await aggregator({
      question: "what is 2+2?",
      jurors: [
        { id: "j1", content: "4", tokensPerSecond: 10, durationMs: 100, error: null },
      ],
    });

    expect(result).toBe("4");
  });

  test("throws when all jurors failed", async () => {
    const mockCallOpenAI = async () => ({
      content: "should not be called",
      model: "test",
    });

    const aggregator = makeRouterAggregator(
      "ren3.local:8080",
      "test-model",
      mockCallOpenAI,
      512,
    );

    await expect(
      aggregator({
        question: "what is 2+2?",
        jurors: [
          { id: "j1", content: "", tokensPerSecond: 0, durationMs: 100, error: "timeout" },
        ],
      }),
    ).rejects.toThrow("All jurors failed");
  });

  test("calls OpenAI-compatible endpoint when multiple valid jurors", async () => {
    let capturedMessages: unknown[] = [];
    const mockCallOpenAI = async (_host: string, _model: string, messages: unknown[]) => {
      capturedMessages = messages;
      return {
        content: "synthesized answer",
        model: "test-model",
      };
    };

    const aggregator = makeRouterAggregator(
      "ren3.local:8080",
      "test-model",
      mockCallOpenAI,
      512,
    );

    const result = await aggregator({
      question: "what is 2+2?",
      jurors: [
        { id: "j1", content: "4", tokensPerSecond: 10, durationMs: 100, error: null },
        { id: "j2", content: "four", tokensPerSecond: 12, durationMs: 90, error: null },
      ],
    });

    expect(result).toBe("synthesized answer");
    expect(capturedMessages).toHaveLength(1);
    const msg = capturedMessages[0] as { content: string };
    expect(msg.content).toContain("synthesizing 2 model responses");
    expect(msg.content).toContain("[Juror 1 (j1)]");
    expect(msg.content).toContain("[Juror 2 (j2)]");
  });
});
