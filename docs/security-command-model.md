# Security & Command Model

**Date:** 2026-04-04
**Sources:** Salt architecture research, Claude Code permission system (`ren3:~/code/ccsour/`), adversarial review findings

---

## Principles

1. **Never template-render untrusted data.** Salt's original sin (CVE-2020-11651, CVE-2020-16846) was Jinja-rendering data from minions. Our commands are structured data dispatch — no string interpolation of remote input.

2. **Structured whitelist, not arbitrary execution.** Commands are `namespace.action` pairs mapped to handler functions. No `eval`, no `shell=True`, no arbitrary script paths.

3. **Per-machine identity, not shared secrets.** Each machine has a unique token. Compromising one machine doesn't compromise the fleet.

4. **Fail-open for config, fail-closed for commands.** If the control plane is down, agents keep running on cached config (fail-open). But agents never execute commands they can't validate (fail-closed).

5. **Audit everything.** Every command, every config change, every auth event → SQLite log.

---

## Authentication Model

### Machine Tokens

```
Control plane generates:
  machine_id: "ren1"
  token: <unique random 256-bit token>
  role: "agent"
  permissions: ["health.report", "command.acknowledge", "config.receive"]
```

- Generated at machine registration time
- Stored on the machine in `~/.config/seed-fleet/agent.json` (mode 600)
- Sent in WebSocket upgrade request: `Authorization: Bearer <token>`
- Control plane validates token against its machine registry
- **Revoking** a machine = delete its token from the registry. The machine can't reconnect.

### User Tokens

```
  token: <unique random 256-bit token>
  role: "operator"
  permissions: ["fleet.read", "fleet.write", "command.dispatch", "config.update"]
```

- Separate from machine tokens — different trust domain
- Used by CLI and dashboard
- Can be scoped (read-only operator, full admin) in v2

### Token Storage

- Tokens are NEVER in `seed.config.json` or any config file
- Tokens come from environment variables or `~/.config/seed-fleet/agent.json`
- The config schema has no `auth_token` field
- If config is ever exported to git, no secrets travel with it

---

## Command Envelope

Every command from the control plane to an agent follows this structure:

```jsonc
{
  "command_id": "550e8400-e29b-41d4-a716-446655440000",  // UUID, for correlation
  "timestamp": "2026-04-04T12:00:00Z",
  "target": "ren1",                    // must match the agent's own machine_id
  "action": "service.restart",         // namespace.action from whitelist
  "params": {                          // action-specific, validated per schema
    "service_id": "ollama"
  },
  "timeout_ms": 30000,                 // agent enforces this
  "issued_by": "operator:ryan"         // audit trail
}
```

### Action Whitelist

The agent has a hardcoded registry of valid actions. Anything not in the registry is rejected.

| Action | Params | What it does |
|--------|--------|-------------|
| `service.start` | `{ service_id: string }` | Start a known service via launchd/systemd |
| `service.stop` | `{ service_id: string }` | Stop a known service |
| `service.restart` | `{ service_id: string }` | Stop then start |
| `service.status` | `{ service_id: string }` | Return service status |
| `model.load` | `{ model_name: string, runtime: "ollama" \| "mlx" }` | Load a model |
| `model.unload` | `{ model_name: string, runtime: "ollama" \| "mlx" }` | Unload a model |
| `model.swap` | `{ unload: string, load: string, runtime: string, drain: bool }` | Swap with optional drain |
| `model.list` | `{}` | List loaded models |
| `config.apply` | `{ config: object, version: number }` | Apply a config update |
| `config.report` | `{}` | Report current config + version |
| `health.report` | `{}` | Trigger an immediate health report |
| `repo.pull` | `{ repo_id: string }` | Git pull a known repo (from registry, not arbitrary URL) |
| `agent.update` | `{ version: string }` | Self-update the agent binary |
| `agent.restart` | `{}` | Restart the agent process |

### Validation Rules

**`service_id`** must match a service in the agent's known service registry. The registry is defined in the agent's config (received from the control plane). Unknown service IDs are rejected.

**`model_name`** must match a model in the agent's config. Arbitrary model names are rejected (prevents pulling unknown models from Ollama Hub).

**`repo_id`** must match a repo in the agent's config. Arbitrary URLs are rejected (prevents pulling adversary repos).

**`config`** objects are validated against a JSON schema before application. Malformed config is rejected.

**No `run_script` action.** This was explicitly removed. If a new capability is needed, add a specific action type with defined params. Never execute arbitrary paths or shell strings.

---

## Patterns Stolen From Salt

| Salt Pattern | Our Adaptation |
|---|---|
| **Three-directory key lifecycle** (`minions_pre/`, `minions/`, `minions_rejected/`) | Machine registry in SQLite with status: `pending`, `accepted`, `revoked` |
| **Grains** (machine self-reports facts up) | Agent health report includes: hostname, arch, CPU, memory, disk, loaded models, running services |
| **Pillars** (master pushes config down, scoped per-machine) | Control plane pushes config slice per-machine. Each machine only receives its own config. |
| **Module.function command interface** | `namespace.action` handler registry on the agent |
| **JID correlation** | `command_id` (UUID) travels with command and response |
| **AES rotation on minion removal** | Token revocation on machine removal. Agent can't reconnect. |
| **Randomized reconnect backoff** | Jittered exponential backoff on WebSocket reconnect (prevents thundering herd) |

### Patterns Explicitly Avoided From Salt

| Salt Anti-Pattern | Why | Our Rule |
|---|---|---|
| Jinja template rendering of minion data | CVE-2020-11651, CVE-2020-16846 — RCE | Structured data only, no string interpolation |
| Shared AES session key | One compromised minion decrypts all | Per-machine tokens |
| `auto_accept: True` | Bypasses security model | Explicit approval required |
| `cmd.run` as a universal escape hatch | Arbitrary shell execution | No `run_script` action |
| 7+ module taxonomies | Complexity cliff | One type: "things agents can do" |

---

## Patterns Stolen From Claude Code

Reference: `ren3:~/code/ccsour/src/`

| Claude Code Pattern | Our Adaptation |
|---|---|
| **Permission rules** (`toolName(ruleContent)`) | Command actions with structured params — not strings to parse |
| **Sandbox adapter** (filesystem/network restrictions) | Agent validates all params against its config before execution |
| **Policy limits** (fetch from API, cache locally, poll hourly, fail-open) | Agent fetches config from control plane, caches to `~/.config/seed-fleet/config.json`, operates from cache if disconnected |
| **Denial tracking** (rate-limit repeated denials) | Agent tracks failed command attempts, alerts on anomalies |
| **Managed settings** (org pushes restrictions, client enforces) | Control plane pushes config, agent enforces locally |

### The Policy Limits Pattern in Detail

Claude Code's `policyLimits` service is exactly what our agent config fetching should look like:

1. On startup, load cached config from disk (if exists)
2. Fetch latest config from control plane
3. If fetch succeeds: apply, cache to disk
4. If fetch fails: continue with cached config (fail-open)
5. Background poll every N minutes for changes
6. ETag-based caching to minimize bandwidth

This means the agent works offline, handles control plane restarts gracefully, and catches up automatically when connectivity returns.

---

## Audit Log Schema

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,          -- 'command', 'config_change', 'machine_join', 'machine_revoke', 'auth_failure'
  machine_id TEXT,                    -- target machine (null for fleet-wide events)
  issued_by TEXT,                     -- 'operator:ryan', 'system:config_poll', etc.
  action TEXT,                        -- 'service.restart', 'model.swap', etc.
  params TEXT,                        -- JSON params
  result TEXT,                        -- 'success', 'failure', 'timeout', 'rejected'
  details TEXT,                       -- error message or result payload (JSON)
  command_id TEXT                     -- correlation ID
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_machine ON audit_log(machine_id);
CREATE INDEX idx_audit_command ON audit_log(command_id);
```

Every command dispatched, every config mutation, every auth event. This is the forensic trail for "what happened at 3 AM when the heartbeat stopped."
