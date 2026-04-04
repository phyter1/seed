# Seed Control Plane — Architecture Specification

**Status:** Implementation-ready
**Date:** 2026-04-04
**Authors:** Ren + Ryan
**Inputs:** Initial design sketch, adversarial review (P0/P1 fixes), Salt research, Claude Code permission patterns, design-decisions session

---

## Problem

Seed's fleet management is currently duct-taped together:
- Git sync distributes files but can't manage services, push config changes, or detect drift
- SSH-based probing works on a LAN but breaks across networks
- mDNS discovery only covers the queue server
- Machine state is scattered across 4 repos with stale docs

We need a control plane that:
1. Works across networks (LAN, WAN, cloud — fleet machines don't have to be co-located)
2. Can run anywhere (Docker container, EC2, home server, one of the fleet machines)
3. Centralizes fleet config, health monitoring, and command dispatch
4. Doesn't require the user's machine to be online for the fleet to operate
5. Is simple enough to ship in Seed as a package anyone can deploy
6. Costs $0 to operate — no AI/LLM calls in the fleet management layer

### Why Custom, Not Salt/Ansible/Nomad

Salt is the closest analog. It has the same outbound-agent topology, grains/pillars, command dispatch, and health monitoring. We build custom because:

1. **Operational weight.** Salt requires a formula management system, pillar encryption setup, key management ceremony, and several GB of Python dependencies. Our fleet is 3-20 machines running specific software. A 2000-line TypeScript daemon is the right weight.
2. **Inference-native.** We need model management commands (load, unload, swap with drain), MLX lifecycle management, and health probes that understand inference runtimes. These would be custom Salt modules anyway.
3. **Stack alignment.** The rest of Seed is Bun + TypeScript + Hono + SQLite. Adding a Python-based Salt master and minions is a second runtime with its own dependency tree.
4. **Integration.** The control plane needs to integrate with Seed's config schema, the inference queue's service discovery, and the heartbeat's scheduling. A custom control plane reads `seed.config.json` natively.

We steal Salt's best patterns (grains/pillars, JID correlation, three-state key lifecycle, randomized reconnect backoff) and explicitly avoid its worst (Jinja rendering of minion data, shared AES keys, `cmd.run`, `auto_accept`).

### Scaling Ceiling

This design targets fleets of **3-20 machines**. At that scale, a single WebSocket server, in-memory health aggregation, and SQLite config store are more than sufficient.

At **20-50 machines**, the design still works but health aggregation latency and config fan-out become noticeable. Monitor WebSocket connection count and health processing time.

At **100+ machines**, the WebSocket server, health aggregation, and config fan-out need rethinking — likely a message broker (NATS, Redis Streams) and a time-series database for health data. This is a different system. We do not design for it now, but we do not make choices that prevent migration later.

---

## Topology

```
                    ┌─────────────────────┐
                    │    Control Plane     │
                    │  (Docker on ren1)    │
                    │                     │
                    │  WebSocket server    │
                    │  REST API (Hono)     │
                    │  SQLite config store │
                    │  Health aggregator   │
                    │  Audit log           │
                    └────┬───┬───┬────────┘
                         │   │   │
              WSS        │   │   │  WSS
              (persistent)   │   (persistent)
                         │   │   │
              ┌──────────┘   │   └──────────┐
              │              │              │
        ┌─────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐
        │  Machine 1 │ │  Machine 2 │ │  Machine 3 │
        │  (agent)   │ │  (agent)   │ │  (agent)   │
        │            │ │            │ │            │
        │  localhost  │ │  localhost  │ │  localhost  │
        │  :4311      │ │  :4311      │ │  :4311      │
        │  break-glass│ │  break-glass│ │  break-glass│
        └────────────┘ └────────────┘ └────────────┘

        ┌────────────┐
        │ User CLI   │──── REST API (HTTPS) ────────┐
        │ (seed fleet)│                              │
        └────────────┘                              │
                                                    ▼
                                            Control Plane
```

**Key insight:** Fleet machines connect *outbound* to the control plane. The control plane never reaches into fleet machines. This means:
- No SSH key distribution for fleet ops
- No port forwarding or firewall rules on fleet machines
- No mDNS or LAN dependency
- Works across NATs, VPNs, cloud boundaries
- Fleet machines behind a home router just work

---

## Components

### 1. Control Plane Server

A single process (Docker container) running on a dedicated always-on machine (ren1 in our fleet). The user's machine (ryan-air) is a *client* — it can observe, configure, and override, but it doesn't run services and doesn't need to be online.

**Stack:** Bun + Hono (matches the queue server pattern in `packages/inference/queue/`). SQLite via `bun:sqlite` for all persistent state.

**Port:** `4310` (REST API + WebSocket upgrade on same port).

#### WebSocket Server

Persistent connections from fleet machine agents.

- Receives: `announce`, `health`, `command_result`, `config_ack` messages from agents
- Sends: `config_update`, `command` messages to agents
- Tracks connection state per machine (connected/disconnected, last seen)
- **Ping/pong keepalive every 30 seconds** — required to survive Cloudflare Tunnel idle timeout (~100s on free plan). The server sends `ping`; agent responds with `pong`. Missing 3 consecutive pongs marks the connection as dead.
- One active connection per machine ID. If a second connection claims the same `machine_id`, reject it — the existing connection takes priority. The operator must explicitly revoke and re-approve to transfer a machine ID to new hardware.

#### REST API

For user CLI and external integrations.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Server health (uptime, connected machines count) |
| `GET` | `/v1/fleet` | Operator | All machines with status and latest health |
| `GET` | `/v1/fleet/:machine_id` | Operator | Single machine detail |
| `GET` | `/v1/fleet/:machine_id/health` | Operator | Latest health report for a machine |
| `POST` | `/v1/fleet/approve/:machine_id` | Operator | Approve a pending machine |
| `POST` | `/v1/fleet/revoke/:machine_id` | Operator | Revoke a machine (deletes token, drops connection) |
| `POST` | `/v1/fleet/:machine_id/command` | Operator | Dispatch a command to a machine |
| `GET` | `/v1/config` | Operator | Current fleet config with version |
| `PUT` | `/v1/config` | Operator | Update fleet config (increments version, pushes to agents) |
| `GET` | `/v1/config/export` | Operator | Export config as JSON (for backup/git) |
| `GET` | `/v1/audit` | Operator | Recent audit log entries (default last 100) |
| `GET` | `/v1/audit?machine_id=X` | Operator | Audit entries filtered by machine |

#### SQLite Database

WAL mode for concurrent access. Stored in `/data/seed-control.db` (Docker volume).

**`machines` table:**
```sql
CREATE TABLE machines (
  id TEXT PRIMARY KEY,                    -- "ren1", "ren2", etc.
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'revoked'
  token_hash TEXT,                        -- bcrypt hash of machine token
  arch TEXT,                              -- "x86_64", "arm64"
  platform TEXT,                          -- "darwin", "linux"
  memory_gb REAL,
  agent_version TEXT,
  last_seen TEXT,                         -- ISO timestamp
  last_health TEXT,                       -- JSON blob of latest health report
  config_version INTEGER DEFAULT 0,       -- last acknowledged config version
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**`config` table:**
```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,          -- "fleet", "services.ren1", "models.ren1", etc.
  value TEXT NOT NULL,           -- JSON
  version INTEGER NOT NULL,      -- monotonic counter, incremented on every write
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL       -- "operator:ryan", "system:init", etc.
);
```

**`config_history` table:**
```sql
CREATE TABLE config_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  version INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  changed_by TEXT NOT NULL
);
```

**`audit_log` table:**
```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,           -- 'command', 'config_change', 'machine_join',
                                      -- 'machine_approve', 'machine_revoke', 'auth_failure'
  machine_id TEXT,                     -- target machine (null for fleet-wide)
  issued_by TEXT,                      -- 'operator:ryan', 'system:config_poll', etc.
  action TEXT,                         -- 'service.restart', 'model.swap', etc.
  params TEXT,                         -- JSON params (never contains tokens)
  result TEXT,                         -- 'success', 'failure', 'timeout', 'rejected'
  details TEXT,                        -- error message or result payload (JSON)
  command_id TEXT                      -- correlation UUID
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_machine ON audit_log(machine_id);
CREATE INDEX idx_audit_command ON audit_log(command_id);
```

#### Health Aggregator

Maintains an in-memory view of fleet state, updated from agent health reports.

- Each agent reports every **30 seconds**
- Control plane tracks: last seen, services running, models loaded, resource usage
- **Drift detection:** compares actual state (from health reports) against desired state (from config). Logs drift events. Does *not* auto-remediate in v1 — drift is surfaced to the operator via `seed fleet status`.
- **Absence detection:** machine not seen for 5 minutes → marked `offline` in fleet status
- Health reports are held **in memory only** — latest report per machine. Not written to SQLite on every report (would be 2 writes/min per machine). The `last_health` column in `machines` is updated every 5 minutes or on disconnect.

### 2. Machine Agent

A small native daemon that runs on every fleet machine. **Not an AI agent** — a lightweight process that runs scripts, reports health, and executes whitelisted commands. No LLM calls. $0 to operate.

**Stack:** Bun, single TypeScript file. Runs natively (not Docker) because it needs access to local services (Ollama, launchd, filesystem).

#### Connection Management

- Persistent WSS connection to the control plane
- Auto-reconnect with **jittered exponential backoff**: base 1s, multiplier 2x, max 60s, jitter ±30%. This prevents thundering herd when the control plane restarts.
- On connect: send `announce` message with machine identity
- On disconnect: continue operating on cached config (fail-open for config)
- Connection URL from `~/.config/seed-fleet/agent.json` or `SEED_CONTROL_URL` env var

#### Self-Identification (Grains)

On connect, the agent sends an `announce` message — the Salt "grains" pattern (machine reports facts up):

```jsonc
{
  "type": "announce",
  "machine_id": "ren1",
  "hostname": "ren1.local",
  "arch": "x86_64",
  "cpu_cores": 8,
  "memory_gb": 32,
  "platform": "darwin",
  "agent_version": "0.1.0",
  "config_version": 3,        // last applied config version
  "capabilities": ["ollama", "bun", "claude-code", "git"]
}
```

The `config_version` field enables the reconnect protocol: the control plane compares the agent's version against the current version and pushes only if they differ.

#### Health Reporter

Every 30 seconds, collects and reports:

```jsonc
{
  "type": "health",
  "machine_id": "ren1",
  "timestamp": "2026-04-04T12:00:00Z",
  "system": {
    "cpu_percent": 12.5,
    "memory_used_gb": 18.2,
    "memory_total_gb": 32,
    "disk_free_gb": 120
  },
  "services": [
    {
      "id": "ollama",
      "health_tier": "serving_requests",  // see Health Check Tiering
      "port": 11434,
      "details": {}
    },
    {
      "id": "ren-queue-server",
      "health_tier": "accepting_connections",
      "port": 7654,
      "details": {}
    }
  ],
  "models": [
    {
      "name": "gemma4:e2b",
      "runtime": "ollama",
      "loaded": true,
      "size_gb": 3.2
    }
  ]
}
```

#### Health Check Tiering

Health is a four-tier concept, not a boolean:

| Tier | Meaning | How Detected |
|------|---------|-------------|
| `process_alive` | OS process exists | PID check or `pgrep` |
| `accepting_connections` | Port is open and responding | TCP connect to port succeeds |
| `serving_requests` | Service responds to a health endpoint correctly | HTTP GET returns 200 (see probes below) |
| `within_sla` | Response time is within acceptable bounds | Health endpoint responds within configured timeout |

**Service-specific probes:**

| Service | Probe | Endpoint | Expected |
|---------|-------|----------|----------|
| Ollama | HTTP GET | `http://localhost:11434/api/tags` | 200 + valid JSON |
| MLX | HTTP GET | `http://localhost:8080/v1/models` | 200 + valid JSON |
| Queue server | HTTP GET | `http://localhost:7654/health` | 200 |
| Fleet router | HTTP GET | `http://localhost:3000/health` | 200 |
| Generic TCP | TCP connect | configured port | Connection succeeds |

Probe definitions come from the agent's config (pushed by the control plane). Unknown services default to TCP connect on their configured port.

**Hysteresis:** A service is marked unhealthy only after **3 consecutive failures** (at 30s intervals = 90s of failure). A service is marked healthy after **2 consecutive successes** (60s of recovery). This prevents flapping restarts.

#### Command Executor

Receives commands from the control plane, dispatches to handler functions by action name. The agent has a **hardcoded registry** of valid actions. Anything not in the registry is rejected immediately.

Commands follow the envelope spec from `security-command-model.md`:

```jsonc
{
  "type": "command",
  "command_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-04-04T12:00:00Z",
  "target": "ren1",
  "action": "service.restart",
  "params": {
    "service_id": "ollama"
  },
  "timeout_ms": 30000,
  "issued_by": "operator:ryan"
}
```

**Validation rules (agent-side, before execution):**
1. `target` must match the agent's own `machine_id`. Reject if it doesn't.
2. `action` must exist in the handler registry. Reject unknown actions.
3. `params` are validated per action schema. Reject malformed params.
4. `service_id` must match a service in the agent's config. Unknown services rejected.
5. `model_name` must match a model in the agent's config. Arbitrary names rejected.
6. `repo_id` must match a repo in the agent's config. Arbitrary URLs rejected.

**Command result:**

```jsonc
{
  "type": "command_result",
  "command_id": "550e8400-e29b-41d4-a716-446655440000",
  "success": true,
  "output": "Service ollama restarted",
  "duration_ms": 1500
}
```

#### Action Whitelist

| Action | Params | What It Does |
|--------|--------|-------------|
| `service.start` | `{ service_id: string }` | Start a known service via launchd/systemd |
| `service.stop` | `{ service_id: string }` | Stop a known service |
| `service.restart` | `{ service_id: string }` | Stop then start |
| `service.status` | `{ service_id: string }` | Return service status |
| `model.load` | `{ model_name: string, runtime: "ollama" \| "mlx" }` | Load a model |
| `model.unload` | `{ model_name: string, runtime: "ollama" \| "mlx" }` | Unload a model |
| `model.swap` | `{ unload: string, load: string, runtime: string, drain: bool }` | Swap with optional drain (see Model Swap Drain Mode) |
| `model.list` | `{}` | List loaded models |
| `config.apply` | `{ config: object, version: number }` | Apply a config update |
| `config.report` | `{}` | Report current config + version |
| `health.report` | `{}` | Trigger an immediate health report |
| `repo.pull` | `{ repo_id: string }` | Git pull a known repo (from config registry, not arbitrary URL) |
| `agent.update` | `{ version: string }` | Self-update the agent binary |
| `agent.restart` | `{}` | Restart the agent process |

**There is no `run_script` action.** This was explicitly removed. If a new capability is needed, add a specific action type with defined params. Never execute arbitrary paths or shell strings.

#### Config Watcher

Receives config updates from the control plane (the Salt "pillars" pattern — config pushes down):

```jsonc
{
  "type": "config_update",
  "version": 4,
  "config": {
    "services": [
      {
        "id": "ollama",
        "port": 11434,
        "probe": { "type": "http", "path": "/api/tags" },
        "depends_on": []
      },
      {
        "id": "ren-queue-server",
        "port": 7654,
        "probe": { "type": "http", "path": "/health" },
        "depends_on": ["ollama"]
      }
    ],
    "models": [
      { "name": "gemma4:e2b", "runtime": "ollama", "keep_alive": -1 }
    ],
    "repos": [
      { "id": "existential", "path": "~/code/existential" },
      { "id": "ren-queue", "path": "~/code/ren-queue" }
    ]
  }
}
```

**Config acknowledgment protocol:**

1. Agent receives `config_update` with `version: N`
2. Agent validates the config object against its schema
3. If valid: caches to `~/.config/seed-fleet/config.json`, applies changes, sends `config_ack`:
   ```jsonc
   {
     "type": "config_ack",
     "version": 4,
     "status": "applied",
     "machine_id": "ren1"
   }
   ```
4. If invalid: sends `config_ack` with `"status": "rejected"` and `"reason": "..."`. Continues on previous config.
5. Control plane tracks last acknowledged version per machine in the `machines.config_version` column.
6. On reconnect: agent sends `config_version` in `announce`. Control plane compares against current version. If different, pushes the full config.

Each machine receives only its own config slice. The control plane resolves "what should machine X be doing?" and pushes just that slice. Machines never see other machines' tokens, configs, or command traffic.

#### Offline Resilience

The agent is designed to operate indefinitely without the control plane. Concrete behavior when disconnected:

1. **Config:** Agent continues on the last cached config from `~/.config/seed-fleet/config.json`. This file is written atomically (write to temp file, rename) on every successful config receipt.
2. **Services:** Agent continues managing services per cached config. Health probes continue. If a service crashes, the agent can restart it using its local service manager (launchd/systemd) without control plane involvement.
3. **Health reports:** Collected but not sent. Dropped (not queued) — health data is ephemeral. The next report after reconnect gives the control plane current state.
4. **Commands:** Not received. The control plane queues commands for disconnected machines for up to 5 minutes. After that, commands are marked `timeout` in the audit log and discarded.
5. **Reconnect:** Jittered exponential backoff (1s base, 2x multiplier, 60s max, ±30% jitter). On reconnect, `announce` includes `config_version` for delta sync.

**The queue server, inference workers, Ollama, MLX, heartbeat — all continue running.** The fleet degrades to "no management visibility" but does not disrupt running workloads.

#### Break-Glass Local HTTP Endpoint

When the WebSocket connection is down, you can't debug via the control plane. The agent exposes a local HTTP server on `localhost:4311` (loopback only, no auth needed — physical/SSH access required):

| Path | Description |
|------|-------------|
| `GET /health` | Agent process health, uptime, connection state |
| `GET /status` | Full machine status: services, models, config version |
| `GET /config` | Current cached config |

This is the out-of-band diagnostic path. SSH remains the break-glass mechanism for reaching the machine itself; the local endpoint provides structured state without parsing logs.

### 3. User CLI

`seed fleet <command>` — connects to the control plane REST API.

| Command | Description |
|---------|-------------|
| `seed fleet status` | All machines with health, services, models |
| `seed fleet approve <machine_id>` | Approve a pending machine |
| `seed fleet revoke <machine_id>` | Revoke a machine |
| `seed fleet config` | Display current fleet config |
| `seed fleet config set <key> <value>` | Update a config key (increments version, pushes to agents) |
| `seed fleet audit [--limit N]` | Display recent audit entries |
| `seed fleet command <machine_id> <action> [params...]` | Dispatch a command |

CLI reads the control plane URL from `SEED_CONTROL_URL` env var or `~/.config/seed-fleet/cli.json`. Authenticates with an operator token (separate from machine tokens).

---

## Security Model

### Authentication

**Per-machine tokens.** Each machine gets a unique random 256-bit token at registration time. Compromising one machine does not compromise the fleet.

```
Machine token:
  machine_id: "ren1"
  token: <unique random 256-bit>
  role: "agent"
  permissions: ["health.report", "command.acknowledge", "config.receive"]

Operator token:
  token: <unique random 256-bit>
  role: "operator"
  permissions: ["fleet.read", "fleet.write", "command.dispatch", "config.update"]
```

- **Machine tokens** are generated at registration time, stored on the machine in `~/.config/seed-fleet/agent.json` (mode 600)
- **Operator tokens** are separate — different trust domain. Used by CLI.
- Tokens are sent in the WebSocket upgrade request: `Authorization: Bearer <token>`
- Control plane validates token hash against its machine registry
- Revoking a machine = delete its token hash from the registry. The machine can't reconnect.
- **Tokens are NEVER in `seed.config.json`** or any config file, never logged, never included in audit entries. Only token hashes are stored.

### Transport

**WSS (TLS) unconditionally.** No plaintext WebSocket, even on a "trusted LAN."

- Cloudflare Tunnel provides TLS for free in the primary deployment model
- Direct LAN connections must also use TLS (self-signed cert is acceptable for LAN-only fleets)
- The control plane refuses plaintext WebSocket upgrade requests

### Machine Lifecycle

Three-state model (stolen from Salt's `minions_pre/minions/minions_rejected` directories):

```
  ┌─────────┐    approve    ┌──────────┐    revoke    ┌─────────┐
  │ pending  │──────────────→│ accepted │──────────────→│ revoked │
  └─────────┘               └──────────┘               └─────────┘
       ↑                                                     │
       │              re-register (new token)                │
       └─────────────────────────────────────────────────────┘
```

1. **Pending:** Agent connects with an unknown `machine_id`. Control plane records it but does not send config or accept commands. Visible in `seed fleet status` as pending.
2. **Accepted:** Operator runs `seed fleet approve <machine_id>`. Control plane generates a token, stores the hash, and sends the token to the agent (one-time, over the WSS connection). Agent persists token to `~/.config/seed-fleet/agent.json`. From this point, the agent authenticates with this token on every reconnect.
3. **Revoked:** Operator runs `seed fleet revoke <machine_id>`. Token hash deleted. Active WebSocket connection dropped. Agent can't reconnect. To re-join, the machine must be re-registered (goes back to pending with a new token).

**Machine ID impersonation prevention:** Only one active connection per `machine_id`. If a connection already exists for a `machine_id` and a new connection claims the same ID, the new connection is rejected. The operator must revoke the existing machine before a different physical machine can claim that ID.

### Audit Log

Every command dispatched, every config change, every machine join/leave, every auth failure. Written to SQLite. Non-negotiable for post-incident analysis. See the `audit_log` schema above.

---

## Protocol

### Agent → Control Plane

| Message Type | When | Payload |
|-------------|------|---------|
| `announce` | On connect | Machine identity, capabilities, config version |
| `health` | Every 30s | System metrics, service health (tiered), loaded models |
| `command_result` | After executing a command | Command ID, success/failure, output, duration |
| `config_ack` | After receiving config update | Version, applied/rejected, reason if rejected |

### Control Plane → Agent

| Message Type | When | Payload |
|-------------|------|---------|
| `config_update` | On config change, or on reconnect if version mismatch | Config slice for this machine, version number |
| `command` | On operator dispatch | Command envelope (see Action Whitelist) |
| `ping` | Every 30s | Keepalive (agent responds with `pong`) |

All messages are JSON. All messages include a `type` field for dispatch. Command messages include a `command_id` (UUID) for correlation — the Salt JID pattern.

---

## Config Model

### Separation of Concerns

**Canonical config lives on the control plane**, not in git. The control plane's SQLite config store is the single source of truth for fleet state at runtime.

**Git is for identity/memory persistence only.** Each fleet gets a git repo for shared state that needs history — identity files, journal entries, notes (the existential repo pattern). Git is NOT used for infrastructure distribution, service management, or fleet topology.

**Config export for backup:** The control plane supports `GET /v1/config/export` to dump config as JSON. This can be committed to git for version history and disaster recovery. But the runtime source of truth is always the control plane's SQLite store.

### Config Structure

The control plane stores config as key-value pairs in SQLite, each with a version counter. The global version is the max of all key versions.

Logical structure (how it looks when exported):

```jsonc
{
  "fleet": {
    "name": "ren-fleet",
    "control_plane_url": "wss://control.phytertek.com"
  },
  "machines": {
    "ren1": {
      "display_name": "Ren 1",
      "roles": ["heartbeat", "queue-server", "worker"],
      "services": [
        {
          "id": "ollama",
          "port": 11434,
          "probe": { "type": "http", "path": "/api/tags" },
          "manager": "launchd",
          "launchd_label": "com.ollama.server",
          "depends_on": []
        },
        {
          "id": "ren-queue-server",
          "port": 7654,
          "probe": { "type": "http", "path": "/health" },
          "manager": "launchd",
          "launchd_label": "com.ren-queue.server",
          "depends_on": ["ollama"]
        },
        {
          "id": "heartbeat",
          "probe": { "type": "process", "name": "heartbeat" },
          "manager": "launchd",
          "launchd_label": "com.existential.heartbeat",
          "depends_on": []
        }
      ],
      "models": [
        { "name": "gemma4:e2b", "runtime": "ollama", "keep_alive": -1 },
        { "name": "gemma4:e4b", "runtime": "ollama", "keep_alive": -1 }
      ],
      "repos": [
        { "id": "existential", "path": "~/code/existential" },
        { "id": "ren-queue", "path": "~/code/ren-queue" }
      ]
    }
    // ... ren2, ren3 ...
  }
}
```

Each machine receives only the subset of config relevant to it (its own entry from `machines`). The control plane resolves "what should machine X be doing?" and pushes just that slice.

### Service Dependency Ordering

Services declare their dependencies via `depends_on`. The agent respects this graph:

- **On startup:** Services start in dependency order. `ollama` starts before `ren-queue-server`.
- **On `service.restart`:** If a dependency restarts, the control plane can issue restart commands for dependents in order. In v1 this is manual (operator dispatches restart commands). Automated cascading restart is a v2 feature.
- **On health check failure:** If a dependency becomes unhealthy, dependent services are marked as `degraded` in health reports but not automatically restarted.

```jsonc
// Dependency graph for ren1:
// ollama → ren-queue-server → heartbeat
// (heartbeat depends on queue-server depends on ollama)
```

The agent refuses to start a service before its dependencies are at least `accepting_connections` health tier.

---

## Model Swap Drain Mode

Before unloading a model with active inference, the agent performs a graceful drain:

1. **Agent receives `model.swap` with `drain: true`**
2. Agent signals the runtime to stop accepting new requests for the model being unloaded:
   - Ollama: no explicit drain API. Agent checks `GET /api/ps` for active requests.
   - MLX: the start-mlx-server script manages lifecycle; agent can stop the server after inflight requests complete.
3. Agent waits for in-flight requests to complete, polling every 1 second, up to `timeout_ms` (default 30s)
4. If timeout: force unload (active requests will fail). Log the forced unload in the command result.
5. Unload the old model
6. Load the new model
7. Wait for the new model to reach `serving_requests` health tier
8. Report `command_result` with swap timing and whether drain was clean or forced

If `drain: false`, skip steps 2-4 and unload immediately. Faster but may drop active requests.

---

## Deployment

### Primary: Cloudflare Tunnel (recommended)

The control plane runs on your hardware (no cloud hosting cost) but is reachable from anywhere via Cloudflare Tunnel.

```bash
# On ren1 (always-on machine)
docker compose up -d seed-control-plane

# cloudflared tunnel routes control.phytertek.com → localhost:4310
# Already using Cloudflare for DNS — this is a natural fit
```

Benefits:
- Free TLS termination
- DDoS protection
- No open ports on the control plane machine
- Stable hostname (`control.phytertek.com`) survives infrastructure changes
- Fleet machines connect to the stable hostname, not an IP

The control plane URL must be a stable hostname. Agents store this hostname, not an IP. If the control plane migrates to new infrastructure, update the DNS record and agents reconnect without config changes.

**Cloudflare caveats:**
- Free plan: 100MB WebSocket message size limit (not a concern for our payloads)
- Idle WebSocket connections terminated after ~100s — the 30s ping/pong keepalive handles this
- If `cloudflared` restarts, all connections drop. Agents reconnect via backoff.
- Cloudflare terminates TLS at the edge and re-encrypts to origin. Command payloads are visible to Cloudflare. For a small private fleet this is acceptable. For sensitive environments, use the direct LAN model.

### Fallback: Direct LAN

```bash
# On ren1
docker compose up -d seed-control-plane
# Agents connect to wss://ren1.local:4310 (self-signed TLS cert)
```

No external dependency. Requires all machines on the same network. Self-signed cert for TLS (agent trusts the cert via a pinned hash in its config).

### Docker Image

```dockerfile
FROM oven/bun:1-slim
WORKDIR /app
COPY packages/fleet/control/ .
RUN bun install --production
EXPOSE 4310
VOLUME /data
CMD ["bun", "run", "src/server.ts"]
```

Config and SQLite database stored in `/data/`. Persistent volume survives container restarts.

### Control Plane Upgrade Procedure

Control plane upgrades cause a maintenance window. This is accepted for v1.

1. `docker pull` the new image
2. `docker stop seed-control-plane`
3. All agent WebSocket connections drop. Agents begin jittered exponential backoff.
4. `docker start seed-control-plane` (new image)
5. Agents reconnect (typically within 1-60s depending on backoff state)
6. On reconnect, agents send `announce` with `config_version`. Control plane pushes config if versions differ.

**Expected downtime:** 5-30 seconds for a routine upgrade. Longer if SQLite schema migration is needed.

**During downtime:** Fleet machines continue running on last-known config. All services remain operational. Only management visibility and command dispatch are interrupted. No running workloads are affected.

**Agent upgrades:** The `agent.update` command triggers the agent to download a new version, replace itself, and restart. Services managed via launchd/systemd continue running independently — the agent process lifecycle is decoupled from managed service lifecycles.

---

## Machine Onboarding

### First time

1. Install Seed on the machine: `git clone` or `curl` the install script
2. Configure the agent:
   ```bash
   seed agent configure --url wss://control.phytertek.com
   ```
   This writes `~/.config/seed-fleet/agent.json` with the control plane URL and a self-generated machine ID (defaults to hostname).
3. Start the agent: `seed agent start` (installs a launchd/systemd service)
4. Agent connects to the control plane. Control plane sees an unknown machine ID → sets status to `pending`.
5. Operator sees the pending machine in `seed fleet status` and runs `seed fleet approve <machine_id>`.
6. Control plane generates a token, sends it to the agent over WSS, stores the hash.
7. Agent persists the token. From now on, authenticates with it on every reconnect.
8. Control plane pushes the machine's config slice. Agent applies it and begins health reporting.

### Reconnection

- Agent stores control plane URL and token in `~/.config/seed-fleet/agent.json`
- On reboot, agent starts via launchd/systemd, reconnects automatically
- Control plane validates the token hash, recognizes the machine, pushes config if version differs

### Removal

- `seed fleet revoke <machine_id>` on the user CLI
- Control plane deletes the token hash, drops the active WebSocket connection
- Agent can't reconnect (auth fails)
- To clean up the agent on the machine: SSH in, `seed agent uninstall` (removes launchd/systemd service and config files)

---

## What This Replaces

| Current Mechanism | Replaced By | Notes |
|---|---|---|
| Git sync for infrastructure | Control plane config push | Identity files (existential) keep git sync |
| SSH-based fleet probing | Agent health reports via WebSocket | SSH still available as break-glass |
| mDNS queue discovery | Control plane service registry | Agents report what's running, consumers query the API |
| `fleet-machines.json` | Control plane config store (SQLite) | Static JSON → dynamic, centralized |
| `fleet-services.json` | Control plane service registry | Derived from config + health reports |
| `fleet-context.sh` | Agent self-identification (announce) | Agent knows who it is and reports to control plane |
| `model-watchdog.sh` | Control plane drift detection | "Machine X should have model Y loaded but doesn't" |

## What This Does NOT Replace

- **Existential repo** — identity files, journal, notes. This genuinely needs bidirectional git sync (heartbeat writes, Ryan writes). The control plane can manage a `repo.pull` command for it, but the actual merge logic stays in git-sync.
- **The inference queue** — ren-queue is a job queue with a different SLA (every request must be served). The control plane manages the *lifecycle* of the queue server (start/stop/restart) but does not own queue operation. Queue workers discover the queue server via the control plane instead of mDNS.
- **The fleet router** — ren-jury's rule-router handles inference routing. The router can query the control plane for "what models are currently available?" instead of maintaining a hardcoded fleet manifest.

---

## Open Items — Explicitly Deferred

These items are acknowledged, scoped out of v1, and documented for future phases.

### Multi-user / RBAC

Seed is currently single-user. If multiple users share a fleet, the operator token model needs scoped permissions (read-only operator, full admin). The token model is extensible for this — add a `permissions` array to operator tokens and enforce it in the REST API middleware. **Deferred to v2.** Single operator is sufficient for the target fleet size.

### Automated Cascading Restarts

When a dependency service restarts or fails, automatically restarting dependent services in order. v1 surfaces the dependency graph and drift detection; the operator dispatches restart commands manually. **Deferred to v2.** Automated remediation requires more operational confidence in the system.

### Dashboard

Web UI for fleet overview, real-time WebSocket updates, config editor. **Deferred to Phase 5.** CLI is sufficient for a 3-machine fleet.

### Log Aggregation

Streaming logs from fleet machines through the control plane. This requires careful flow control and multiplexing. **Deferred to Phase 3+.** SSH + local break-glass endpoint cover the debugging use case.

### High Availability

Running two control plane instances with shared state for zero-downtime failover. **Not needed at this scale.** The 5-30 second maintenance window during upgrades is acceptable. Agents are designed to operate without the control plane indefinitely. If/when this matters, the path is: shared SQLite via Litestream replication to S3, DNS-level failover between two instances.

### Split-Brain Config Conflict

Network partition where a machine operates on stale config while the control plane pushes new config to reachable machines. **Mitigated by design:** agents never act on config they haven't acknowledged. On reconnect, the control plane pushes current config and the agent acknowledges. There is no "merge" — the control plane's config wins. For a fleet of 3-20 machines on a LAN with Cloudflare Tunnel, persistent network partitions are unlikely. If they occur, the agent continues on cached config (safe) and catches up on reconnect.

---

## Implementation Phases

### Phase 1: Minimal control plane + agent (BUILD NOW)

- WebSocket server with announce/health/ping-pong protocol
- Agent daemon with jittered exponential backoff reconnect
- Machine registry with pending/accepted/revoked lifecycle
- Per-machine token auth
- SQLite database (machines, config, audit_log tables)
- `seed fleet status`, `seed fleet approve`, `seed fleet revoke` CLI commands
- Health reporting with tiered probes (Ollama, MLX, queue, generic TCP)
- Break-glass local endpoint on `localhost:4311`
- Audit log for all events
- Docker image for the control plane
- Config caching to `~/.config/seed-fleet/config.json` for offline resilience

### Phase 2: Config push + command dispatch

- Config update protocol with version counters and acknowledgment
- Full action whitelist implementation (service, model, config, repo, agent actions)
- Model swap with drain mode
- Service dependency ordering
- `seed fleet config`, `seed fleet command` CLI commands
- Drift detection (desired vs actual state)

### Phase 3: Service discovery integration

- Queue workers discover queue server via control plane API
- Router queries control plane for available models and their health
- Health-based routing (unhealthy machine → skip)

### Phase 4: Deployment automation

- `seed fleet deploy <machine>` — install agent on a new machine
- `seed fleet update` — push new agent version to all machines
- Automated agent self-update flow

### Phase 5: Dashboard

- Web UI for fleet overview
- Real-time WebSocket updates
- Config editor
- Audit log viewer
