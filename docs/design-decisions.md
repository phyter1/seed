# Control Plane — Design Decisions

**Date:** 2026-04-04
**Context:** Decisions made during interactive session with Ryan, informed by adversarial review and Salt research.

---

## Resolved Decisions

### 1. Control plane runs on a dedicated always-on machine, not the user's machine

The control plane runs on a machine that's always on (ren1 in our case). The user's machine (ryan-air) is a *client* — it can observe, configure, and override, but it doesn't run services and doesn't need to be online.

Fleet machines connect outbound to the control plane. The user's CLI connects to the same endpoint.

### 2. Agents connect outbound via WebSocket

Fleet machines maintain persistent WebSocket connections to the control plane. The control plane never reaches into fleet machines. This means:
- No SSH key distribution needed for fleet ops
- No port forwarding or firewall rules on fleet machines
- Works across NATs, VPNs, cloud boundaries
- Cloudflare Tunnels can front the control plane (Cloudflare supports WebSocket proxying)

### 3. Queue stays separate from the control plane

Different SLAs. The queue must serve every inference request (high uptime). The control plane is for changing state (can tolerate brief downtime). Coupling them means a control plane restart drops the queue.

The control plane provides *service discovery* for the queue (where is it?) but does not own queue operation.

This aligns with the fleet coordination foundation doc's explicit decision: "ren-queue stays the work queue."

### 4. Canonical config lives on the control plane, not in git

The control plane's config store is the single source of truth for fleet state. No git dependency for runtime config.

**However:** The control plane should support config export for backup and version history. The config store uses SQLite (not JSON files) for atomicity, concurrent access, and schema migration.

### 5. Git is kept only for identity/memory persistence

Each fleet gets a git repo for shared state that needs history — identity files, journal entries, notes. This is the existential repo pattern. Git is good at this: bidirectional sync, merge conflict resolution, version history.

Git is NOT used for:
- Infrastructure distribution (control plane pushes config)
- Skill distribution (control plane pushes or agent pulls)
- Service management (control plane dispatches commands)
- Fleet topology (control plane config store)

### 6. Minimize agentic usage — script everything

The "agent" on each fleet machine is a lightweight daemon, not an AI agent. It runs scripts, reports health, executes whitelisted commands. No LLM calls for fleet management operations.

AI agent usage (Claude Code, heartbeat) is a *workload* the fleet runs, not a fleet management mechanism. Budget concern: every LLM call costs money. Fleet management should be $0.

### 7. Cloudflare Tunnels as the deployment model

The control plane runs on your hardware (no cloud hosting cost) but is reachable from anywhere via Cloudflare Tunnel. Fleet machines connect to a stable hostname (e.g., `control.phytertek.com`).

Benefits:
- Free TLS termination
- DDoS protection
- No open ports on the control plane machine
- Stable hostname survives infrastructure changes
- Already using Cloudflare for DNS

### 8. The control plane should be containerized

Docker image so it can run anywhere — on a fleet machine, on a VPS, on EC2. The agent daemon runs natively (it needs access to local services like Ollama, launchd, etc.).

---

## Resolved from Adversarial Review

### 9. Per-machine auth tokens, not shared

Each machine gets a unique token at registration time. Revoking one machine doesn't affect others. User CLI uses a separate token class with broader permissions.

Tokens come from environment variables or a secrets file, never from the config schema.

### 10. WSS (TLS) unconditionally

No plaintext WebSocket, even on a "trusted LAN." The Cloudflare Tunnel provides TLS for free. Direct connections must also use TLS.

### 11. SQLite for config storage, not JSON files

JSON files are not atomic to write (partial writes on crash = corruption). SQLite with WAL mode handles concurrent writes, partial writes, and schema migration. Config changelog table records every mutation.

### 12. Explicit command whitelist — no arbitrary script execution

Commands are `namespace.action` pairs dispatched to handler functions. No shell execution of arbitrary strings. Each action type has defined fields, types, and valid ranges.

See `docs/security-command-model.md` for the full command envelope spec.

### 13. Machine registration requires explicit approval

New machine IDs go to a pending state. The operator must `seed fleet approve <machine>` before the machine receives commands. Known machine IDs authenticate with their pre-assigned token.

### 14. Audit log from v1

Every command dispatched, every config change, every machine join/leave. Written to SQLite. Non-negotiable for post-incident analysis.

### 15. Queue stays separate (reinforced)

The adversarial review independently confirmed this: "Do not couple them. The control plane's uptime requirement is 'best effort.' The queue's uptime requirement is 'every inference request must be served.' These are different SLAs."

### 16. Observatory folds into the control plane

The Agent Observatory (`agent-observatory` repo, 26 epics, 112+ commits) is absorbed into Seed's control plane. They're the same concern: "what's happening across my fleet." Running two separate systems with overlapping telemetry data is the scattered infrastructure Seed exists to consolidate.

The control plane becomes the unified monitoring + management layer for:
- **Fleet infrastructure** — machine health, model status, service state (already built)
- **CLI agent sessions** — Claude Code, Codex, Gemini activity and costs (from Observatory)
- **Inference traffic** — local model requests via router, cloud API calls via queue workers (new)

The existing Observatory proxies on fleet machines become part of the machine agent — the agent already runs on every machine and reports health. Adding hook forwarding and OTLP relay is natural.

**What gets harvested from Observatory:**
- OTLP ingestion endpoints and normalizer pipeline
- Hook receiver with Claude/Codex/Gemini parsers
- Session tracking and health scoring
- Cost aggregation and anomaly detection
- WebSocket event broadcasting pattern
- Dashboard (Next.js) — may stay as a separate frontend package or become the control plane's UI

**What changes:**
- `AgentCli` type expands — inference sources (router, queue workers, cloud APIs) become first-class alongside CLI agents
- The "session" abstraction splits: CLI sessions are ephemeral (start/end), inference servers are long-running with individual requests inside them
- The router emits OTLP telemetry for every request it handles (model, machine, tokens, latency)
- Queue workers emit OTLP telemetry for every job (provider, model, tokens, cost, latency)
- The control plane's existing machine health pipeline and Observatory's event pipeline merge into one event bus

**What stays separate:**
- The inference queue (different SLA, per decision #15)
- The fleet router (inference routing ≠ fleet management)

**Migration path:** Harvest Observatory's core modules into `packages/fleet/control/`, extend the existing server. The observatory repo gets archived once the control plane owns the concern.

---

## Open — Needs More Design

### A. Service dependency ordering

When restarting a service, what about its dependents? When a machine boots, what order do services start? The adversarial review suggests a dependency graph in the service config. Needs spec.

### B. Health check tiering

"Running" (process alive) ≠ "healthy" (serving requests). Need tiered health: `process_alive` → `accepting_connections` → `serving_requests` → `within_sla`. Need hysteresis to prevent flapping restarts.

### C. Model swap drain mode

Before unloading a model with active inference, drain in-flight requests. The agent signals stop-accepting, waits for completion (with timeout), then swaps. Needs protocol spec.

### D. Config versioning and acknowledgment

Config updates need a version counter. Agents acknowledge receipt. The control plane tracks last-acknowledged version per machine. On reconnect, agent sends its version; control plane diffs and pushes only changes.

### E. Control plane upgrade procedure

Control plane upgrades cause a maintenance window. Agents keep running on last-known config. Need to document the expected downtime and agent behavior during it.

### F. Break-glass debugging

When a machine's WebSocket is down, you can't debug via the control plane. The agent should expose a local HTTP endpoint (`/health`, `/status`, `/logs`) for out-of-band diagnostics. SSH remains the break-glass path.

### G. Scaling ceiling

This design targets 3-20 machines. At 100+ machines, the WebSocket server, health aggregation, and config fan-out need rethinking. Document the ceiling explicitly.
