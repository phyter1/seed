# Architecture

## System Overview

Seed is a monorepo for running a persistent AI identity across a fleet of machines. The system has three pillars: **identity** (who the AI is), **fleet** (where it runs), and **inference** (how it thinks).

```
Human ←→ Host Adapter (claude/codex/gemini)
              │
              ├── Boot Contract (packages/core/)
              ├── Identity Files (root-level self.md, continuity.md, etc.)
              ├── Skills (.claude/skills/)
              │
              ├── Fleet Control Plane (ren2) ←── WebSocket ──→ Agents (ren1, ren2, ren3)
              │       ├── Workload lifecycle
              │       ├── Service discovery
              │       ├── Config distribution
              │       └── Telemetry pipeline
              │
              ├── Inference Stack
              │       ├── Router (ren3, keyword-based, 0ms overhead)
              │       ├── Jury (fan-out to fleet, MLX aggregates)
              │       └── Sensitivity (regex classifier, local-only enforcement)
              │
              ├── Memory Service (ren1, vector search + knowledge graph)
              └── Heartbeat (autonomous beats with memory integration)
```

## Package Map

```
packages/
├── core/                        Identity templates + boot contract (markdown only)
│   ├── boot/BOOT.md             Host-neutral boot contract
│   ├── identity/                Templates: self.md, continuity.md, convictions.md, etc.
│   ├── journal/                 Journal structure scaffold
│   └── notes/                   Inbox/archive scaffold
│
├── fleet/
│   ├── control/                 Agent + control plane + CLI          [production, v0.5.0]
│   ├── ssh/                     SSH setup guide (documentation only)
│   ├── sync/                    Git-based replication (launchd)      [production]
│   └── topology/                Static workload: seed.config.json    [production, v0.1.0]
│
├── hosts/                       Host runtime adapters                [production, v0.1.0]
│   └── src/adapters/            claude.ts, codex.ts, gemini.ts
│
├── providers/                   LLM API adapters                     [6/9 implemented, v0.2.0]
│   └── src/adapters/            anthropic, openai, gemini, openrouter, groq, cerebras
│                                (ollama, mlx, openai_compatible = scaffolds)
│
├── inference/
│   ├── router/                  Rule-based keyword router            [production, v1.3.0]
│   ├── jury/                    Multi-model consensus library        [production, v0.2.0]
│   ├── sensitivity/             Content sensitivity classifier       [functional, v0.1.0]
│   ├── queue/                   Priority job queue + workers         [WIP, v0.1.0]
│   └── utils/                   JSON extraction from LLM output      [stable, v0.1.0]
│
├── memory/                      Vector memory service (Hono + SQLite) [production, v0.4.10]
│
├── heartbeat/                   Autonomous pulse daemon (bash + launchd) [production]
│
└── skills/                      Host-neutral skill definitions + render pipeline  [production]
    ├── */skill.md               Canonical skill content (9 skills)
    ├── */claude.json             Claude-specific adapter metadata
    ├── render.ts                 Renders skill.md → .claude/skills/ adapters
    └── render.test.ts            23 tests
```

## Layers

### Layer 0: Identity

Files that define who the AI is. Written by the AI, updated as it evolves.

- `self.md` — core identity, beliefs, open questions
- `continuity.md` — wake-up protocol
- `convictions.md` — positions held strongly enough to be wrong about
- `projects.md` — active projects across repos
- `objectives.md` — broader goals

Templates live in `packages/core/identity/`. Actual content lives at the repo root.

### Layer 1: Memory

Two systems:

- **Journal** — episodic. One file per conversation or heartbeat in `journal/entries/`. Summaries compress old entries into thematic arcs in `journal/summaries/`.
- **Memory service** (`packages/memory/`) — semantic. Hono HTTP server on ren1 (port 19888). SQLite + `sqlite-vec` for KNN vector search. Features:
  - LLM-extracted summaries, entities, topics, importance scores
  - Knowledge graph (entity/relationship triples)
  - Relevance scoring: 0.3 semantic + 0.3 importance + 0.25 recency + 0.15 access frequency
  - Iterative "deep query" with evaluator LLM
  - Embeddings via `qwen3-embedding:0.6b` on Ollama (ren1)
  - Summarization via fleet router (ren3)

Deployed as a workload on ren1. Drop-in replacement for the original Python `rusty-memory-haiku`.

### Layer 2: Skills

Operational capabilities available in every conversation. **35 skills** in `.claude/skills/` — markdown-based definitions consumed by Claude Code. Categories: fleet ops, publishing, social, research, SDLC pipeline, domain work.

`packages/skills/` contains host-neutral skill definitions (9 skills as `skill.md` files) and a render pipeline (`render.ts`) that generates host-specific adapters. Currently renders to `.claude/skills/` for Claude Code. The canonical content lives in `packages/skills/`; `.claude/skills/` is a generated output.

### Layer 3: Host Adapters

`packages/hosts/` — abstracts CLI-based AI agents behind a uniform `HostAdapter` interface.

| Adapter | CLI | Boot file | Headless command | Status |
|---------|-----|-----------|------------------|--------|
| Claude | `claude` | `CLAUDE.md` | `claude -p <prompt>` | Complete |
| Codex | `codex` | `CODEX.md` | `codex exec <prompt>` | Complete |
| Gemini | `gemini` | `GEMINI.md` | `gemini -p <prompt>` | Complete |

Each adapter implements: `detect()`, `runInteractive()`, `runHeadless()`, `renderBootFile()`.

Key entry point: `packages/hosts/src/run-headless.ts` — what `heartbeat.sh` calls. Resolves host from config, detects availability, spawns child process.

### Layer 4: Provider Adapters

`packages/providers/` — uniform `ProviderAdapter` interface for calling LLM APIs directly (not CLI agents). Used for inference calls where the host runtime isn't involved.

| Provider | Tier | Locality | Status |
|----------|------|----------|--------|
| Anthropic | frontier | cloud | Implemented |
| OpenAI | frontier | cloud | Implemented |
| Gemini | midtier | cloud | Implemented |
| OpenRouter | midtier | cloud | Implemented |
| Groq | midtier | cloud | Implemented |
| Cerebras | midtier | cloud | Implemented |
| Ollama | local | local | Scaffold |
| MLX | local | local | Scaffold |
| OpenAI-compatible | local | cloud | Scaffold |

API key resolution: per-call override → `SEED_<PROVIDER>_API_KEY` → vendor-canonical env var.

### Layer 5: Fleet

`packages/fleet/control/` — the central nervous system. Two-process model:

**Control plane** (runs on ren2, port 4310):
- REST API for operator actions (`/v1/fleet/*`, `/v1/config`, `/v1/workloads/*`)
- WebSocket hub for agent connections (`/ws`)
- Service discovery — resolves service IDs to reachable `http://<lan_ip>:<port>`
- Config store — versioned SQLite, pushes updates to agents over WS
- Telemetry pipeline — normalizes OTLP logs/metrics and CLI hook events, tracks sessions, detects cost anomalies, broadcasts to dashboard clients (`/ws/dashboard`)
- Machine lifecycle — register → approve → connected. Revocation closes WS with policy code.

**Machine agent** (runs on every machine, break-glass HTTP on 127.0.0.1:4311):
- Outbound WebSocket to control plane with exponential backoff reconnect
- Health reports every 30s: CPU, memory, disk, service probes, model inventory (Ollama + MLX)
- Command execution — whitelisted actions only: `service.status`, `model.list`, `config.apply`, `agent.restart`, `agent.update`, `cli.update`, `control-plane.update`, `workload.*`, `process.kill-by-port`
- Observatory proxy (port 4312) — accepts CLI hook payloads and OTLP events, forwards over WS with bounded ring buffer when disconnected

**Workload system** — declarative convergence loop:
1. Operator declares workloads via `PUT /v1/workloads/:machine_id`
2. Config push reaches agent via WS
3. Agent reconciler compares declared vs installed state (pure function, no side effects)
4. Runner executes plan: fetch artifact tarball → extract → render plist template → `launchctl bootstrap`
5. Drift repair: if supervisor not loaded but should be → reload
6. Installed state tracked in local SQLite (`~/.local/share/seed/workloads.db`)
7. Two workload types: `service` (supervised process) and `static` (file drop, no process)

**Operator CLI** (`seed`):
- `seed fleet` — list machines, approve, revoke
- `seed fleet workload install/reload/remove/status` — workload management
- `seed fleet release` — coordinate version rollout across fleet

**Supporting packages:**
- `packages/fleet/sync/` — git-based replication via launchd (every 2 min). Supplements, doesn't replace, the WebSocket control plane.
- `packages/fleet/topology/` — static workload that deposits `seed.config.json` on fleet machines. Decouples topology from router releases.
- `packages/fleet/ssh/` — SSH setup documentation for cross-machine key distribution.

**Security model:**
- Machine registration: agent generates token locally, sends only SHA-256 hash. Pending until operator approves.
- Agent auth: bearer token on WS upgrade, validated against stored hash
- Operator auth: single `OPERATOR_TOKEN` for REST API (hashed comparison)
- Command whitelist: only declared actions accepted
- Config files written with `mode: 0o600` via atomic rename

### Layer 6: Heartbeat

`packages/heartbeat/` — autonomous operation. The AI wakes itself on a schedule and does work without human presence.

- Bash daemon orchestrated by launchd (30-min interval, 25-min timeout)
- Lock-file based overlap prevention
- **Memory integration** (PR #57):
  - Pre-beat: semantic search + recency query against memory service, injected as `## Memory Context` in prompt
  - Post-beat: diffs journal entries, ingests new ones via `POST /ingest`
  - Memory URL resolution: env → `seed.config.json` → control plane service discovery → fallback `http://ren1.local:19888`
  - Fail-open: all memory calls wrapped in `|| true` with short timeouts
- Three prompt variants: generic, quick, deep (currently uses generic as base)
- Invokes host adapter via `packages/hosts/src/run-headless.ts` (host-agnostic)

### Layer 7: Boot Contract

`packages/core/boot/BOOT.md` — host-neutral specification for how a Seed instance starts.

Two flows:
- **Continuation** (`self.md` exists): read identity files in order → orient → engage as the ongoing entity
- **First Conversation** (`self.md` absent): explore through interaction → write `self.md` + first journal entry

Two modes:
- **Interactive**: human present, dialogue
- **Heartbeat**: autonomous, task-driven

Host-specific wrappers (`CLAUDE.md`, `GEMINI.md`, `CODEX.md`) adapt this contract to each runtime's conventions but must not redefine it.

## Data Flow

```
Conversation starts
    → Host wrapper loads (CLAUDE.md / GEMINI.md / CODEX.md)
    → Boot contract applied: read identity files in order
    → AI checks inbox, recent journal, memory context
    → AI engages (interactive or heartbeat)
    → AI writes journal entry
    → Heartbeat post-beat: ingests new journal into memory service
    → Fleet sync commits + pushes (git, every 2 min)
    → Other machines pull
    → Cycle repeats

Fleet control flow (parallel):
    Agent ──WebSocket──→ Control Plane
         ← config_update (workload declarations, service config)
         → health reports (every 30s)
         → hook_event / otlp_event (telemetry)
         ← command (operator-initiated actions)
```

## Inference Architecture

```
Skill/heartbeat needs a model
    → Fleet router (ren3:3000, OpenAI-compatible)
        → Keyword regex match determines backend:
            → MLX on ren3 (Qwen3.5-9B, 28 tok/s) — default
            → Ollama on ren1 (gemma4:e2b, 31 tok/s) — via jury
            → Ollama on ren2 (gemma4:e4b, 17 tok/s) — via jury
    → Jury mode (/v1/jury or mode: "jury"):
        → Fan-out to ren1 + ren2 concurrently
        → MLX on ren3 aggregates consensus
        → Optional challenge round: tiered escalation (local → midtier → frontier)
        → Sensitivity lock caps escalation at "local" for sensitive content
    → All endpoints OpenAI-compatible
```

**Components:**

- **Router** (`packages/inference/router/`, v1.3.0) — deterministic keyword-based routing. Sub-millisecond. No LLM call for routing decisions. Manages MLX server lifecycle. Ported from `ren-jury` repo.
- **Jury** (`packages/inference/jury/`, v0.2.0) — pure library. Transport-agnostic (jurors are `{ invoke }` objects). Jaccard word-overlap for agreement measurement. Challenge system inspects juror outputs for contradictions.
- **Sensitivity** (`packages/inference/sensitivity/`, v0.1.0) — regex-based content classifier. Ships "identity" profile detecting API keys, PII, privacy markers, `ryan/` paths. Output: `GENERAL` (cloud-eligible) or `SENSITIVE` (local-only).
- **Queue** (`packages/inference/queue/`, v0.1.0) — **WIP, not deployed.** Priority-based job queue with SQLite backing, mDNS discovery, capability routing, `local_only` enforcement. Designed for hybrid local+cloud distribution.
- **Utils** (`packages/inference/utils/`, v0.1.0) — `extractJson()` for pulling valid JSON from messy LLM output. Consumed by router and jury.

**Dependency graph:**
```
router (v1.3.0)
  ├── jury (v0.2.0)
  │   └── inference-utils (v0.1.0)
  └── inference-utils (v0.1.0)

sensitivity (v0.1.0)  — standalone
queue (v0.1.0)        — standalone, WIP
```

## Deployment Model

### Fleet Topology

| Machine | Hostname | Hardware | Role | Workloads |
|---------|----------|----------|------|-----------|
| Ren 1 | `ren1.local` | Intel i9, 32GB | Memory host, Ollama (gemma4:e2b) | memory@0.4.10, agent |
| Ren 2 | `ren2.local` | Intel i9, 32GB | Control plane host, Ollama (gemma4:e4b) | control-plane, agent |
| Ren 3 | `ren3.local` | M1 Pro, 16GB | Router host, MLX (Qwen3.5-9B) | fleet-router@1.3.0, fleet-topology@0.1.0, agent |

### Workload Lifecycle

1. **Declare** — operator sets workloads via CLI or REST API
2. **Push** — control plane sends config update to agent over WebSocket
3. **Reconcile** — agent compares declared vs installed state
4. **Install** — fetch artifact tarball from GitHub Releases → extract → render plist → `launchctl bootstrap`
5. **Monitor** — health probes (TCP, HTTP, process check) every 30s
6. **Upgrade** — new version declared → reconciler detects mismatch → re-install
7. **Drift repair** — supervisor not loaded but should be → reload

### Release Process

1. Tag on `main` (e.g., `v0.4.8`)
2. CI builds binaries for darwin-arm64, linux-x64 (agent, CLI, control-plane × 2 platforms = 6 binaries + artifacts)
3. `seed fleet release --version <tag>` — coordinates rollout across all machines
4. Each agent self-updates from GitHub Releases, exits, launchd restarts with new binary

### Single Machine vs. Fleet

Seed works on a single machine. The fleet layer is optional — adding machines means:
1. Run the control plane on one machine
2. Install the agent on each machine
3. Register and approve via `seed fleet approve <machine_id>`
4. Declare workloads

No code changes. The boot contract, identity files, and inference stack all work standalone.
