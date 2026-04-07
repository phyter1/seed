/**
 * Rule-based Fleet Router v1.2 — deterministic routing + mlx-vlm runtime.
 *
 * Ported from ren-jury's battle-tested rule-router.ts. Sub-millisecond routing
 * via keyword matching. Backed by mlx-vlm on ren3, which serves gemma4 and
 * Qwen3.5 from a single process and accepts `enable_thinking` as a per-request
 * field (no server restart required to toggle thinking mode).
 *
 * Fleet manifest is built from seed.config.json (or env vars as fallback).
 *
 * Start: bun run src/router.ts
 */

import { spawnSync, spawn } from "node:child_process";
import net from "node:net";
import { MlxSupervisor } from "./mlx-supervisor";
import {
  initState,
  reloadConfig as reloadFleetConfig,
  getFleet,
  getJuryModels,
  getAllMachineNames,
  getOllamaMachines,
  getConfigSource,
  getRouterPort,
  getMlxHost,
  getMlxPythonPath,
  getMlxStarterPath,
  getMlxModel,
  ensureQueue,
  type MachineQueue,
  type ReloadSummary,
} from "./state";
import type { ModelEntry, ChatMessage, ChatResponse, RoutingResult, JurorResult, JuryResult } from "./types";
import {
  createTelemetryEmitter,
  resolveTelemetryEndpoint,
  buildInferenceEvent,
  samplerPresetLabel,
  type Provider as TelemetryProvider,
  type RouteType as TelemetryRouteType,
} from "./telemetry";
import { identityProfile, type ClassifiableMessage, type Classification } from "@seed/sensitivity";
import {
  runJury as runJuryPrimitive,
  makeDefaultAggregator,
  calculateAgreement,
  type JurorAssignment as SeedJurorAssignment,
  type JurorResult as SeedJurorResult,
  type ChatMessage as SeedChatMessage,
} from "@seed/jury";

// ── Load Config ────────────────────────────────────────────────────────────

initState();

// Immutable at runtime — these don't change on reload
const ROUTER_PORT = getRouterPort();
const MLX_HOST = getMlxHost();
const MLX_PYTHON_PATH = getMlxPythonPath();
const MLX_STARTER = getMlxStarterPath();
const MLX_MODEL = getMlxModel();

// Mutable state — synced from state module, updated on reload
let FLEET = getFleet();
let JURY_MODELS = getJuryModels();
let OLLAMA_MACHINES = getOllamaMachines();
let ALL_MACHINE_NAMES = getAllMachineNames();
let CONFIG_SOURCE = getConfigSource();

/** Sync local mutable bindings from the state module after a reload. */
function syncFromState(): void {
  FLEET = getFleet();
  JURY_MODELS = getJuryModels();
  OLLAMA_MACHINES = getOllamaMachines();
  ALL_MACHINE_NAMES = getAllMachineNames();
  CONFIG_SOURCE = getConfigSource();
}

// ── Telemetry ──────────────────────────────────────────────────────────────

const TELEMETRY_ENDPOINT = resolveTelemetryEndpoint();
const telemetry = createTelemetryEmitter(TELEMETRY_ENDPOINT);

/** Map the router's ProviderKind to the telemetry Provider label. */
function telemetryProvider(kind: ModelEntry["provider"]): TelemetryProvider {
  return kind === "openai_compatible" ? "mlx" : "ollama";
}

/** Classify the route decision from routeRequest's reason string. */
function classifyRouteType(explicit: boolean, reason: string): TelemetryRouteType {
  if (explicit) return "explicit";
  if (reason === "explicit thinking requested") return "explicit";
  return "keyword";
}

/** Extract a short, stable pattern tag from the routing reason. */
function routePatternFromReason(reason: string): string {
  if (reason.startsWith("explicit:")) return "explicit_model";
  if (reason === "explicit thinking requested") return "explicit_thinking";
  if (reason === "math/reasoning") return "math_reasoning";
  if (reason === "code task") return "code";
  if (reason === "reasoning") return "reasoning";
  if (reason === "fast/simple task") return "fast";
  if (reason.startsWith("default")) return "default";
  return reason;
}

// ── MLX Server State ────────────────────────────────────────────────────────

interface MlxState {
  /** Last requested thinking-mode (informational — actual mode is per-request). */
  thinking: boolean;
  pid: number | null;
}

const mlxState: MlxState = {
  thinking: false,
  pid: null,
};

function killMlxServers(): void {
  // Bootout launchd service if present (prevents auto-restart on macOS)
  const uid = String(process.getuid?.() ?? 501);
  spawnSync("/bin/launchctl", ["bootout", `gui/${uid}/com.ren-jury.mlx-server`], { encoding: "utf8", timeout: 5000 });
  // Kill any remaining mlx_vlm processes (also mlx_lm, for migration-era cleanup)
  spawnSync("pkill", ["-f", "mlx_vlm.server"], { encoding: "utf8", timeout: 5000 });
  spawnSync("pkill", ["-f", "mlx_lm.server"], { encoding: "utf8", timeout: 5000 });
  console.log("[mlx] killed existing server(s)");
  mlxState.pid = null;
}

/**
 * TCP connect-probe: resolves (with ms waited) once the MLX port refuses
 * connections, or rejects on timeout. Addresses issue #38 — the dying MLX
 * child can hold :8080 briefly after pkill returns, racing the replacement
 * child's bind() and producing EADDRINUSE log noise.
 */
function waitMlxPortFree(timeoutMs = 5000, intervalMs = 100): Promise<number> {
  const [hostPart, portPart] = MLX_HOST.split(":");
  const host = hostPart || "127.0.0.1";
  const port = Number.parseInt(portPart ?? "8080", 10);
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host, port });
      let settled = false;
      const cleanup = () => { settled = true; socket.removeAllListeners(); socket.destroy(); };

      socket.setTimeout(200);
      socket.once("connect", () => {
        if (settled) return;
        cleanup();
        // Port still bound. Retry or give up.
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`port ${port} still bound after ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, intervalMs);
      });
      socket.once("error", () => {
        if (settled) return;
        cleanup();
        resolve(Date.now() - start); // ECONNREFUSED — port free
      });
      socket.once("timeout", () => {
        if (settled) return;
        cleanup();
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`port ${port} probe timeout after ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, intervalMs);
      });
    };
    attempt();
  });
}

const mlxSupervisor = new MlxSupervisor({
  // The supervisor passes `thinking` for respawn consistency; mlx-vlm controls
  // thinking per-request so the flag is ignored here.
  spawn: (_thinking: boolean) => {
    const args = [
      MLX_STARTER,
      "--model", MLX_MODEL,
      "--port", MLX_HOST.split(":")[1] ?? "8080",
    ];
    console.log("[mlx] starting server");
    const proc = spawn(MLX_PYTHON_PATH, args, {
      stdio: "inherit",
      detached: true,
    });
    proc.unref();
    return proc;
  },
  log: (m) => console.log(`[mlx-sup] ${m}`),
  waitPortFree: () => waitMlxPortFree(),
});

async function waitForMlxReady(timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${MLX_HOST}/v1/models`);
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await Bun.sleep(500);
  }
  return false;
}

let mlxStartLock: Promise<void> = Promise.resolve();

/**
 * Ensure the MLX server is reachable. If it isn't, spawn it through the
 * supervisor and wait until /v1/models responds. Concurrent callers serialize
 * through a single lock so we never race on spawn.
 *
 * Thinking-mode is controlled per-request in mlx-vlm — no server restart
 * needed, so this function is a liveness check rather than a state-toggle.
 */
async function ensureMlxAlive(): Promise<void> {
  try {
    const res = await fetch(`http://${MLX_HOST}/v1/models`);
    if (res.ok) return;
  } catch { /* server down, fall through and start */ }

  const previous = mlxStartLock;
  let release!: () => void;
  mlxStartLock = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    // Re-check after acquiring the lock — prior holder may have started it.
    try {
      const res = await fetch(`http://${MLX_HOST}/v1/models`);
      if (res.ok) return;
    } catch { /* still down */ }

    console.log("[mlx] server unreachable — spawning");
    mlxSupervisor.start(false);
    const snap = mlxSupervisor.getState();
    mlxState.pid = snap.pid;

    const ready = await waitForMlxReady();
    if (!ready) {
      throw new Error("MLX server failed to become ready");
    }
    mlxSupervisor.reportHealthy();
    console.log("[mlx] ready");
  } finally {
    release();
  }
}

// Background health probe: when MLX is reachable, keep the supervisor's
// isHealthy flag and backoff counters in sync. This catches the case where
// the supervisor respawned MLX on its own (after an unexpected exit) — the
// process comes back healthy without any ensureMlxThinking() call to reset
// the counters.
const HEALTH_PROBE_INTERVAL_MS = 10000;
setInterval(async () => {
  try {
    const res = await fetch(`http://${MLX_HOST}/v1/models`);
    if (res.ok) mlxSupervisor.reportHealthy();
  } catch {
    /* MLX unreachable — exit handler will drive the respawn */
  }
}, HEALTH_PROBE_INTERVAL_MS).unref?.();

// ── Routing Rules ───────────────────────────────────────────────────────────

const THINKING_PATTERNS = /\b(prove|theorem|step.by.step|chain.of.thought|think.through|work.out|derive|solve.*equation|formal.proof|debug.*complex|analyze.*deeply)\b/i;
const CODE_PATTERNS = /\b(code|function|debug|refactor|implement|typescript|python|rust|golang|bug|error|fix|compile|test|api|endpoint|class|interface|module)\b/i;
const MATH_PATTERNS = /\b(math|calculate|equation|formula|prove|theorem|integral|derivative|probability|statistics)\b/i;
const REASONING_PATTERNS = /\b(reason|analyze|think|explain.why|compare|trade.?off|architecture|design|evaluate|critique|review)\b/i;
const FAST_PATTERNS = /\b(classify|extract|categorize|label|sentiment|tag|summarize|tldr|brief|summary|hello|hi|hey|quick|fast|simple)\b/i;

function routeRequest(content: string, options: { model?: string; thinking?: boolean } = {}): RoutingResult {
  // 1. Explicit model request — honor it
  if (options.model && options.model !== "auto") {
    const entry = FLEET.find(m => m.model === options.model || m.model.includes(options.model!));
    if (entry) {
      const needsThinking = options.thinking ?? entry.thinking ?? false;
      return { entry, reason: `explicit: ${entry.model}`, needsThinking };
    }
  }

  // 2. Explicit thinking override
  if (options.thinking !== undefined) {
    const needsThinking = options.thinking;
    if (needsThinking) {
      const entry = FLEET.find(m => m.thinking === true) ?? FLEET.find(m => m.tags.includes("deep-reasoning"))!;
      if (entry) {
        return { entry, reason: "explicit thinking requested", needsThinking: true };
      }
    }
  }

  // 3. Keyword matching — route to the best-fit provider
  const mlxEntry = FLEET.find(m => m.provider === "openai_compatible");
  const codeEntry = FLEET.find(m => m.tags.includes("code")) ?? mlxEntry;
  const fallback = mlxEntry ?? FLEET[0];

  if (MATH_PATTERNS.test(content) || THINKING_PATTERNS.test(content)) {
    return { entry: fallback, reason: "math/reasoning", needsThinking: false };
  }

  if (CODE_PATTERNS.test(content)) {
    return { entry: codeEntry ?? fallback, reason: "code task", needsThinking: false };
  }

  if (REASONING_PATTERNS.test(content)) {
    return { entry: fallback, reason: "reasoning", needsThinking: false };
  }

  if (FAST_PATTERNS.test(content)) {
    return { entry: fallback, reason: "fast/simple task", needsThinking: false };
  }

  // 4. Default — fast general-purpose
  return { entry: fallback, reason: "default (general, fast)", needsThinking: false };
}

// ── Sensitivity Classification ────────────────────────────────────────────

function classifyMessages(messages: ChatMessage[]): Classification {
  const classifiable: ClassifiableMessage[] = messages.map(m => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : "",
  }));
  return identityProfile.classifyMessages(classifiable);
}

// ── Backend Clients ─────────────────────────────────────────────────────────

async function callOpenAICompatible(host: string, model: string, messages: ChatMessage[], options: { temperature?: number; maxTokens?: number; enableThinking?: boolean } = {}): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2048,
  };
  if (options.enableThinking !== undefined) body.enable_thinking = options.enableThinking;
  const res = await fetch(`http://${host}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI-compatible ${host} error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return {
    content: msg.content ?? "",
    reasoning: msg.reasoning,
    model: data.model ?? model,
    usage: data.usage,
  };
}

async function callOllama(host: string, model: string, messages: ChatMessage[], options: { temperature?: number; maxTokens?: number } = {}): Promise<ChatResponse> {
  const res = await fetch(`http://${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, options: { temperature: options.temperature ?? 0.7, num_predict: options.maxTokens ?? 2048 } }),
  });
  if (!res.ok) throw new Error(`Ollama ${host} error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    content: data.message?.content ?? "",
    model: data.model ?? model,
    usage: { input_tokens: data.prompt_eval_count ?? 0, output_tokens: data.eval_count ?? 0, total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0) },
  };
}

// ── Streaming ──────────────────────────────────────────────────────────────

async function streamOpenAICompatible(
  host: string, model: string, messages: ChatMessage[],
  writer: WritableStreamDefaultWriter<Uint8Array>,
  options: { temperature?: number; maxTokens?: number; enableThinking?: boolean } = {},
): Promise<void> {
  const encoder = new TextEncoder();
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2048,
    stream: true,
  };
  if (options.enableThinking !== undefined) body.enable_thinking = options.enableThinking;
  const res = await fetch(`http://${host}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI-compatible ${host} error: ${res.status} ${await res.text()}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    while (buf.includes("\n\n")) {
      const idx = buf.indexOf("\n\n");
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") {
          await writer.write(encoder.encode("data: [DONE]\n\n"));
          continue;
        }
        await writer.write(encoder.encode(`data: ${payload}\n\n`));
      }
    }
  }
  await writer.close();
}

async function streamOllama(
  host: string, model: string, messages: ChatMessage[],
  writer: WritableStreamDefaultWriter<Uint8Array>,
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<void> {
  const encoder = new TextEncoder();
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  const res = await fetch(`http://${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, options: { temperature: options.temperature ?? 0.7, num_predict: options.maxTokens ?? 2048 } }),
  });
  if (!res.ok) throw new Error(`Ollama ${host} error: ${res.status} ${await res.text()}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    while (buf.includes("\n")) {
      const idx = buf.indexOf("\n");
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;

      try {
        const chunk = JSON.parse(line);
        const delta: string = chunk.message?.content ?? "";
        const isDone = chunk.done === true;
        if (!isDone && delta === "") continue;

        const sseChunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: isDone ? {} : { content: delta },
            finish_reason: isDone ? "stop" : null,
          }],
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(sseChunk)}\n\n`));

        if (isDone) {
          await writer.write(encoder.encode("data: [DONE]\n\n"));
        }
      } catch { /* skip malformed lines */ }
    }
  }
  await writer.close();
}

// ── Machine Queues (one inference at a time per machine) ────────────────────
// Queue storage and ensureQueue are imported from ./state.
// Routing helpers remain here since they're tightly coupled to dispatch logic.

function withMachineQueue<T>(machine: string, fn: () => Promise<T>): Promise<T> {
  const q = ensureQueue(machine);
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  const previous = q.promise;
  q.promise = next;
  q.depth++;
  return previous.then(fn).finally(() => { q.depth--; release(); });
}

function pickIdlestMachine(candidates: string[]): string {
  let best = candidates[0];
  let bestDepth = ensureQueue(best).depth;
  for (const m of candidates) {
    const depth = ensureQueue(m).depth;
    if (depth < bestDepth) {
      best = m;
      bestDepth = depth;
    }
  }
  ensureQueue(best).depth++;
  return best;
}

function withPrePickedQueue<T>(machine: string, fn: () => Promise<T>): Promise<T> {
  const q = ensureQueue(machine);
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  const previous = q.promise;
  q.promise = next;
  return previous.then(fn).finally(() => { q.depth--; release(); });
}

// ── Jury Mode ──────────────────────────────────────────────────────────────
//
// Fan-out/aggregate mechanics live in @seed/jury. This file wires the
// fleet's machine-queue, telemetry events, and SSE stream shape to that
// primitive. The aggregator prompt is kept byte-identical to the prior
// inline version so production synthesis behaviour does not drift.

// JURY_MODELS is a mutable let binding synced from state on reload (see syncFromState).
const JURY_TEMPERATURES = [0.3, 0.5, 0.7, 0.9];

interface JuryTask {
  entry: ModelEntry;
  temperature: number;
  jurorId: string;
  index: number;
}

function buildJuryTasks(): JuryTask[] {
  const ollamaMachineNames = OLLAMA_MACHINES.map(m => m.name);
  const uniqueModels = [...new Set(JURY_MODELS.map(m => m.model))];
  const tasks: JuryTask[] = [];
  let tempIdx = 0;
  for (const machineName of ollamaMachineNames) {
    for (const model of uniqueModels) {
      const entry = JURY_MODELS.find(m => m.machine === machineName && m.model === model);
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

function buildJurorAssignments(tasks: JuryTask[]): SeedJurorAssignment[] {
  return tasks.map(({ entry, temperature, jurorId }) => ({
    id: jurorId,
    temperature,
    invoke: async (msgs, opts) => {
      const res = await callOllama(entry.host, entry.model, msgs as ChatMessage[], {
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

function aggregatorMachine(): string {
  return (FLEET.find(m => m.provider === "openai_compatible")?.machine) ?? "mlx";
}

/**
 * MLX-backed aggregator using the router's original synthesis prompt.
 * Matches the prior inline implementation byte-for-byte so deployed
 * behaviour is preserved. Callers that want the quality-review-aware
 * prompt can switch to @seed/jury's makeDefaultAggregator.
 */
function makeRouterAggregator(maxTokens: number) {
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

    const aggregated = await callOpenAICompatible(
      MLX_HOST,
      MLX_MODEL,
      [{ role: "user", content: aggregationPrompt }],
      { temperature: 0.3, maxTokens, enableThinking: false },
    );
    return aggregated.content;
  };
}

/** Map a @seed/jury juror result back to the router's public JurorResult shape. */
function toRouterJuror(seed: SeedJurorResult, task: JuryTask): JurorResult {
  return {
    machine: task.entry.machine,
    model: task.entry.model,
    content: seed.content,
    tokS: seed.tokensPerSecond,
    wallS: Math.round(seed.durationMs / 100) / 10,
    error: seed.error,
  };
}

/** Emit the jury_juror telemetry event. */
function emitJurorTelemetry(
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

function emitAggregateTelemetry(
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
    model: MLX_MODEL,
    machine: aggregatorMachine(),
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

async function runJury(messages: ChatMessage[], options: { maxTokens?: number; sensitivity?: string } = {}): Promise<JuryResult> {
  const start = Date.now();
  const maxTokens = options.maxTokens ?? 512;
  const tasks = buildJuryTasks();
  const taskById = new Map(tasks.map(t => [t.jurorId, t]));
  const validContents: string[] = [];
  let aggregateDurationCapture = 0;

  try {
    const response = await runJuryPrimitive({
      messages: messages as SeedChatMessage[],
      jurors: buildJurorAssignments(tasks),
      aggregator: makeRouterAggregator(maxTokens),
      maxTokens,
      sensitivity: options.sensitivity as "SENSITIVE" | "GENERAL" | "FRONTIER" | undefined,
      queue: (id, task) => withMachineQueue(taskById.get(id)!.entry.machine, task),
      onJurorComplete: (result) => {
        const task = taskById.get(result.id);
        if (!task) return;
        emitJurorTelemetry(task, result, maxTokens, tasks.length, false);
        if (!result.error && result.content.length > 0) {
          validContents.push(result.content);
        }
      },
      onAggregateComplete: (info) => {
        aggregateDurationCapture = info.durationMs;
        if (info.status === "error") {
          emitAggregateTelemetry({
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

    emitAggregateTelemetry({
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

// ── Streaming Jury ──────────────────────────────────────────────────────────

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function runJuryStreaming(messages: ChatMessage[], writer: WritableStreamDefaultWriter<Uint8Array>, options: { maxTokens?: number; sensitivity?: string } = {}): Promise<void> {
  const encoder = new TextEncoder();
  const write = (event: string, data: unknown) => writer.write(encoder.encode(sseEvent(event, data)));
  const start = Date.now();
  const maxTokens = options.maxTokens ?? 512;
  const tasks = buildJuryTasks();
  const taskById = new Map(tasks.map(t => [t.jurorId, t]));
  const ollamaMachineNames = OLLAMA_MACHINES.map(m => m.name);

  await write("jury.start", {
    tasks: tasks.length,
    machines: ollamaMachineNames.length,
    aggregator: MLX_MODEL,
    timestamp: new Date().toISOString(),
  });

  const validContents: string[] = [];
  let completed = 0;
  let deliberationAnnounced = false;
  let aggregationAnnounced = false;
  let allFailedHandled = false;
  // onJurorComplete is invoked synchronously by the jury primitive (not
  // awaited), so we serialize juror.done writes through a promise chain
  // and drain it before the streamingAggregator emits the next event.
  let writeChain: Promise<void> = Promise.resolve();
  const baseAggregator = makeRouterAggregator(maxTokens);

  // Wrap the aggregator to emit deliberation_complete + aggregation.start
  // at the exact moment jurors are done and aggregation begins. The
  // primitive calls the aggregator immediately after all jurors return,
  // so this is the correct insertion point.
  const streamingAggregator = async (ctx: { question: string; jurors: SeedJurorResult[] }) => {
    // Drain any in-flight juror.done writes before emitting deliberation_complete.
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
      // Mirror original behaviour: emit specific telemetry + jury.error
      // + done, close writer, and short-circuit with a sentinel throw
      // so runJuryPrimitive stops before calling the MLX aggregator.
      allFailedHandled = true;
      emitAggregateTelemetry({
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
      await write("aggregation.start", { aggregator: MLX_MODEL, input_count: valid.length });
    }
    return baseAggregator(ctx);
  };

  let aggregateDurationCapture = 0;

  try {
    const response = await runJuryPrimitive({
      messages: messages as SeedChatMessage[],
      jurors: buildJurorAssignments(tasks),
      aggregator: streamingAggregator,
      maxTokens,
      sensitivity: options.sensitivity as "SENSITIVE" | "GENERAL" | "FRONTIER" | undefined,
      queue: (id, task) => withMachineQueue(taskById.get(id)!.entry.machine, task),
      onJurorComplete: (result) => {
        const task = taskById.get(result.id);
        if (!task) return;
        emitJurorTelemetry(task, result, maxTokens, tasks.length, true);
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
          emitAggregateTelemetry({
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

    emitAggregateTelemetry({
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
      // All-jurors-failed path already wrote jury.error + done + closed.
      return;
    }
    throw err;
  }
}

class JuryAllFailedSentinel extends Error {
  constructor() {
    super("jury:all_jurors_failed");
    this.name = "JuryAllFailedSentinel";
  }
}

// ── Sampler Presets ─────────────────────────────────────────────────────────

function getSamplerSettings(thinking: boolean, taskType: string): { temperature: number; maxTokens: number } {
  if (thinking) {
    return { temperature: 0.6, maxTokens: 8192 };
  }
  if (taskType.includes("code")) {
    return { temperature: 0.3, maxTokens: 4096 };
  }
  if (taskType.includes("classification") || taskType.includes("fast")) {
    return { temperature: 0.3, maxTokens: 256 };
  }
  return { temperature: 0.7, maxTokens: 2048 };
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: ROUTER_PORT,
  idleTimeout: 120,

  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        router: "rule-based-v1.2",
        runtime: "mlx-vlm",
        fleet: FLEET.length,
        mlx: {
          model: MLX_MODEL,
          thinking: mlxState.thinking,
          supervisor: mlxSupervisor.getState(),
        },
        config_source: CONFIG_SOURCE,
      });
    }

    // Config reload — hot-swap fleet topology without restarting the router
    if (url.pathname === "/v1/config/reload" && req.method === "POST") {
      try {
        const summary = reloadFleetConfig();
        syncFromState();
        console.log(`[config-reload] fleet reloaded: ${summary.fleet_size} models, ${summary.changes.added_models.length} added, ${summary.changes.removed_models.length} removed`);
        return Response.json(summary);
      } catch (err) {
        console.error(`[config-reload] failed: ${err}`);
        return Response.json({ reloaded: false, error: String(err) }, { status: 500 });
      }
    }

    // Current config — read-only view of the fleet topology
    if (url.pathname === "/v1/config" && req.method === "GET") {
      return Response.json({
        source: CONFIG_SOURCE,
        fleet_size: FLEET.length,
        fleet: FLEET.map(m => ({
          machine: m.machine,
          model: m.model,
          provider: m.provider,
          locality: m.locality ?? "local",
          tags: m.tags,
        })),
        jury_models: JURY_MODELS.length,
        machines: ALL_MACHINE_NAMES,
      });
    }

    // MLX state
    if (url.pathname === "/mlx/state" && req.method === "GET") {
      return Response.json(mlxState);
    }

    // Thinking-mode tracker (observability only — thinking is per-request
    // under mlx-vlm, so this endpoint no longer restarts MLX).
    if (url.pathname === "/mlx/thinking" && req.method === "POST") {
      const body = await req.json();
      mlxState.thinking = Boolean(body.thinking);
      return Response.json({ ok: true, thinking: mlxState.thinking });
    }

    // List fleet
    if (url.pathname === "/v1/models" && req.method === "GET") {
      return Response.json({
        object: "list",
        data: FLEET.map(m => ({
          id: `${m.machine}/${m.model}`,
          object: "model",
          owned_by: m.machine,
          tags: m.tags,
          thinking: m.thinking,
        })),
      });
    }

    // Jury endpoint
    if (url.pathname === "/v1/jury" && req.method === "POST") {
      const body = await req.json();
      const messages: ChatMessage[] = body.messages ?? [];
      const maxTokens = body.max_tokens ?? 512;
      const stream = body.stream ?? false;

      if (messages.length === 0) {
        return Response.json({ error: "messages required" }, { status: 400 });
      }

      const jurySensitivity = classifyMessages(messages);
      const lastMessage = messages[messages.length - 1].content;
      console.log(`[jury] "${lastMessage.slice(0, 60)}..." -> ${JURY_MODELS.length} jurors + aggregator (stream=${stream}, sensitivity=${jurySensitivity.level})`);

      // Sensitivity guard: block jury dispatch if content is sensitive and no local jurors exist
      if (jurySensitivity.local_only) {
        const localJurors = JURY_MODELS.filter(m => m.locality !== "cloud");
        if (localJurors.length === 0) {
          return Response.json({
            error: {
              message: "Content classified as SENSITIVE but no local model available. Add a local model to the fleet to handle sensitive requests.",
              type: "sensitivity_block",
              code: "no_local_model",
            },
          }, { status: 451 });
        }
      }

      if (stream) {
        const { readable, writable } = new TransformStream<Uint8Array>();
        const writer = writable.getWriter();

        runJuryStreaming(messages, writer, { maxTokens, sensitivity: jurySensitivity.level }).catch(async (err) => {
          const encoder = new TextEncoder();
          await writer.write(encoder.encode(sseEvent("error", { error: String(err) })));
          await writer.close();
        });

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }

      try {
        const result = await runJury(messages, { maxTokens, sensitivity: jurySensitivity.level });
        console.log(`[jury] done [${result.totalMs}ms, agreement=${result.agreement}]`);

        return Response.json({
          id: `jury-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "jury",
          choices: [{
            index: 0,
            message: { role: "assistant", content: result.consensus },
            finish_reason: "stop",
          }],
          _jury: {
            jurors: result.jurors,
            agreement: result.agreement,
            aggregator: MLX_MODEL,
            total_ms: result.totalMs,
          },
        });
      } catch (err) {
        console.log(`[jury] failed: ${err}`);
        return Response.json({ error: String(err) }, { status: 502 });
      }
    }

    // Main chat completions endpoint
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      const body = await req.json();
      const messages: ChatMessage[] = body.messages ?? [];
      const requestedModel = body.model;
      const requestedThinking: boolean | undefined = body.thinking;

      // Classify sensitivity before any dispatch
      const sensitivity = messages.length > 0 ? classifyMessages(messages) : { level: "GENERAL" as const, local_only: false, reason: "empty", flags: [] };

      // Redirect to jury if mode=jury
      if (body.mode === "jury") {
        const lastMessage = messages[messages.length - 1]?.content ?? "";
        console.log(`[jury] "${lastMessage.slice(0, 60)}..." (via mode=jury, sensitivity=${sensitivity.level})`);

        // Sensitivity guard: block jury dispatch if content is sensitive and no local jurors exist
        if (sensitivity.local_only) {
          const localJurors = JURY_MODELS.filter(m => m.locality !== "cloud");
          if (localJurors.length === 0) {
            return Response.json({
              error: {
                message: "Content classified as SENSITIVE but no local model available. Add a local model to the fleet to handle sensitive requests.",
                type: "sensitivity_block",
                code: "no_local_model",
              },
            }, { status: 451 });
          }
        }

        try {
          const result = await runJury(messages, { maxTokens: body.max_tokens ?? 256, sensitivity: sensitivity.level });
          console.log(`[jury] done [${result.totalMs}ms, agreement=${result.agreement}]`);
          return Response.json({
            id: `jury-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "jury",
            choices: [{ index: 0, message: { role: "assistant", content: result.consensus }, finish_reason: "stop" }],
            _jury: { jurors: result.jurors, agreement: result.agreement, aggregator: MLX_MODEL, total_ms: result.totalMs },
          });
        } catch (err) {
          return Response.json({ error: String(err) }, { status: 502 });
        }
      }

      if (messages.length === 0) {
        return Response.json({ error: "messages required" }, { status: 400 });
      }

      const stream = body.stream !== false;
      const start = Date.now();
      const lastMessage = messages[messages.length - 1].content;
      let { entry, reason, needsThinking } = routeRequest(lastMessage, { model: requestedModel, thinking: requestedThinking });

      // Sensitivity guard: reroute cloud entries to local when content is sensitive
      if (sensitivity.local_only && entry.locality === "cloud") {
        const localEntry = FLEET.find(m => m.locality !== "cloud");
        if (localEntry) {
          entry = localEntry;
          reason = `sensitivity:${sensitivity.level} (rerouted from cloud)`;
        } else {
          return Response.json({
            error: {
              message: "Content classified as SENSITIVE but no local model available. Add a local model to the fleet to handle sensitive requests.",
              type: "sensitivity_block",
              code: "no_local_model",
            },
          }, { status: 451 });
        }
      }

      console.log(`[router] sensitivity=${sensitivity.level}${sensitivity.flags.length > 0 ? ` [${sensitivity.flags.join(",")}]` : ""}`);

      const samplerOverrides = getSamplerSettings(needsThinking, reason);
      const temperature = body.temperature ?? samplerOverrides.temperature;
      const maxTokens = body.max_tokens ?? samplerOverrides.maxTokens;
      const samplerPreset = samplerPresetLabel(temperature, maxTokens);
      const isExplicitModel = Boolean(requestedModel && requestedModel !== "auto");
      const routeType = classifyRouteType(isExplicitModel, reason);
      const routePattern = routePatternFromReason(reason);

      if (stream) {
        const { readable, writable } = new TransformStream<Uint8Array>();
        const writer = writable.getWriter();

        (async () => {
          let streamMachine: string = entry.machine;
          let streamStatus: "success" | "error" = "success";
          let streamErr: unknown = null;
          try {
            if (entry.provider === "openai_compatible") {
              const mlxMachine = entry.machine;
              streamMachine = mlxMachine;
              await withMachineQueue(mlxMachine, async () => {
                await ensureMlxAlive();
                console.log(`[router] "${lastMessage.slice(0, 60)}..." -> ${mlxMachine}/${entry.model} (${reason}, stream, thinking=${needsThinking})`);
                return streamOpenAICompatible(entry.host, entry.model, messages, writer, { temperature, maxTokens, enableThinking: needsThinking });
              });
            } else {
              const candidates = FLEET.filter(m => m.model === entry.model && m.provider === "ollama");
              const machineNames = [...new Set(candidates.map(c => c.machine))];
              const target = pickIdlestMachine(machineNames);
              streamMachine = target;
              const targetEntry = candidates.find(c => c.machine === target)!;
              console.log(`[router] "${lastMessage.slice(0, 60)}..." -> ${target}/${entry.model} (${reason}, stream, q=${ensureQueue(target).depth})`);
              await withPrePickedQueue(target, () =>
                streamOllama(targetEntry.host, targetEntry.model, messages, writer, { temperature, maxTokens })
              );
            }
          } catch (err) {
            streamStatus = "error";
            streamErr = err;
            console.log(`[router] stream error: ${err}`);
            const encoder = new TextEncoder();
            try {
              await writer.write(encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`));
              await writer.close();
            } catch { /* writer may already be closed */ }
          }
          telemetry.emit(buildInferenceEvent({
            model: entry.model,
            machine: streamMachine,
            provider: telemetryProvider(entry.provider),
            route_type: routeType,
            route_pattern: routePattern,
            tokens_input: 0,
            tokens_output: 0,
            duration_ms: Date.now() - start,
            status: streamStatus,
            thinking_mode: needsThinking,
            sampler_preset: samplerPreset,
            extra: {
              stream: true,
              ...(streamErr ? { error: String(streamErr).slice(0, 500) } : {}),
            },
          }));
          console.log(`[router] stream done [${Date.now() - start}ms]`);
        })();

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }

      // Non-streaming
      let response: ChatResponse;
      let dispatchedMachine: string = entry.machine;
      try {
        if (entry.provider === "openai_compatible") {
          const mlxMachine = entry.machine;
          dispatchedMachine = mlxMachine;
          response = await withMachineQueue(mlxMachine, async () => {
            await ensureMlxAlive();
            return callOpenAICompatible(entry.host, entry.model, messages, { temperature, maxTokens, enableThinking: needsThinking });
          });
          console.log(`[router] "${lastMessage.slice(0, 60)}..." -> ${mlxMachine}/${entry.model} (${reason}) [${Date.now() - start}ms]`);
        } else {
          const candidates = FLEET.filter(m => m.model === entry.model && m.provider === "ollama");
          const machineNames = [...new Set(candidates.map(c => c.machine))];
          const target = pickIdlestMachine(machineNames);
          dispatchedMachine = target;
          const targetEntry = candidates.find(c => c.machine === target)!;
          console.log(`[router] "${lastMessage.slice(0, 60)}..." -> ${target}/${entry.model} (${reason}, q=${ensureQueue(target).depth})`);
          response = await withPrePickedQueue(target, () =>
            callOllama(targetEntry.host, targetEntry.model, messages, { temperature, maxTokens })
          );
        }
      } catch (err) {
        console.log(`[router] target failed: ${err}`);
        telemetry.emit(buildInferenceEvent({
          model: entry.model,
          machine: dispatchedMachine,
          provider: telemetryProvider(entry.provider),
          route_type: routeType,
          route_pattern: routePattern,
          tokens_input: 0,
          tokens_output: 0,
          duration_ms: Date.now() - start,
          status: "error",
          thinking_mode: needsThinking,
          sampler_preset: samplerPreset,
          extra: { error: String(err).slice(0, 500) },
        }));
        return Response.json({ error: String(err) }, { status: 502 });
      }

      telemetry.emit(buildInferenceEvent({
        model: entry.model,
        machine: dispatchedMachine,
        provider: telemetryProvider(entry.provider),
        route_type: routeType,
        route_pattern: routePattern,
        tokens_input: response.usage?.input_tokens ?? 0,
        tokens_output: response.usage?.output_tokens ?? 0,
        duration_ms: Date.now() - start,
        status: "success",
        thinking_mode: needsThinking,
        sampler_preset: samplerPreset,
      }));

      return Response.json({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: entry.model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: response.content },
          finish_reason: "stop",
        }],
        usage: response.usage,
        _routing: { decision: reason, machine: dispatchedMachine, model: entry.model, total_ms: Date.now() - start },
      });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

// ── Startup ─────────────────────────────────────────────────────────────────

const ollamaMachineList = OLLAMA_MACHINES.map(m => m.name).join(", ") || "none";

console.log(`
+==================================================+
|     Fleet Router v1.2 (rule-based + mlx-vlm)      |
|     http://localhost:${String(ROUTER_PORT).padEnd(27)}|
+--------------------------------------------------+
|  Routing:  keyword rules (0ms, no GPU)            |
|  Runtime:  mlx-vlm                                 |
|  MLX:      ${MLX_MODEL.slice(0, 37).padEnd(37)} |
|  Thinking: per-request (enable_thinking flag)      |
|  Fleet:    ${String(FLEET.length).padEnd(2)} models across ${String(ALL_MACHINE_NAMES.length).padEnd(2)} machines         |
|  Ollama:   ${ollamaMachineList.slice(0, 37).padEnd(37)} |
|  Config:   ${CONFIG_SOURCE.padEnd(37)} |
+==================================================+
`);

// Verify MLX is reachable on startup. Under mlx-vlm, thinking-mode is set
// per-request so there's no server-wide state to probe for.
(async () => {
  const ready = await waitForMlxReady(5000);
  if (ready) {
    console.log("[router] ready.");
  } else {
    console.log("[mlx] server not reachable — will start on first request");
  }
})();
