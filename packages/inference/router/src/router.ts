/**
 * Rule-based Fleet Router v1.0 — deterministic routing + MLX thinking lifecycle.
 *
 * Ported from ren-jury's battle-tested rule-router.ts. Sub-millisecond routing
 * via keyword matching. Manages the MLX server's thinking mode: restarts it with
 * enable_thinking true/false as needed.
 *
 * Fleet manifest is built from seed.config.json (or env vars as fallback).
 *
 * Start: bun run src/router.ts
 */

import { spawnSync, spawn } from "node:child_process";
import { loadRouterConfig, type LoadedRouterConfig } from "./config";
import type { ModelEntry, ChatMessage, ChatResponse, RoutingResult, JurorResult, JuryResult } from "./types";
import {
  createTelemetryEmitter,
  resolveTelemetryEndpoint,
  buildInferenceEvent,
  samplerPresetLabel,
  type Provider as TelemetryProvider,
  type RouteType as TelemetryRouteType,
} from "./telemetry";

// ── Load Config ────────────────────────────────────────────────────────────

const CONFIG: LoadedRouterConfig = loadRouterConfig();

const {
  routerPort: ROUTER_PORT,
  fleet: FLEET,
  mlxHost: MLX_HOST,
  mlxPythonPath: MLX_PYTHON_PATH,
  mlxStarterPath: MLX_STARTER,
  mlxModel: MLX_MODEL,
  ollamaMachines: OLLAMA_MACHINES,
  allMachineNames: ALL_MACHINE_NAMES,
  source: CONFIG_SOURCE,
} = CONFIG;

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
  thinking: boolean;
  pid: number | null;
  restarting: boolean;
}

const mlxState: MlxState = {
  thinking: false,
  pid: null,
  restarting: false,
};

let mlxRestartLock: Promise<void> = Promise.resolve();

async function withMlxLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = mlxRestartLock;
  let release!: () => void;
  mlxRestartLock = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function killMlxServers(): void {
  // Bootout launchd service if present (prevents auto-restart on macOS)
  const uid = String(process.getuid?.() ?? 501);
  spawnSync("/bin/launchctl", ["bootout", `gui/${uid}/com.ren-jury.mlx-server`], { encoding: "utf8", timeout: 5000 });
  // Kill any remaining mlx_lm processes
  spawnSync("pkill", ["-f", "mlx_lm.server"], { encoding: "utf8", timeout: 5000 });
  spawnSync("pkill", ["-f", "mlx_lm server"], { encoding: "utf8", timeout: 5000 });
  console.log("[mlx] killed existing server(s)");
  mlxState.pid = null;
}

async function startMlxServer(thinking: boolean): Promise<void> {
  const args = [
    MLX_STARTER,
    "--model", MLX_MODEL,
    "--port", MLX_HOST.split(":")[1] ?? "8080",
    thinking ? "--thinking" : "--no-thinking",
  ];

  console.log(`[mlx] starting server: thinking=${thinking}`);
  const proc = spawn(MLX_PYTHON_PATH, args, {
    stdio: "inherit",
    detached: true,
  });
  proc.unref();
  mlxState.pid = proc.pid ?? null;
  mlxState.thinking = thinking;
}

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

async function ensureMlxThinking(thinking: boolean): Promise<void> {
  if (mlxState.thinking === thinking && !mlxState.restarting) {
    try {
      const res = await fetch(`http://${MLX_HOST}/v1/models`);
      if (res.ok) return;
    } catch { /* server dead, restart */ }
  }

  return withMlxLock(async () => {
    if (mlxState.thinking === thinking && !mlxState.restarting) {
      try {
        const res = await fetch(`http://${MLX_HOST}/v1/models`);
        if (res.ok) return;
      } catch { /* proceed with restart */ }
    }

    mlxState.restarting = true;
    console.log(`[mlx] cycling: thinking=${mlxState.thinking} -> thinking=${thinking}`);

    killMlxServers();
    for (let i = 0; i < 10; i++) {
      await Bun.sleep(1000);
      try {
        const res = await fetch(`http://${MLX_HOST}/v1/models`);
        if (!res.ok) break;
      } catch {
        break;
      }
    }

    await startMlxServer(thinking);
    const ready = await waitForMlxReady();
    mlxState.restarting = false;

    if (!ready) {
      throw new Error(`MLX server failed to start in thinking=${thinking} mode`);
    }
    console.log(`[mlx] ready: thinking=${thinking}`);
  });
}

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

// ── Backend Clients ─────────────────────────────────────────────────────────

async function callOpenAICompatible(host: string, model: string, messages: ChatMessage[], options: { temperature?: number; maxTokens?: number } = {}): Promise<ChatResponse> {
  const res = await fetch(`http://${host}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: options.temperature ?? 0.7, max_tokens: options.maxTokens ?? 2048 }),
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
    usage: { prompt_tokens: data.prompt_eval_count ?? 0, completion_tokens: data.eval_count ?? 0, total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0) },
  };
}

// ── Streaming ──────────────────────────────────────────────────────────────

async function streamOpenAICompatible(
  host: string, model: string, messages: ChatMessage[],
  writer: WritableStreamDefaultWriter<Uint8Array>,
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<void> {
  const encoder = new TextEncoder();
  const res = await fetch(`http://${host}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: options.temperature ?? 0.7, max_tokens: options.maxTokens ?? 2048, stream: true }),
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

interface MachineQueue {
  promise: Promise<void>;
  depth: number;
}

const machineQueues: Record<string, MachineQueue> = {};

// Initialize queues for all known machines
for (const name of ALL_MACHINE_NAMES) {
  machineQueues[name] = { promise: Promise.resolve(), depth: 0 };
}

function ensureQueue(machine: string): MachineQueue {
  if (!machineQueues[machine]) {
    machineQueues[machine] = { promise: Promise.resolve(), depth: 0 };
  }
  return machineQueues[machine];
}

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

const JURY_MODELS = FLEET.filter(m => m.provider === "ollama");
const JURY_TEMPERATURES = [0.3, 0.5, 0.7, 0.9];

function calculateAgreement(responses: string[]): number {
  if (responses.length <= 1) return 1;
  const wordSets = responses.map(r => new Set(r.toLowerCase().split(/\s+/).filter(w => w.length > 3)));
  let totalOverlap = 0;
  let pairs = 0;
  for (let i = 0; i < wordSets.length; i++) {
    for (let j = i + 1; j < wordSets.length; j++) {
      const intersection = new Set([...wordSets[i]].filter(w => wordSets[j].has(w)));
      const union = new Set([...wordSets[i], ...wordSets[j]]);
      totalOverlap += union.size > 0 ? intersection.size / union.size : 0;
      pairs++;
    }
  }
  return pairs > 0 ? Math.round((totalOverlap / pairs) * 100) / 100 : 1;
}

async function aggregateJury(question: string, jurorResults: JurorResult[], maxTokens: number): Promise<string> {
  const valid = jurorResults.filter(r => !r.error && r.content.length > 0);
  if (valid.length === 0) throw new Error("All jurors failed");
  if (valid.length === 1) return valid[0].content;

  const responsesText = valid
    .map((r, i) => `[Juror ${i + 1} (${r.model}@${r.machine})]:\n${r.content}`)
    .join("\n\n");

  const aggregationPrompt = `You are synthesizing ${valid.length} model responses into one best answer. Be concise and direct.

Question: ${question}

Responses:
${responsesText}

Synthesize into a single best response. Take the strongest elements from each. Do not mention the jurors or the synthesis process.`;

  const aggregated = await callOpenAICompatible(MLX_HOST, MLX_MODEL, [{ role: "user", content: aggregationPrompt }], { temperature: 0.3, maxTokens });
  return aggregated.content;
}

async function runJury(messages: ChatMessage[], options: { maxTokens?: number } = {}): Promise<JuryResult> {
  const start = Date.now();
  const maxTokens = options.maxTokens ?? 512;
  const lastUserMsg = messages[messages.length - 1].content;

  // Build distributed tasks: each model on each machine
  const ollamaMachineNames = OLLAMA_MACHINES.map(m => m.name);
  const uniqueModels = [...new Set(JURY_MODELS.map(m => m.model))];
  const tasks: { entry: ModelEntry; temperature: number }[] = [];
  let tempIdx = 0;
  for (const machineName of ollamaMachineNames) {
    for (const model of uniqueModels) {
      const entry = JURY_MODELS.find(m => m.machine === machineName && m.model === model);
      if (entry) {
        tasks.push({ entry, temperature: JURY_TEMPERATURES[tempIdx % JURY_TEMPERATURES.length] });
        tempIdx++;
      }
    }
  }

  const results = await Promise.all(
    tasks.map(({ entry, temperature }) =>
      withMachineQueue(entry.machine, async () => {
        const taskStart = Date.now();
        try {
          const res = await callOllama(entry.host, entry.model, messages, { temperature, maxTokens });
          const wallS = (Date.now() - taskStart) / 1000;
          const tokS = res.usage && res.usage.completion_tokens > 0 && wallS > 0
            ? Math.round(res.usage.completion_tokens / wallS * 10) / 10 : 0;
          return { machine: entry.machine, model: entry.model, content: res.content, tokS, wallS: Math.round(wallS * 10) / 10, error: null };
        } catch (err) {
          return { machine: entry.machine, model: entry.model, content: "", tokS: 0, wallS: Math.round((Date.now() - taskStart) / 100) / 10, error: String(err) };
        }
      })
    )
  );

  const valid = results.filter(r => !r.error && r.content.length > 0);
  const consensus = await aggregateJury(lastUserMsg, results, maxTokens);
  const agreement = calculateAgreement(valid.map(r => r.content));

  return { consensus, jurors: results, agreement, totalMs: Date.now() - start };
}

// ── Streaming Jury ──────────────────────────────────────────────────────────

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function runJuryStreaming(messages: ChatMessage[], writer: WritableStreamDefaultWriter<Uint8Array>, options: { maxTokens?: number } = {}): Promise<void> {
  const encoder = new TextEncoder();
  const write = (event: string, data: unknown) => writer.write(encoder.encode(sseEvent(event, data)));
  const start = Date.now();
  const maxTokens = options.maxTokens ?? 512;
  const lastUserMsg = messages[messages.length - 1].content;

  const ollamaMachineNames = OLLAMA_MACHINES.map(m => m.name);
  const uniqueModels = [...new Set(JURY_MODELS.map(m => m.model))];
  const tasks: { entry: ModelEntry; temperature: number }[] = [];
  let tempIdx = 0;
  for (const machineName of ollamaMachineNames) {
    for (const model of uniqueModels) {
      const entry = JURY_MODELS.find(m => m.machine === machineName && m.model === model);
      if (entry) {
        tasks.push({ entry, temperature: JURY_TEMPERATURES[tempIdx % JURY_TEMPERATURES.length] });
        tempIdx++;
      }
    }
  }

  await write("jury.start", { tasks: tasks.length, machines: ollamaMachineNames.length, aggregator: MLX_MODEL, timestamp: new Date().toISOString() });

  const jurorResults: JurorResult[] = [];
  let completed = 0;

  const promises = tasks.map(async ({ entry, temperature }) => {
    const result = await withMachineQueue(entry.machine, async () => {
      const taskStart = Date.now();
      try {
        const res = await callOllama(entry.host, entry.model, messages, { temperature, maxTokens });
        const wallS = (Date.now() - taskStart) / 1000;
        const tokS = res.usage && res.usage.completion_tokens > 0 && wallS > 0
          ? Math.round(res.usage.completion_tokens / wallS * 10) / 10 : 0;
        return { machine: entry.machine, model: entry.model, content: res.content, tokS, wallS: Math.round(wallS * 10) / 10, error: null };
      } catch (err) {
        return { machine: entry.machine, model: entry.model, content: "", tokS: 0, wallS: Math.round((Date.now() - taskStart) / 100) / 10, error: String(err) };
      }
    });
    jurorResults.push(result);
    completed++;
    await write("juror.done", {
      machine: result.machine,
      model: result.model,
      answer: result.content.slice(0, 300),
      tokS: result.tokS,
      wallS: result.wallS,
      error: result.error,
      index: completed,
      total: tasks.length,
    });
    return result;
  });

  await Promise.all(promises);

  const valid = jurorResults.filter(r => !r.error && r.content.length > 0);
  await write("jury.deliberation_complete", {
    responded: valid.length,
    total: tasks.length,
    elapsed_ms: Date.now() - start,
  });

  if (valid.length === 0) {
    await write("jury.error", { error: "All jurors failed" });
    await write("done", {});
    await writer.close();
    return;
  }

  await write("aggregation.start", { aggregator: MLX_MODEL, input_count: valid.length });

  const consensus = await aggregateJury(lastUserMsg, jurorResults, maxTokens);
  const agreement = calculateAgreement(valid.map(r => r.content));

  await write("aggregation.done", { consensus, agreement, total_ms: Date.now() - start });
  await write("done", { consensus, jurors_responded: valid.length, agreement, total_ms: Date.now() - start });
  await writer.close();
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
        router: "rule-based-v1.0",
        fleet: FLEET.length,
        mlx: { model: MLX_MODEL, thinking: mlxState.thinking, restarting: mlxState.restarting },
        config_source: CONFIG_SOURCE,
      });
    }

    // MLX state
    if (url.pathname === "/mlx/state" && req.method === "GET") {
      return Response.json(mlxState);
    }

    // Manual MLX thinking toggle
    if (url.pathname === "/mlx/thinking" && req.method === "POST") {
      const body = await req.json();
      const thinking = Boolean(body.thinking);
      try {
        await ensureMlxThinking(thinking);
        return Response.json({ ok: true, thinking: mlxState.thinking });
      } catch (err) {
        return Response.json({ ok: false, error: String(err) }, { status: 500 });
      }
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

      const lastMessage = messages[messages.length - 1].content;
      console.log(`[jury] "${lastMessage.slice(0, 60)}..." -> ${JURY_MODELS.length} jurors + aggregator (stream=${stream})`);

      if (stream) {
        const { readable, writable } = new TransformStream<Uint8Array>();
        const writer = writable.getWriter();

        runJuryStreaming(messages, writer, { maxTokens }).catch(async (err) => {
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
        const result = await runJury(messages, { maxTokens });
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

      // Redirect to jury if mode=jury
      if (body.mode === "jury") {
        const lastMessage = messages[messages.length - 1]?.content ?? "";
        console.log(`[jury] "${lastMessage.slice(0, 60)}..." (via mode=jury)`);
        try {
          const result = await runJury(messages, { maxTokens: body.max_tokens ?? 256 });
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
      const { entry, reason, needsThinking } = routeRequest(lastMessage, { model: requestedModel, thinking: requestedThinking });

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
                await ensureMlxThinking(needsThinking);
                console.log(`[router] "${lastMessage.slice(0, 60)}..." -> ${mlxMachine}/${entry.model} (${reason}, stream)`);
                return streamOpenAICompatible(entry.host, entry.model, messages, writer, { temperature, maxTokens });
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
            tokens_prompt: 0,
            tokens_completion: 0,
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
            await ensureMlxThinking(needsThinking);
            return callOpenAICompatible(entry.host, entry.model, messages, { temperature, maxTokens });
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
          tokens_prompt: 0,
          tokens_completion: 0,
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
        tokens_prompt: response.usage?.prompt_tokens ?? 0,
        tokens_completion: response.usage?.completion_tokens ?? 0,
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
|     Fleet Router v1.0 (rule-based + thinking)     |
|     http://localhost:${String(ROUTER_PORT).padEnd(27)}|
+--------------------------------------------------+
|  Routing:  keyword rules (0ms, no GPU)            |
|  MLX:      ${MLX_MODEL.slice(0, 37).padEnd(37)} |
|  Thinking: managed (auto-cycle on demand)         |
|  Fleet:    ${String(FLEET.length).padEnd(2)} models across ${String(ALL_MACHINE_NAMES.length).padEnd(2)} machines         |
|  Ollama:   ${ollamaMachineList.slice(0, 37).padEnd(37)} |
|  Config:   ${CONFIG_SOURCE.padEnd(37)} |
+==================================================+
`);

// Verify MLX is reachable on startup
(async () => {
  const ready = await waitForMlxReady(5000);
  if (ready) {
    try {
      const res = await fetch(`http://${MLX_HOST}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MLX_MODEL,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 16,
        }),
      });
      const data = await res.json();
      const hasReasoning = Boolean(data.choices?.[0]?.message?.reasoning);
      mlxState.thinking = hasReasoning;
      console.log(`[mlx] detected current mode: thinking=${hasReasoning}`);
    } catch {
      console.log("[mlx] probe failed, assuming thinking=false");
    }
    console.log("[router] ready.");
  } else {
    console.log("[mlx] server not reachable — will start on first request");
  }
})();
