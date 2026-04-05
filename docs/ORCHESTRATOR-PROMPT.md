# Seed Control Plane — Orchestrator Prompt

**Date:** 2026-04-04 (updated)
**Purpose:** Hand this to a fresh agent to execute the next phase of Seed development.

---

## Who You Are

You are working on the Seed project (`/Users/ryanlowe/code/seed`). Seed is a monorepo that will own all fleet infrastructure — identity, heartbeat, inference routing, job queue, fleet management, observability, and skills.

The control plane (fleet management, machine agents, CLI) and the fleet router have already been built. The next phase is integrating the Agent Observatory into the control plane so there's one unified system for fleet management + observability.

## What's Already Built

**Completed in prior sessions:**
- `packages/fleet/control/` — control plane server (Hono + WebSocket), machine agent daemon, CLI, Dockerfile, 50 tests. Per-machine auth, command whitelist, SQLite config/audit, health aggregation, break-glass debugging.
- `packages/inference/router/` — rule-based fleet router harvested from ren-jury. Deterministic keyword routing, MLX lifecycle, jury mode, config-driven fleet manifest.
- `packages/inference/queue/` — job queue server harvested from ren-queue. SQLite, rate limiting, mDNS discovery, worker daemon.
- `docs/control-plane-architecture.md` — implementation-ready spec (revised)
- `docs/design-decisions.md` — 16 locked decisions including #16: Observatory folds into control plane
- `docs/security-command-model.md` — auth model, command whitelist, audit schema
- `docs/harvest-map.md` — what to pull from where (includes Observatory as item #8)

## Required Reading (in this order)

1. `docs/design-decisions.md` — especially decision #16 (Observatory fold-in)
2. `docs/harvest-map.md` — section 8 (Observatory) for the harvest plan
3. `docs/control-plane-architecture.md` — the control plane spec you're extending
4. `packages/fleet/control/src/` — the existing control plane code (server, agent, db, types, auth, cli)
5. `docs/fleet-state-snapshot-2026-04-04.md` — what's running on the fleet

Then study the Observatory source:
6. `/Users/ryanlowe/code/agent-observatory/src/server/telemetry/normalizer.ts` — CLI detection + event normalization
7. `/Users/ryanlowe/code/agent-observatory/src/server/telemetry/routes.ts` — OTLP ingestion endpoints
8. `/Users/ryanlowe/code/agent-observatory/src/server/telemetry/session-tracker.ts` — session lifecycle
9. `/Users/ryanlowe/code/agent-observatory/src/server/telemetry/event-bus.ts` — internal event pub/sub
10. `/Users/ryanlowe/code/agent-observatory/src/server/hooks/` — hook receiver + parsers
11. `/Users/ryanlowe/code/agent-observatory/src/server/anomaly/cost-anomaly-detector.ts` — cost spike detection
12. `/Users/ryanlowe/code/agent-observatory/src/server/websocket/broadcaster.ts` — real-time broadcasting
13. `/Users/ryanlowe/code/agent-observatory/src/server/routes/dashboard/routes.ts` — dashboard API
14. `/Users/ryanlowe/code/agent-observatory/src/types/index.ts` — core types (AgentCli, NormalizedEvent)
15. `/Users/ryanlowe/code/agent-observatory/migrations/001_initial.sql` — full schema

## Your Three Tasks (In Order)

### Task 1: Add OTLP Telemetry Emission to the Router

**Location:** `packages/inference/router/`

The fleet router handles every local inference request. It should emit OTLP-compatible telemetry for each one so the control plane can track inference activity fleet-wide.

**What to add:**

1. A telemetry module (`src/telemetry.ts`) that emits events after each request:
   ```typescript
   {
     service_name: "fleet-router",
     event_type: "inference_request",
     timestamp: ISO string,
     attributes: {
       model: string,           // which model handled it
       machine: string,         // which machine (ren1, ren2, ren3)
       provider: "mlx" | "ollama",
       route_type: "keyword" | "explicit" | "jury",
       route_pattern: string,   // which pattern matched (code, reasoning, etc.)
       tokens_input: number,
       tokens_output: number,
       duration_ms: number,
       status: "success" | "error",
       thinking_mode: boolean,
       sampler_preset: string
     }
   }
   ```

2. The telemetry should be sent to a configurable endpoint (default: the control plane's OTLP endpoint). Read the endpoint from `seed.config.json` under a new `telemetry.endpoint` field, with env var override `TELEMETRY_ENDPOINT`.

3. Telemetry emission must be fire-and-forget — never block or slow down inference requests. Use `fetch()` with no `await` or a background queue that batches and flushes.

4. Add the same telemetry emission for jury mode requests (each juror response + the aggregated result).

5. If no telemetry endpoint is configured, silently skip emission (opt-in, not required).

### Task 2: Harvest Observatory Core Into the Control Plane

**Source:** `/Users/ryanlowe/code/agent-observatory/`
**Destination:** `packages/fleet/control/`

Port the Observatory's telemetry pipeline into the existing control plane server. The control plane already has: Hono server, WebSocket, SQLite, machine health aggregation. You're adding: OTLP ingestion, hook ingestion, session tracking, cost tracking, anomaly detection, and event broadcasting.

**What to port:**

1. **Database schema extension** — Add tables to `src/db.ts`:
   - `agent_sessions` — CLI agent and inference sessions (adapt from Observatory's `agent_sessions`)
   - `agent_events` — individual telemetry events (adapt from Observatory's `agent_events`)
   - `agent_metrics` — windowed metric aggregations (adapt from Observatory's `agent_metrics`)

2. **OTLP ingestion** — Add new routes to `src/server.ts`:
   - `POST /otlp/v1/logs` — accept OTLP log payloads
   - `POST /otlp/v1/metrics` — accept OTLP metric payloads
   - Port the normalizer from Observatory (`normalizer.ts`), extending it to handle:
     - `service.name = "claude"` / `"codex"` / `"gemini"` (existing CLI agents)
     - `service.name = "fleet-router"` (from Task 1)
     - `service.name = "inference-worker"` (for future queue worker telemetry)

3. **Hook receiver** — Add to `src/server.ts`:
   - `POST /api/v1/hooks` — accept hook payloads from CLI agents
   - Port the parser and sub-parsers (claude-parser, codex-parser, gemini-parser) from Observatory
   - The existing Observatory proxies on fleet machines will be reconfigured to point at the control plane instead

4. **Event bus** — Add `src/event-bus.ts`:
   - Internal pub/sub for telemetry events
   - Subscribers: session tracker, cost aggregator, anomaly detector, WebSocket broadcaster
   - Port pattern from Observatory's `event-bus.ts`

5. **Session tracker** — Add `src/session-tracker.ts`:
   - Creates/updates sessions from normalized events
   - Handles two session types:
     - **CLI sessions** (ephemeral): start when a CLI agent begins, end when it stops
     - **Inference sessions** (request-scoped): each router/queue request is an event within a long-running service
   - Port from Observatory's `session-tracker.ts`, extend for inference sources

6. **Cost tracking** — Add `src/cost-tracker.ts`:
   - Aggregate token usage and costs per session, per CLI type, per time window
   - Local models (MLX, Ollama) = $0 cost, but still track token counts
   - Cloud APIs = provider-specific pricing
   - Port from Observatory's cost aggregation logic

7. **Anomaly detection** — Add `src/anomaly-detector.ts`:
   - Cost spike detection (port from Observatory)
   - Token rate anomaly detection
   - Session health scoring

8. **Event broadcasting** — Extend the existing WebSocket handler in `src/server.ts`:
   - The control plane already has WebSocket for agent connections
   - Add a second WebSocket path or message type for dashboard clients
   - Broadcast telemetry events in real-time (agent.detected, agent.status_changed, agent.event, agent.health_changed)
   - Port pattern from Observatory's `broadcaster.ts`

9. **Dashboard API** — Add routes to `src/server.ts`:
   - `GET /api/v1/agents` — list all agent sessions (CLI + inference)
   - `GET /api/v1/agents/:id` — session detail with events
   - `GET /api/v1/agents/:id/events` — paginated event timeline
   - `GET /api/v1/costs` — cost breakdown by period and group
   - `GET /api/v1/costs/summary` — today/week/month totals
   - Port from Observatory's dashboard routes

**What NOT to port (yet):**
- The Next.js frontend dashboard — that's a separate task
- The process scanner — the machine agent replaces this
- Push notifications (web-push, Telegram) — defer to later
- Orchestration DAG visualization — defer

### Task 3: Extend Machine Agent as Observatory Proxy

**Location:** `packages/fleet/control/src/agent.ts`

The Observatory currently has separate proxy processes on each fleet machine that forward Claude hooks to the Observatory server. The machine agent should absorb this role — it already runs on every machine and maintains a WebSocket connection to the control plane.

**What to add to the agent:**

1. **Local hook receiver** — The agent listens on a local HTTP port (e.g., `localhost:4312`) for hook payloads from CLI agents running on the same machine:
   - `POST /hooks` — accepts the same payload format as Observatory's hook endpoint
   - Forwards to the control plane via the existing WebSocket connection (new message type: `hook_event`)
   - If the WebSocket is disconnected, buffer events locally and flush on reconnect

2. **Local OTLP receiver** — The agent listens for OTLP telemetry from local services:
   - `POST /otlp/v1/logs` and `POST /otlp/v1/metrics` on the same local port
   - Forwards to the control plane via WebSocket (new message type: `otlp_event`)
   - Same buffering behavior on disconnect

3. **Control plane WebSocket protocol extension** — Add new message types:
   - Agent → Control plane: `{ type: "hook_event", payload: ... }`
   - Agent → Control plane: `{ type: "otlp_event", payload: ... }`
   - Control plane processes these through the same normalizer/event-bus pipeline as direct OTLP/hook ingestion

4. **Agent config for proxy role:**
   ```jsonc
   {
     "proxy": {
       "enabled": true,
       "listen_port": 4312,
       "buffer_max": 1000,  // max events to buffer during disconnect
       "flush_interval_ms": 5000
     }
   }
   ```

5. **Update the CLI agent hook configuration docs** — document how to point Claude Code / Codex / Gemini hooks at the local agent (`http://localhost:4312/hooks`) instead of directly at the Observatory.

## Tests

For each task, write tests that match the patterns in `packages/fleet/control/src/db.test.ts` and `server.test.ts`:

- Task 1: Test that the router emits telemetry events with correct attributes. Test fire-and-forget (router doesn't block on telemetry failure).
- Task 2: Test OTLP ingestion, hook parsing, session creation, cost aggregation, anomaly detection. Test that events flow through the event bus to all subscribers.
- Task 3: Test agent hook forwarding over WebSocket. Test buffering during disconnect. Test flush on reconnect.

## SSH Access

All fleet machines accessible from this machine:
```bash
ssh ryanlowe@ren1.local
ssh ryanlowe@ren2.local
ssh ryanlowe@ren3.local
```

## What NOT To Do

- Don't touch the existential repo — it's the live identity system
- Don't modify anything on ren1 that could disrupt the heartbeat
- Don't force-push anything
- Don't add AI/LLM calls to the fleet management layer — pure infrastructure, $0 to operate
- Don't over-engineer — 3-20 machines, not Kubernetes
- Don't port the Next.js dashboard yet — backend first
- Don't port push notifications yet — defer
- Don't create new documentation files — the docs are written, just update existing ones if the architecture changes
- Don't modify `packages/inference/queue/` — the queue stays separate
