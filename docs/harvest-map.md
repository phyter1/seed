# Harvest Map — What to Pull From Where

**Date:** 2026-04-04
**Purpose:** For each Seed package, identifies the best working version across the fleet and what it takes to port it.

## The Rule

The fleet is the proving ground. Seed is the distillation. We don't deploy Seed to the fleet — we harvest battle-tested code from the fleet into Seed, genericize it, validate it, then Seed becomes the canonical source.

Sequence per component: **Harvest → Port → Genericize → Validate → Migrate → Retire**

---

## 1. Fleet Router

| | |
|---|---|
| **Harvest from** | `ren-jury/src/rule-router.ts` on ren3 (713 lines) |
| **Status** | **CRITICAL: never committed to git.** Exists only as a local file, synced via fleet-sync. One `git checkout` destroys it. |
| **What it does** | Deterministic keyword-based routing, MLX thinking mode lifecycle management, built-in jury consensus mode, streaming SSE, sampler presets per task type |
| **How it routes** | 5 regex pattern sets (thinking, code, math, reasoning, fast). Currently ALL patterns route to MLX on ren3. Intel machines (ren1/ren2) only used via jury mode. |
| **Config** | Entirely hardcoded + env vars (`MLX_HOST`, `ROUTER_PORT`, `REN1_OLLAMA_HOST`, `REN2_OLLAMA_HOST`). No config file. |
| **Also grab** | `ren-jury/src/start-mlx-server.py` (79 lines) — MLX launcher with memory-aware limits (checks STT memory, reserves headroom) |
| **NOT** | `ren-jury/src/router.ts` (573 lines) — old LLM-based router, superseded |
| **Port into** | `seed/packages/inference/router/` |
| **Genericize** | Hardcoded hostnames → read from `seed.config.json`. Hardcoded fleet manifest → derive from config. Regex patterns could become configurable. |
| **Immediate action** | Commit `rule-router.ts` to the ren-jury repo before anything else. This is unprotected production code. |

**Key files on ren3:**
- `/Users/ryanlowe/code/ren-jury/src/rule-router.ts` — live router (713 lines)
- `/Users/ryanlowe/code/ren-jury/src/start-mlx-server.py` — MLX lifecycle (79 lines)
- `/Users/ryanlowe/code/ren-jury/src/mlx-client.ts` — MLX HTTP client (144 lines)
- `/Users/ryanlowe/code/ren-jury/src/ollama-client.ts` — Ollama HTTP client (137 lines)
- `/Users/ryanlowe/code/ren-jury/src/types.ts` — shared types (80 lines)

---

## 2. Job Queue

| | |
|---|---|
| **Harvest from** | Seed's version is already the superset |
| **Why** | `seed/packages/inference/queue/` = `ren-queue/` + `config.ts` (reads `seed.config.json`) + `provider_id`/`default_model` on workers. Core queue mechanics are byte-for-byte identical. |
| **What's running** | ren-queue on ren1 (server + 5 workers) and ren2 (2 workers) |
| **Stale parts** | Worker scripts reference old models (nemotron-cascade-2, qwen3-coder:30b, DeepSeek-Coder-V2-Lite). Reality is gemma4 variants. |
| **Port action** | Update worker scripts to use `PROVIDER_ID` + `seed.config.json` instead of hardcoded models/endpoints. Update model names. |
| **Decision needed** | Queue stays separate from the control plane (different SLAs — see design-decisions.md). Control plane provides service discovery for the queue. |

**Key files:**
- `seed/packages/inference/queue/src/db.ts` — SQLite queue with rate limiting (509 lines)
- `seed/packages/inference/queue/src/server.ts` — Hono HTTP API (157 lines)
- `seed/packages/inference/queue/src/worker.ts` — worker daemon (303 lines)
- `seed/packages/inference/queue/src/config.ts` — Seed config resolver (Seed-only addition)
- `seed/packages/inference/queue/src/discovery.ts` — mDNS discovery (102 lines)

---

## 3. Heartbeat

| | |
|---|---|
| **Harvest from** | `existential/heartbeat.sh` on ren1 |
| **What it does** | PID lock, PATH setup, beat counter, inbox ingestion, Claude invocation with Codex fallback, post-beat journal ingestion, log rotation |
| **Key finding** | The "two-tier" system (quick/deep beats) described in CLAUDE.md does NOT exist. Actual implementation is single-tier: `claude-sonnet-4-6` every 30 minutes. The quick/deep prompt files don't exist on ren1. |
| **Merge with** | `seed/packages/heartbeat/heartbeat.sh` (adds host adapter routing via `packages/hosts/src/run-headless.ts`) |
| **Port strategy** | Take existential's battle-tested shell logic + Seed's host adapter dispatch. Prompt files become templates with clear extension points. |
| **Genericize** | Blog publishing references, machine-specific paths, ren-specific social accounts → configurable or removed from template |

**Key files on ren1:**
- `existential/heartbeat.sh` — main daemon (live, battle-tested)
- `existential/heartbeat-prompt.txt` — single prompt (has deploy verification update)
- `existential/pulse.sh` — control script
- `existential/com.existential.heartbeat.plist` — launchd (30 min interval)
- `existential/ingest-entry.sh` — journal → memory agent ingestion

---

## 4. Fleet Config & Sync

| | |
|---|---|
| **Harvest from** | `existential/config/fleet-*.json` + `existential/tools/fleet-context.sh` |
| **What exists** | `fleet-machines.json` (machine registry), `fleet-services.json` (service catalog), `fleet-repos.json` (repo manifest), `fleet-bootstrap.json` (discovery chain), `fleet-context.sh` (machine self-ID) |
| **Port into** | Absorbed into the control plane's config store. The JSON schemas inform the control plane's data model. |
| **Git sync** | `existential/tools/git-sync.sh` + `fleet-sync.sh` — may be kept for the identity repo only. All other distribution moves to the control plane. |

---

## 5. Host Adapter Layer

| | |
|---|---|
| **Already in Seed** | `seed/packages/hosts/` — clean TypeScript, Claude/Codex/Gemini adapters |
| **No harvest needed** | Seed-original code, no equivalent elsewhere |
| **Action** | Validate end-to-end on ren1: install deps, run headless dispatch, confirm Claude invocation works |

---

## 6. Pipeline Worker & Dream

| | |
|---|---|
| **Harvest from** | `existential/tools/pipeline-worker.py` and `existential/engine/dream-state-v2.py` |
| **What they do** | Pipeline: multi-phase job orchestrator (fleet-health, hn-digest, job-search, rss-digest, arxiv-digest, repo-scan, memory-consolidation). Dream: nightly 3 AM processing. |
| **Not in Seed yet** | These aren't represented in any Seed package |
| **Decision** | May stay in existential as Ren-specific infrastructure, or may become optional Seed packages later |

---

## 7. Skills

| | |
|---|---|
| **Already distributed** | 9 operational skills in `~/.claude/skills/` on all machines |
| **Source of truth** | `seed/.claude/skills/` (the golden set) |
| **Action** | Delete empty `seed/packages/skills/` directories. `.claude/skills/` is where Claude Code expects them. |

---

## 8. Agent Observatory (Folds Into Control Plane)

| | |
|---|---|
| **Harvest from** | `/Users/ryanlowe/code/agent-observatory/` (26 epics complete, 112+ commits) |
| **What it does** | Real-time monitoring of CLI agents (Claude, Codex, Gemini). OTLP + hook ingestion, session tracking, cost aggregation, anomaly detection, WebSocket dashboard, push notifications. |
| **Stack** | Bun, Hono, Next.js 15, SQLite (bun:sqlite), Zustand, TanStack Query, Tailwind, web-push |
| **Existing fleet presence** | Proxies running on all fleet machines (currently forwarding Claude hooks) |
| **Port into** | `seed/packages/fleet/control/` — the control plane absorbs Observatory's core |

**What to harvest (core telemetry pipeline):**
- `src/server/telemetry/normalizer.ts` — CLI type detection + event normalization
- `src/server/telemetry/routes.ts` — OTLP ingestion endpoints
- `src/server/telemetry/session-tracker.ts` — session lifecycle management
- `src/server/telemetry/event-bus.ts` — internal event pub/sub
- `src/server/telemetry/process-scanner.ts` — fallback process detection
- `src/server/hooks/` — hook receiver + parsers for Claude/Codex/Gemini
- `src/server/anomaly/cost-anomaly-detector.ts` — cost spike detection
- `src/server/websocket/broadcaster.ts` — real-time event broadcasting
- `src/server/routes/dashboard/routes.ts` — dashboard API (agents, costs, orchestration)
- `migrations/001_initial.sql` — session/event/metrics schema

**What to extend:**
- `AgentCli` type: add inference sources (router requests, queue jobs, cloud API calls)
- Session abstraction: CLI sessions (ephemeral) vs inference servers (long-running with requests)
- OTLP normalizer: new branches for `service.name = "fleet-router"`, `"inference-worker"`, etc.
- Cost tracking: $0 for local models, provider-specific pricing for cloud APIs

**What to add (new telemetry sources):**
- Fleet router emits OTLP per request: model, machine, tokens, latency, routing decision
- Queue workers emit OTLP per job: provider, model, tokens, cost, latency, success/failure
- Machine agent health reports (already flowing to control plane) become events in the same pipeline

**What to do with the existing Observatory proxies:**
- Fold into the machine agent — the agent already runs on every machine. Add hook forwarding and OTLP relay as capabilities. The proxy becomes a feature of the agent, not a separate process.

**Dashboard:**
- May stay as a separate frontend package (`packages/fleet/dashboard/`) served by the control plane
- Or may become a route within the control plane's Hono server (lighter weight)
- Decision deferred until the backend integration is done

**Key files to study:**
- `agent-observatory/src/types/index.ts` — `AgentCli` type, `NormalizedEvent` structure
- `agent-observatory/src/server/telemetry/normalizer.ts:188` — CLI detection logic (extend this)
- `agent-observatory/src/server/hooks/parser.ts` — hook payload discriminator pattern
- `agent-observatory/migrations/001_initial.sql` — full schema (sessions, events, metrics)

---

## 9. Claude Code Permission Patterns

| | |
|---|---|
| **Reference** | `ren3:~/code/ccsour/src/` — decompiled Claude Code source |
| **Relevant for** | Control plane agent command security model |
| **Key patterns** | Permission rules, sandbox adapter, policy limits with local caching + background polling |
| **See** | `docs/security-command-model.md` for how we apply these patterns |
