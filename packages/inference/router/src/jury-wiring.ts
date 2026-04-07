/**
 * Jury mode wiring — builds jury tasks, assignments, aggregator, and orchestrates
 * fan-out/aggregate with telemetry and SSE streaming.
 *
 * Fan-out/aggregate mechanics live in @seed/jury. This module wires the
 * fleet's machine-queue, telemetry events, and SSE stream shape to that
 * primitive. The aggregator prompt is kept byte-identical to the prior
 * inline version so production synthesis behaviour does not drift.
 *
 * Functions that previously read module-level state accept those as parameters.
 * Functions that call clients accept those as injected dependencies.
 */

import type { ModelEntry, ChatMessage, JurorResult, JuryResult } from "./types";
import {
  runJury as runJuryPrimitive,
  type JurorAssignment as SeedJurorAssignment,
  type JurorResult as SeedJurorResult,
  type ChatMessage as SeedChatMessage,
} from "@seed/jury";
import {
  buildInferenceEvent,
  samplerPresetLabel,
  type TelemetryEmitter,
} from "./telemetry";
import type { ChatResponse } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────

export const JURY_TEMPERATURES = [0.3, 0.5, 0.7, 0.9];

export interface JuryTask {
  entry: ModelEntry;
  temperature: number;
  jurorId: string;
  index: number;
}

export type CallOllamaFn = (host: string, model: string, messages: ChatMessage[], options: { temperature?: number; maxTokens?: number }) => Promise<ChatResponse>;
export type CallOpenAICompatibleFn = (host: string, model: string, messages: ChatMessage[], options: { temperature?: number; maxTokens?: number; enableThinking?: boolean }) => Promise<ChatResponse>;
export type QueueFn = <T>(machine: string, fn: () => Promise<T>) => Promise<T>;

export interface JuryDeps {
  callOllama: CallOllamaFn;
  callOpenAICompatible: CallOpenAICompatibleFn;
  withMachineQueue: QueueFn;
  telemetry: TelemetryEmitter;
  fleet: ModelEntry[];
  juryModels: ModelEntry[];
  ollamaMachines: { name: string; host: string }[];
  mlxHost: string;
  mlxModel: string;
}

// ── Sentinel ──────────────────────────────────────────────────────────────

export class JuryAllFailedSentinel extends Error {
  constructor() {
    super("jury:all_jurors_failed");
    this.name = "JuryAllFailedSentinel";
  }
}

// ── Task Building ─────────────────────────────────────────────────────────

export function buildJuryTasks(juryModels: ModelEntry[], ollamaMachines: { name: string; host: string }[]): JuryTask[] {
  const ollamaMachineNames = ollamaMachines.map(m => m.name);
  const uniqueModels = [...new Set(juryModels.map(m => m.model))];
  const tasks: JuryTask[] = [];
  let tempIdx = 0;
  for (const machineName of ollamaMachineNames) {
    for (const model of uniqueModels) {
      const entry = juryModels.find(m => m.machine === machineName && m.model === model);
      if (entry) {
        tasks.push({
          entry,
          temperature: JURY_TEMPERATURES[tempIdx % JURY_TEMPERATURES.length],
          jurorId: `${entry.model}@${entry.machine}`,
          index: tasks.length,
        });
        tempIdx++;
      }
    }
  }
  return tasks;
}

// ── Juror Assignments ─────────────────────────────────────────────────────

export function buildJurorAssignments(tasks: JuryTask[], callOllamaFn: CallOllamaFn): SeedJurorAssignment[] {
  return tasks.map(({ entry, temperature, jurorId }) => ({
    id: jurorId,
    temperature,
    invoke: async (msgs: SeedChatMessage[], opts: { temperature: number; maxTokens: number }) => {
      const res = await callOllamaFn(entry.host, entry.model, msgs as ChatMessage[], {
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      });
      return {
        content: res.content,
        promptTokens: res.usage?.input_tokens,
        completionTokens: res.usage?.output_tokens,
      };
    },
  }));
}

// ── Aggregator ────────────────────────────────────────────────────────────

export function aggregatorMachine(fleet: ModelEntry[]): string {
  return (fleet.find(m => m.provider === "openai_compatible")?.machine) ?? "mlx";
}

/**
 * MLX-backed aggregator using the router's original synthesis prompt.
 * Matches the prior inline implementation byte-for-byte so deployed
 * behaviour is preserved.
 */
export function makeRouterAggregator(mlxHost: string, mlxModel: string, callOpenAICompatibleFn: CallOpenAICompatibleFn, maxTokens: number) {
  return async (ctx: { question: string; jurors: SeedJurorResult[] }): Promise<string> => {
    const valid = ctx.jurors.filter(r => !r.error && r.content.length > 0);
    if (valid.length === 0) throw new Error("All jurors failed");
    if (valid.length === 1) return valid[0].content;

    const responsesText = valid
      .map((r, i) => `[Juror ${i + 1} (${r.id})]:\n${r.content}`)
      .join("\n\n");

    const aggregationPrompt = `You are synthesizing ${valid.length} model responses into one best answer. Be concise and direct.

Question: ${ctx.question}

Responses:
${responsesText}

Synthesize into a single best response. Take the strongest elements from each. Do not mention the jurors or the synthesis process.`;

    const aggregated = await callOpenAICompatibleFn(
      mlxHost,
      mlxModel,
      [{ role: "user", content: aggregationPrompt }],
      { temperature: 0.3, maxTokens, enableThinking: false },
    );
    return aggregated.content;
  };
}

// ── Juror Result Mapping ──────────────────────────────────────────────────

/** Map a @seed/jury juror result back to the router's public JurorResult shape. */
export function toRouterJuror(seed: SeedJurorResult, task: JuryTask): JurorResult {
  return {
    machine: task.entry.machine,
    model: task.entry.model,
    content: seed.content,
    tokS: seed.tokensPerSecond,
    wallS: Math.round(seed.durationMs / 100) / 10,
    error: seed.error,
  };
}

// ── Telemetry Helpers ─────────────────────────────────────────────────────

/** Emit the jury_juror telemetry event. */
export function emitJurorTelemetry(
  telemetry: TelemetryEmitter,
  task: JuryTask,
  result: SeedJurorResult,
  maxTokens: number,
  jurySize: number,
  stream: boolean,
): void {
  const errMsg = result.error;
  telemetry.emit(buildInferenceEvent({
    event_type: "jury_juror",
    model: task.entry.model,
    machine: task.entry.machine,
    provider: "ollama",
    route_type: "jury",
    route_pattern: "juror",
    tokens_input: result.promptTokens ?? 0,
    tokens_output: result.completionTokens ?? 0,
    duration_ms: result.durationMs,
    status: errMsg ? "error" : "success",
    thinking_mode: false,
    sampler_preset: samplerPresetLabel(task.temperature, maxTokens),
    extra: {
      juror_index: task.index,
      jury_size: jurySize,
      ...(stream ? { stream: true } : {}),
      ...(errMsg ? { error: errMsg.slice(0, 500) } : {}),
    },
  }));
}

export function emitAggregateTelemetry(
  telemetry: TelemetryEmitter,
  mlxModel: string,
  fleet: ModelEntry[],
  args: {
    durationMs: number;
    status: "success" | "error";
    jurorsResponded: number;
    jurySize: number;
    agreement?: number;
    totalMs: number;
    maxTokens: number;
    stream: boolean;
    error?: string;
  },
): void {
  telemetry.emit(buildInferenceEvent({
    event_type: "jury_aggregate",
    model: mlxModel,
    machine: aggregatorMachine(fleet),
    provider: "mlx",
    route_type: "jury",
    route_pattern: "aggregate",
    tokens_input: 0,
    tokens_output: 0,
    duration_ms: args.durationMs,
    status: args.status,
    thinking_mode: false,
    sampler_preset: samplerPresetLabel(0.3, args.maxTokens),
    extra: {
      jurors_responded: args.jurorsResponded,
      jury_size: args.jurySize,
      ...(args.stream ? { stream: true } : {}),
      ...(args.agreement !== undefined ? { agreement: args.agreement } : {}),
      total_ms: args.totalMs,
      ...(args.error ? { error: args.error.slice(0, 500) } : {}),
    },
  }));
}

// ── SSE Helpers ───────────────────────────────────────────────────────────

export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ── Run Jury (non-streaming) ──────────────────────────────────────────────

export async function runJury(messages: ChatMessage[], options: { maxTokens?: number; sensitivity?: string }, deps: JuryDeps): Promise<JuryResult> {
  const start = Date.now();
  const maxTokens = options.maxTokens ?? 512;
  const tasks = buildJuryTasks(deps.juryModels, deps.ollamaMachines);
  const taskById = new Map(tasks.map(t => [t.jurorId, t]));
  const validContents: string[] = [];
  let aggregateDurationCapture = 0;

  try {
    const response = await runJuryPrimitive({
      messages: messages as SeedChatMessage[],
      jurors: buildJurorAssignments(tasks, deps.callOllama),
      aggregator: makeRouterAggregator(deps.mlxHost, deps.mlxModel, deps.callOpenAICompatible, maxTokens),
      maxTokens,
      sensitivity: options.sensitivity as "SENSITIVE" | "GENERAL" | "FRONTIER" | undefined,
      queue: (id, task) => deps.withMachineQueue(taskById.get(id)!.entry.machine, task),
      onJurorComplete: (result) => {
        const task = taskById.get(result.id);
        if (!task) return;
        emitJurorTelemetry(deps.telemetry, task, result, maxTokens, tasks.length, false);
        if (!result.error && result.content.length > 0) {
          validContents.push(result.content);
        }
      },
      onAggregateComplete: (info) => {
        aggregateDurationCapture = info.durationMs;
        if (info.status === "error") {
          emitAggregateTelemetry(deps.telemetry, deps.mlxModel, deps.fleet, {
            durationMs: info.durationMs,
            status: "error",
            jurorsResponded: validContents.length,
            jurySize: tasks.length,
            totalMs: Date.now() - start,
            maxTokens,
            stream: false,
            error: info.error,
          });
        }
      },
    });

    emitAggregateTelemetry(deps.telemetry, deps.mlxModel, deps.fleet, {
      durationMs: aggregateDurationCapture,
      status: "success",
      jurorsResponded: validContents.length,
      jurySize: tasks.length,
      agreement: response.agreement,
      totalMs: response.totalDurationMs,
      maxTokens,
      stream: false,
    });

    return {
      consensus: response.consensus,
      jurors: response.jurors.map(j => toRouterJuror(j, taskById.get(j.id)!)),
      agreement: response.agreement,
      totalMs: response.totalDurationMs,
    };
  } catch (err) {
    throw err;
  }
}

// ── Run Jury (streaming) ──────────────────────────────────────────────────

export async function runJuryStreaming(messages: ChatMessage[], writer: WritableStreamDefaultWriter<Uint8Array>, options: { maxTokens?: number; sensitivity?: string }, deps: JuryDeps): Promise<void> {
  const encoder = new TextEncoder();
  const write = (event: string, data: unknown) => writer.write(encoder.encode(sseEvent(event, data)));
  const start = Date.now();
  const maxTokens = options.maxTokens ?? 512;
  const tasks = buildJuryTasks(deps.juryModels, deps.ollamaMachines);
  const taskById = new Map(tasks.map(t => [t.jurorId, t]));
  const ollamaMachineNames = deps.ollamaMachines.map(m => m.name);

  await write("jury.start", {
    tasks: tasks.length,
    machines: ollamaMachineNames.length,
    aggregator: deps.mlxModel,
    timestamp: new Date().toISOString(),
  });

  const validContents: string[] = [];
  let completed = 0;
  let deliberationAnnounced = false;
  let aggregationAnnounced = false;
  let allFailedHandled = false;
  let writeChain: Promise<void> = Promise.resolve();
  const baseAggregator = makeRouterAggregator(deps.mlxHost, deps.mlxModel, deps.callOpenAICompatible, maxTokens);

  const streamingAggregator = async (ctx: { question: string; jurors: SeedJurorResult[] }) => {
    await writeChain;
    const valid = ctx.jurors.filter(j => !j.error && j.content.length > 0);
    if (!deliberationAnnounced) {
      deliberationAnnounced = true;
      await write("jury.deliberation_complete", {
        responded: valid.length,
        total: tasks.length,
        elapsed_ms: Date.now() - start,
      });
    }
    if (valid.length === 0) {
      allFailedHandled = true;
      emitAggregateTelemetry(deps.telemetry, deps.mlxModel, deps.fleet, {
        durationMs: 0,
        status: "error",
        jurorsResponded: 0,
        jurySize: tasks.length,
        totalMs: Date.now() - start,
        maxTokens,
        stream: true,
        error: "all_jurors_failed",
      });
      await write("jury.error", { error: "All jurors failed" });
      await write("done", {});
      await writer.close();
      throw new JuryAllFailedSentinel();
    }
    if (!aggregationAnnounced) {
      aggregationAnnounced = true;
      await write("aggregation.start", { aggregator: deps.mlxModel, input_count: valid.length });
    }
    return baseAggregator(ctx);
  };

  let aggregateDurationCapture = 0;

  try {
    const response = await runJuryPrimitive({
      messages: messages as SeedChatMessage[],
      jurors: buildJurorAssignments(tasks, deps.callOllama),
      aggregator: streamingAggregator,
      maxTokens,
      sensitivity: options.sensitivity as "SENSITIVE" | "GENERAL" | "FRONTIER" | undefined,
      queue: (id, task) => deps.withMachineQueue(taskById.get(id)!.entry.machine, task),
      onJurorComplete: (result) => {
        const task = taskById.get(result.id);
        if (!task) return;
        emitJurorTelemetry(deps.telemetry, task, result, maxTokens, tasks.length, true);
        if (!result.error && result.content.length > 0) {
          validContents.push(result.content);
        }
        completed++;
        const index = completed;
        const routerJuror = toRouterJuror(result, task);
        writeChain = writeChain.then(() => write("juror.done", {
          machine: routerJuror.machine,
          model: routerJuror.model,
          answer: routerJuror.content.slice(0, 300),
          tokS: routerJuror.tokS,
          wallS: routerJuror.wallS,
          error: routerJuror.error,
          index,
          total: tasks.length,
        }));
      },
      onAggregateComplete: (info) => {
        aggregateDurationCapture = info.durationMs;
        if (info.status === "error" && !allFailedHandled) {
          emitAggregateTelemetry(deps.telemetry, deps.mlxModel, deps.fleet, {
            durationMs: info.durationMs,
            status: "error",
            jurorsResponded: validContents.length,
            jurySize: tasks.length,
            totalMs: Date.now() - start,
            maxTokens,
            stream: true,
            error: info.error,
          });
        }
      },
    });

    emitAggregateTelemetry(deps.telemetry, deps.mlxModel, deps.fleet, {
      durationMs: aggregateDurationCapture,
      status: "success",
      jurorsResponded: validContents.length,
      jurySize: tasks.length,
      agreement: response.agreement,
      totalMs: response.totalDurationMs,
      maxTokens,
      stream: true,
    });

    await write("aggregation.done", {
      consensus: response.consensus,
      agreement: response.agreement,
      total_ms: response.totalDurationMs,
    });
    await write("done", {
      consensus: response.consensus,
      jurors_responded: validContents.length,
      agreement: response.agreement,
      total_ms: response.totalDurationMs,
    });
    await writer.close();
  } catch (err) {
    if (err instanceof JuryAllFailedSentinel) {
      return;
    }
    throw err;
  }
}
