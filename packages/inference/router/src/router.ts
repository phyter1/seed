/**
 * Fleet Router — LLM-powered request routing across machines.
 *
 * The router model sits warm on a router-compatible endpoint as the routing brain.
 * On each request it:
 *   1. Asks the router model to pick the best model/machine
 *   2. Forwards to the selected backend
 *   3. Serves the request on the target (OpenAI-compatible endpoint or Ollama)
 *   4. Re-warms the router model for the next request
 *
 * Config is loaded from seed.config.json when present, or falls back to
 * the legacy fleet.config.json format.
 *
 * Exposes an OpenAI-compatible /v1/chat/completions endpoint.
 * Start: bun run src/router.ts
 */

import { loadRouterConfig, type RouterModelEntry } from "./config";

const {
  routerModel: ROUTER_MODEL,
  routerPort: ROUTER_PORT,
  fleet: FLEET,
  openAICompatibleHost: OPENAI_COMPATIBLE_HOST,
  source: CONFIG_SOURCE,
} = loadRouterConfig();

// ── Router System Prompt ────────────────────────────────────────────────────

const ROUTER_SYSTEM_PROMPT = `You are a request router for a fleet of AI models. Read the user's request and pick the best model to handle it.

Available models:
${FLEET.map((m) => `- ${m.machine}/${m.model}: ${m.description}`).join("\n")}

ROUTING PRINCIPLES:
- Simple/fast tasks → small fast models
- Code tasks → code-specialized models
- Deep reasoning → reasoning-specialized models
- Math/logic → math-specialized models
- General conversation → general-purpose models
- Trivial requests (greetings, simple factual) → fastest model that can handle it
- Prefer speed unless the task genuinely needs a bigger model

Respond with ONLY a JSON object, no markdown, no explanation:
{"machine": "<machine-name>", "model": "exact-model-id", "reason": "one sentence"}`;

// ── Backend Clients ─────────────────────────────────────────────────────────

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatResponse {
  content: string;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

async function callOpenAICompatible(
  host: string,
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<ChatResponse> {
  const res = await fetch(`http://${host}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI-compatible endpoint ${host} error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    model: data.model ?? model,
    usage: data.usage,
  };
}

async function callOllama(
  host: string,
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<ChatResponse> {
  const res = await fetch(`http://${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 2048,
      },
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${host} error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    content: data.message?.content ?? "",
    model: data.model ?? model,
    usage: {
      prompt_tokens: data.prompt_eval_count ?? 0,
      completion_tokens: data.eval_count ?? 0,
      total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
    },
  };
}

// ── Routing Logic ───────────────────────────────────────────────────────────

interface RoutingDecision {
  machine: string;
  model: string;
  reason: string;
}

function parseRoutingDecision(raw: string): RoutingDecision | null {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```json?\n?/g, "")
    .replace(/```/g, "")
    .replace(/<\|im_end\|>/g, "")
    .replace(/<\|endoftext\|>/g, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.machine && parsed.model) return parsed;
  } catch {
    const match = cleaned.match(/\{[^}]+\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.machine && parsed.model) return parsed;
      } catch {}
    }
  }
  return null;
}

function resolveModel(decision: RoutingDecision): RouterModelEntry | null {
  // Exact match first
  let entry = FLEET.find((m) => m.model === decision.model && m.machine === decision.machine);
  if (entry) return entry;

  // Fuzzy: match by model name substring on the right machine
  entry = FLEET.find(
    (m) => m.machine === decision.machine && m.model.toLowerCase().includes(decision.model.toLowerCase())
  );
  if (entry) return entry;

  // Fuzzy: match by model name anywhere
  entry = FLEET.find((m) => m.model.toLowerCase().includes(decision.model.toLowerCase()));
  if (entry) return entry;

  return null;
}

const DEFAULT_MODEL = FLEET.find((m) => m.tags.includes("general") && m.tags.includes("fast")) ?? FLEET[0];

async function route(messages: ChatMessage[]): Promise<RoutingDecision & { resolved: RouterModelEntry }> {
  const routerResponse = await callOpenAICompatible(OPENAI_COMPATIBLE_HOST, ROUTER_MODEL, [
    { role: "system", content: ROUTER_SYSTEM_PROMPT },
    { role: "user", content: messages[messages.length - 1].content },
  ], { temperature: 0.1, maxTokens: 100 });

  const decision = parseRoutingDecision(routerResponse.content);

  if (!decision) {
    console.log(`[router] failed to parse decision, falling back to default`);
    console.log(`[router] raw: ${routerResponse.content.slice(0, 200)}`);
    return { machine: DEFAULT_MODEL.machine, model: DEFAULT_MODEL.model, reason: "routing parse failure — fallback", resolved: DEFAULT_MODEL };
  }

  const resolved = resolveModel(decision);
  if (!resolved) {
    console.log(`[router] unknown model "${decision.model}" on "${decision.machine}", falling back`);
    return { ...decision, resolved: DEFAULT_MODEL };
  }

  return { ...decision, resolved };
}

// ── Re-warm Router Model ──────────────────────────────────────────────────

async function rewarmRouter(): Promise<void> {
  try {
    await callOpenAICompatible(OPENAI_COMPATIBLE_HOST, ROUTER_MODEL, [{ role: "user", content: "ready" }], { maxTokens: 1 });
  } catch {
    // Non-critical — it'll load on next request anyway
  }
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

const server = Bun.serve({
  port: ROUTER_PORT,

  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", router: ROUTER_MODEL, fleet: FLEET.length });
    }

    // List fleet
    if (url.pathname === "/v1/models" && req.method === "GET") {
      return Response.json({
        object: "list",
        data: FLEET.map((m) => ({
          id: `${m.machine}/${m.model}`,
          object: "model",
          owned_by: m.machine,
          tags: m.tags,
        })),
      });
    }

    // Main endpoint
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      const body = await req.json();
      const messages: ChatMessage[] = body.messages ?? [];
      const temperature = body.temperature;
      const maxTokens = body.max_tokens;

      if (messages.length === 0) {
        return Response.json({ error: "messages required" }, { status: 400 });
      }

      const start = Date.now();

      // Step 1: Route
      console.log(`[router] incoming: "${messages[messages.length - 1].content.slice(0, 80)}..."`);
      const decision = await route(messages);
      const routeMs = Date.now() - start;
      console.log(`[router] → ${decision.resolved.machine}/${decision.resolved.model} (${decision.reason}) [${routeMs}ms]`);

      // Step 2: Forward to target
      let response: ChatResponse;
      try {
        if (decision.resolved.provider === "openai_compatible") {
          response = await callOpenAICompatible(decision.resolved.host, decision.resolved.model, messages, { temperature, maxTokens });
        } else {
          response = await callOllama(decision.resolved.host, decision.resolved.model, messages, { temperature, maxTokens });
        }
      } catch (err) {
        console.log(`[router] target failed: ${err}, falling back to default`);
        if (DEFAULT_MODEL.provider === "openai_compatible") {
          response = await callOpenAICompatible(DEFAULT_MODEL.host, DEFAULT_MODEL.model, messages, { temperature, maxTokens });
        } else {
          response = await callOllama(DEFAULT_MODEL.host, DEFAULT_MODEL.model, messages, { temperature, maxTokens });
        }
      }

      const totalMs = Date.now() - start;
      console.log(`[router] done [${totalMs}ms total, ${routeMs}ms routing]`);

      // Step 3: Re-warm router model (fire and forget)
      if (decision.resolved.provider === "openai_compatible") {
        rewarmRouter();
      }

      // Return OpenAI-compatible response
      return Response.json({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: decision.resolved.model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: response.content },
          finish_reason: "stop",
        }],
        usage: response.usage,
        _routing: {
          decision: decision.reason,
          machine: decision.resolved.machine,
          model: decision.resolved.model,
          route_ms: routeMs,
          total_ms: totalMs,
        },
      });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log(`
╔══════════════════════════════════════════════╗
║         Fleet Router v0.2                    ║
║         http://localhost:${ROUTER_PORT}                ║
╠══════════════════════════════════════════════╣
║  Router: ${ROUTER_MODEL.slice(0, 35).padEnd(35)} ║
║  Fleet:  ${String(FLEET.length).padEnd(2)} models                           ║
║  Source: ${CONFIG_SOURCE.padEnd(35)} ║
╚══════════════════════════════════════════════╝
`);

// Warm up the router model on startup
console.log("[router] warming up router model...");
rewarmRouter().then(() => console.log("[router] ready."));
