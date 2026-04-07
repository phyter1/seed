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
} from "./state";
import type { ModelEntry, ChatMessage, ChatResponse } from "./types";
import {
  createTelemetryEmitter,
  resolveTelemetryEndpoint,
  buildInferenceEvent,
  samplerPresetLabel,
  type Provider as TelemetryProvider,
  type RouteType as TelemetryRouteType,
} from "./telemetry";
import { routeRequest, classifyMessages, getSamplerSettings } from "./routing";
import { callOpenAICompatible, callOllama, streamOpenAICompatible, streamOllama } from "./clients";
import { withMachineQueue, pickIdlestMachine, withPrePickedQueue } from "./dispatch";
import {
  type MlxState,
  createMlxSupervisor,
  waitForMlxReady,
  ensureMlxAlive,
  startHealthProbe,
} from "./mlx-lifecycle";
import {
  runJury,
  runJuryStreaming,
  sseEvent,
  type JuryDeps,
} from "./jury-wiring";

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

const mlxState: MlxState = {
  thinking: false,
  pid: null,
};

const mlxSupervisor = createMlxSupervisor(MLX_HOST, MLX_PYTHON_PATH, MLX_STARTER, MLX_MODEL);

let mlxStartLock: Promise<void> = Promise.resolve();

async function ensureMlxAliveLocal(): Promise<void> {
  return ensureMlxAlive(
    MLX_HOST,
    mlxSupervisor,
    mlxState,
    () => mlxStartLock,
    (p) => { mlxStartLock = p; },
  );
}

// Background health probe
startHealthProbe(MLX_HOST, mlxSupervisor);

// ── Dispatch Wrappers (bind ensureQueue) ──────────────────────────────────

function withQueue<T>(machine: string, fn: () => Promise<T>): Promise<T> {
  return withMachineQueue(machine, fn, ensureQueue);
}

function pickIdlest(candidates: string[]): string {
  return pickIdlestMachine(candidates, ensureQueue);
}

function withPrePicked<T>(machine: string, fn: () => Promise<T>): Promise<T> {
  return withPrePickedQueue(machine, fn, ensureQueue);
}

// ── Jury Deps ─────────────────────────────────────────────────────────────

function getJuryDeps(): JuryDeps {
  return {
    callOllama,
    callOpenAICompatible,
    withMachineQueue: withQueue,
    telemetry,
    fleet: FLEET,
    juryModels: JURY_MODELS,
    ollamaMachines: OLLAMA_MACHINES,
    mlxHost: MLX_HOST,
    mlxModel: MLX_MODEL,
  };
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

        runJuryStreaming(messages, writer, { maxTokens, sensitivity: jurySensitivity.level }, getJuryDeps()).catch(async (err) => {
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
        const result = await runJury(messages, { maxTokens, sensitivity: jurySensitivity.level }, getJuryDeps());
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
          const result = await runJury(messages, { maxTokens: body.max_tokens ?? 256, sensitivity: sensitivity.level }, getJuryDeps());
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
      let { entry, reason, needsThinking } = routeRequest(FLEET, lastMessage, { model: requestedModel, thinking: requestedThinking });

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
              await withQueue(mlxMachine, async () => {
                await ensureMlxAliveLocal();
                console.log(`[router] "${lastMessage.slice(0, 60)}..." -> ${mlxMachine}/${entry.model} (${reason}, stream, thinking=${needsThinking})`);
                return streamOpenAICompatible(entry.host, entry.model, messages, writer, { temperature, maxTokens, enableThinking: needsThinking });
              });
            } else {
              const candidates = FLEET.filter(m => m.model === entry.model && m.provider === "ollama");
              const machineNames = [...new Set(candidates.map(c => c.machine))];
              const target = pickIdlest(machineNames);
              streamMachine = target;
              const targetEntry = candidates.find(c => c.machine === target)!;
              console.log(`[router] "${lastMessage.slice(0, 60)}..." -> ${target}/${entry.model} (${reason}, stream, q=${ensureQueue(target).depth})`);
              await withPrePicked(target, () =>
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
          response = await withQueue(mlxMachine, async () => {
            await ensureMlxAliveLocal();
            return callOpenAICompatible(entry.host, entry.model, messages, { temperature, maxTokens, enableThinking: needsThinking });
          });
          console.log(`[router] "${lastMessage.slice(0, 60)}..." -> ${mlxMachine}/${entry.model} (${reason}) [${Date.now() - start}ms]`);
        } else {
          const candidates = FLEET.filter(m => m.model === entry.model && m.provider === "ollama");
          const machineNames = [...new Set(candidates.map(c => c.machine))];
          const target = pickIdlest(machineNames);
          dispatchedMachine = target;
          const targetEntry = candidates.find(c => c.machine === target)!;
          console.log(`[router] "${lastMessage.slice(0, 60)}..." -> ${target}/${entry.model} (${reason}, q=${ensureQueue(target).depth})`);
          response = await withPrePicked(target, () =>
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
  const ready = await waitForMlxReady(MLX_HOST, 5000);
  if (ready) {
    console.log("[router] ready.");
  } else {
    console.log("[mlx] server not reachable — will start on first request");
  }
})();
