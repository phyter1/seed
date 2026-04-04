# Adversarial Review: Seed Control Plane Architecture

**Date:** 2026-04-04
**Reviewer:** Adversarial architecture review
**Document under review:** `docs/control-plane-architecture.md`
**Context doc:** `existential/analysis/fleet-coordination-foundation-2026-04-01.md`

---

## Verdict Up Front

This is a reasonable first sketch of a control plane for a small, trusted fleet. It will work for three Macs on a LAN. It will not scale to anything else without significant rework, and several of its design choices will create painful migration costs if the system ever grows. More critically, the security model is dangerously thin for a system that can execute arbitrary commands on every machine in the fleet.

The good news: the topology choice (agents connect outbound) is correct and worth keeping. The bad news: nearly everything built on top of that topology needs harder thinking before a line of code is written.

---

## 1. Single Point of Failure

### The Entire Fleet Has One Brain

The architecture document explicitly describes "a single process (Docker container)" as the control plane (section: Components). This is the architectural original sin. The control plane is the single point of failure for:

- Fleet visibility (is any machine even running?)
- Command dispatch (can you restart a broken service?)
- Config propagation (do machines know what they're supposed to be doing?)
- Service discovery (where is the queue server? where is the inference endpoint?)

Open question 5 in the doc acknowledges offline resilience: "fleet machines should keep running with last-known config." That's the right instinct, but it's buried in open questions, not in the design. The architecture as written does not specify how the agent stores its last-known config, how often it revalidates against the control plane, or what it does when a config update arrives while it was disconnected. "Keep running" is not the same as "operate correctly."

**Blast radius:** Control plane goes down for an hour. What happens?
- All WebSocket connections drop.
- Agents reconnect with exponential backoff. If backoff isn't capped, this takes minutes per agent. If it's capped too low, agents hammer the reconnect endpoint the moment the plane comes back.
- Config changes queued during downtime: where do they go? The design has no persistent command queue. Any `seed fleet exec` or config push issued during downtime is silently lost.
- Service discovery fails. Queue workers can't find the queue server. The router can't find available models. The fleet is flying blind.
- After one day: agents are still running on last-known config. That's survivable for stateless services. For services that depend on config (heartbeat schedule, model assignments, routing policy), you're now running stale truth everywhere and you don't know it.

**Fix:** Design for control plane absence from day one, not as a later concern. The agent must:
1. Persist a versioned copy of its last-known config to disk on every successful config receipt.
2. Operate from that config on reconnect until the control plane confirms no changes.
3. Expose a local `/health` endpoint so other tools (and humans) can query the machine's state even when the control plane is down.

The control plane itself should be documented with a HA path, even if v1 doesn't implement it. If you ever run this on a VPS (Option B), you want to know what happens when that VPS goes down for a kernel update. Ignoring this is a debt that compounds.

---

## 2. Split-Brain Scenarios

The document does not mention split-brain at all. This is a gap even for a three-machine fleet.

Scenario: Network partition. Ren1 (running the control plane) can reach Ren2 but not Ren3. Ren3 has a valid WebSocket connection to the control plane from before the partition. The connection drops. Ren3 goes offline from the control plane's perspective.

Now what?
- The control plane marks Ren3 as absent ("machine X hasn't reported in 5 minutes").
- Does it try to rebalance work? Does it move model assignments?
- If it does, and Ren3 comes back, you have two machines with the same model assignment claiming to be authoritative.
- The agent on Ren3 reconnects, gets a new config, and potentially unloads a model that's actively serving inference requests.

The architecture has no concept of "pending state" vs "applied state," no version vector for config, and no conflict resolution for agents that diverged during a partition. For a small trusted fleet, this is unlikely but not impossible — a flaky switch, a bad WiFi handoff, a VPN hiccup. For any fleet that spans networks, it's a matter of when, not if.

**Fix:** The config update protocol needs a version counter. The control plane tracks the last acknowledged config version per machine. Agents acknowledge config receipt explicitly. The control plane never assumes a config push was applied — it waits for acknowledgment or retries. On reconnect, the agent sends its current config version; the control plane diffs and pushes only what changed.

---

## 3. Protocol Choice: WebSocket vs. Everything Else

The document chooses WebSocket without justification. Let's examine that choice.

### What WebSocket buys you

- Persistent bidirectional connection — agents can receive commands without polling.
- Low overhead for frequent health reports (no HTTP headers per message).
- Widely supported, easy to implement.

### What WebSocket costs you

**State management complexity.** Every persistent connection is state. The server must track which connections are alive, handle reconnects gracefully, correlate reconnections with machine identity, and clean up dead connections without leaking memory. This is not trivial to implement correctly. The architecture does not mention any of this.

**Load balancing is broken.** If the control plane is ever horizontally scaled (Option B on a VPS, or later HA deployment), WebSocket connections are sticky. You cannot put a standard load balancer in front of the WebSocket server without sticky sessions. This means you either give up horizontal scaling or add a Redis/shared-state layer to coordinate across instances. The architecture says nothing about this.

**Proxy and firewall traversal.** Cloudflare Tunnels are mentioned as planned. Cloudflare's free tier has a 100MB WebSocket message size limit and will terminate idle WebSocket connections after approximately 100 seconds of inactivity (this varies by plan). If health reports are every 30 seconds, you're fine. If agents go quiet for any reason, Cloudflare will kill the connection and the agent has to reconnect. This is recoverable but adds noise. The architecture should explicitly call out that the ping/pong heartbeat must keep connections alive through proxies.

**Debugging is harder.** HTTP polling is trivially inspectable with curl. gRPC has established tooling (grpcurl, grpc-gateway). WebSocket debugging requires dedicated tools or custom logging. For a system where "how do I debug a fleet machine that's not reporting?" is an open concern, WebSocket is the harder choice operationally.

### Alternatives worth considering

**HTTP long-polling (agent polls the control plane):** Simpler to implement, works through any proxy, trivially debuggable. The downside is latency for commands — you wait up to one poll interval for the agent to pick up a command. For a fleet management system where sub-second command latency is not a hard requirement, this is often the right tradeoff. Kubernetes itself used long-polling for years.

**Server-Sent Events (SSE) for push, REST for pull:** SSE is unidirectional (server → client), but agents can use it to receive commands while using plain HTTP POST for health reports. Works through Cloudflare, standard HTTP, trivially inspectable. The tradeoff is that it's not bidirectional by default, so you need two connections (SSE for commands, POST for health). But this is a cleaner separation of concerns than a single WebSocket used for both.

**gRPC with server streaming:** Strong typing via protobuf, bidirectional streaming, excellent tooling, health check protocol built in. Higher implementation complexity, requires HTTP/2, not trivially inspectable. Probably overkill for v1 but worth knowing it exists.

**Recommendation:** For v1 (three Macs, trusted LAN), WebSocket is fine. But the architecture should document the Cloudflare Tunnel caveats, the sticky-session problem, and the long-polling fallback path. Choosing WebSocket without acknowledging these tradeoffs leaves landmines for whoever operates this system.

---

## 4. Security Model

This section is where the document needs the most work. The v1 security model (section: Security Model) is described as "simple, good enough to start." It is simple. It is not good enough.

### Bearer Token Auth: What You're Actually Building

The architecture uses a single shared bearer token for all agents and for the user CLI. This means:

- Every machine in the fleet has the same token.
- The control plane cannot distinguish a command from "the user" vs a command from "a compromised agent acting as a user."
- Revoking access for one machine means rotating the token for all machines.
- There is no way to grant an agent read-only access to health data without also granting it write access to dispatch commands.

This is not "simple, good enough to start." This is a flat permission model where every client is the superuser.

### What a Compromised Agent Can Do

The command dispatch protocol (section: Protocol) sends messages like:

```json
{
  "type": "command",
  "action": "restart_service",
  "service": "ollama"
}
```

The architecture also lists `run_script` as a valid action in the agent's capabilities (section: Machine Agent, "run script"). A compromised agent that can forge messages to the control plane (or that the control plane is tricked into sending commands to) can:

- Restart or stop any service on any machine in the fleet.
- Execute arbitrary scripts (the `run_script` action has no defined scope or sandbox).
- Trigger model swaps that disrupt active inference.
- Inject false health reports to hide a compromise.
- Pull arbitrary git repos (the `pull repo` action is listed in command capabilities).

**This is effectively remote code execution on every fleet machine.**

The architecture does not define any input validation on command payloads. The `service` field in `restart_service` — is it validated against a whitelist of known service IDs? If not, what happens when you send `"service": "../../etc/passwd"` or a service name that maps to a different process? The command executor section says "executes locally with appropriate permissions" without defining what "appropriate permissions" means.

### What a Compromised Control Plane Can Do

This is worse. The control plane can:
- Send arbitrary commands to all agents simultaneously.
- Push config updates that repoint every machine to a different queue server (adversary's server).
- Swap models on every machine.
- Execute scripts on every machine.
- Exfiltrate the health and capability reports of every machine (CPU usage, running processes, model inventory, disk space).

A compromised control plane is full control over the entire fleet with no audit trail and no revocation path. The architecture correctly identifies this as a v2 concern (audit log), but it should be a v1 concern given what the control plane can do.

### Token in Shared Config

The config model shows (section: Config Model):

```json
"auth_token": "..." // set via env var in practice
```

The comment says "in practice," but the config schema has the field. If anyone ever serializes this config to disk — which the architecture says it does ("Config stored in `/data/config.json`") — that token is on disk. Unencrypted. If the config volume is ever backed up, synced to git, or copied, the token goes with it. The architecture says the control plane config "can export/import to a git-tracked file for backup and version history" (open question 7). This would commit the bearer token to git.

### Transport: WS vs WSS

The architecture says "WS (plain) acceptable on trusted LAN." On a LAN where you control all switches and there are no untrusted devices, this is defensible. But "trusted LAN" is a strong assumption. If any machine on the LAN is compromised, WS connections expose all command traffic and health data in plaintext. Given that the commands include arbitrary script execution, plaintext transport is not acceptable even on a LAN.

### Fixes

1. **Per-machine tokens, not a shared token.** The control plane generates a unique token per machine at registration time. Revoking a machine's access does not require rotating every other machine's token.

2. **Separate agent tokens from user tokens.** Agents authenticate with narrow-scoped tokens (can send health reports, receive commands for their own machine). Users authenticate separately with a different token class (can dispatch commands, read all health data, update config). These are different trust domains.

3. **Validate all command payloads against a whitelist.** Define an explicit enum of valid service names. Define which scripts are executable and where they live. Reject anything outside the whitelist at the agent level, not just the control plane level.

4. **Never put tokens in the config schema.** Tokens come from environment variables or a secrets manager, full stop. Remove `auth_token` from the config struct.

5. **Enforce TLS unconditionally.** WSS everywhere. The control plane should refuse plaintext connections. The "trusted LAN" exception is a footgun.

6. **Add an audit log in v1.** Every command dispatched, every config change, every machine join. Write it to disk. Without this, you have no forensic capability when something goes wrong.

---

## 5. Command Injection

The command dispatch protocol is underspecified in ways that will create injection vulnerabilities.

The `run_script` action mentioned in section "Machine Agent" is the highest-risk vector. The architecture does not define:
- What arguments can be passed.
- Whether arguments are shell-interpolated.
- Whether there's a working directory constraint.
- Whether the script runs as the agent's user or a different user.
- Whether there's a timeout enforced at the OS level.

If `run_script` takes a script path and arguments as strings and passes them to a shell, you have shell injection. Even if the control plane validates the path, a path traversal in the argument could escape the intended directory.

The `pull_repo` action raises similar concerns. If the repo URL comes from the control plane, a compromised control plane can point agents at an adversary's repo and execute whatever is in it.

**Fix:** Define the command protocol explicitly and exhaustively before implementation. For each action type, define the exact fields, their types, their valid ranges, and how they are executed. "Run this script" should map to a pre-registered script ID, not an arbitrary path. Arguments should be passed as a structured array, not a shell string.

---

## 6. Machine Registration: What Prevents Unauthorized Joins?

Section "How a Machine Joins the Fleet" describes the join flow:

> Agent connects, announces itself, control plane registers the new machine.

The only gate is the bearer token. If someone has the bearer token — which is shared across the entire fleet — they can connect any machine and it will be registered. The architecture does not describe:

- Whether the control plane validates that a machine ID is expected before registering it.
- Whether an existing machine can be impersonated by a new connection claiming the same machine ID.
- Whether there's a maximum fleet size or any rate limiting on join attempts.

**Machine ID impersonation scenario:** Machine Ren1 is compromised. The attacker registers a second agent on a different machine, claims it is `machine_id: "ren1"`. The control plane now has two connections for Ren1. What happens? The architecture is silent on this. The naive implementation would overwrite the existing Ren1 state with the impersonator's state, which is a takeover.

**Fix:** The join flow should require explicit operator approval for new machine IDs. Known machine IDs (from the fleet config) should authenticate with their pre-assigned token. New machine IDs should go into a pending state, visible in `seed fleet status`, and require explicit `seed fleet approve <machine>` before they receive commands. This eliminates drive-by registration.

---

## 7. Config Storage: JSON on Disk

The architecture proposes "JSON on disk (or SQLite for queryability)" for the config store. Several problems:

**Corruption.** JSON is not atomic to write. If the process dies mid-write (OOM, SIGKILL, power loss), you have a partially written JSON file. The next read will fail to parse it. The architecture has no recovery path for corrupted config. If your config is corrupted and your control plane refuses to start without valid config, you have a hard outage.

**Concurrent writes.** If two users or two processes write to the config simultaneously (unlikely in v1, becomes more likely as the CLI gains features), you have a race condition. JSON files have no built-in concurrency control.

**Schema migration.** The config shows a `"version": 2` field, which implies version 1 existed. The architecture does not describe what happens when the control plane starts and finds a config at version 1. Does it auto-migrate? Does it refuse to start? Does it silently corrupt data?

**No history.** The architecture mentions exporting to git for backup, but the control plane itself has no history. If you push a bad config — wrong model assignment, broken service list — you can't see what the previous config was or diff the change that broke things.

**The foundation doc is smarter here.** `fleet-coordination-foundation-2026-04-01.md` explicitly separates static fleet truth (in git, version-controlled) from dynamic runtime truth (not in git). The control plane architecture partially undermines this by making the control plane config the "single source of truth" for both static fleet identity (machine roles, service expectations) and dynamic runtime config (current heartbeat schedule, current model assignments). This collapses the separation that the foundation doc carefully established.

**Fix:** Use SQLite unconditionally. It handles concurrent writes, partial writes, and schema migration far better than JSON. Use WAL mode for better concurrency. For schema migration, use a migrations table with versioned SQL scripts. For history, write a config changelog table that records every mutation with a timestamp and author. This is a week of work upfront that prevents months of production pain.

---

## 8. Service Dependency Ordering

The architecture defines expected services per machine:

```json
"services": {
  "expected": ["ollama", "ren-queue-server", "heartbeat", "fleet-agent"]
}
```

But it does not define dependencies between services. The queue server (`ren-queue-server`) requires Ollama to be running before it can route inference jobs. The heartbeat requires the queue server. The fleet agent requires the control plane.

If the control plane sends a `restart_service: "ollama"` command and Ollama restarts, what happens to the queue server that depends on it? Does it detect the restart and reconnect? Does it die silently? Does the control plane know to restart dependent services in order?

More specifically: when a machine reboots, the control plane will start pushing commands as soon as the agent reconnects. If the agent connects before all local services are ready, it might receive commands that fail because their dependencies aren't up yet. The `timeout_ms` field in commands helps here, but silent failures without dependency context make debugging harder.

**Fix:** Add a dependency graph to the service config:

```json
"services": {
  "expected": ["ollama", "ren-queue-server", "heartbeat"],
  "dependencies": {
    "ren-queue-server": ["ollama"],
    "heartbeat": ["ren-queue-server"]
  }
}
```

The control plane uses this graph for ordered startup and determines which services to restart when a dependency changes state. The agent also respects this graph locally, refusing to start a service before its dependencies are healthy.

---

## 9. Health Check Design: What Is "Healthy"?

The health report protocol includes:

```json
{ "id": "ollama", "status": "running", "port": 11434 }
```

"Running" here means the process exists. It does not mean:
- The service is accepting connections.
- The service is responding to requests.
- The service is responding within an acceptable latency.
- A loaded model is actually responding to inference requests, not just loaded.

A service can be "running" (process alive) and completely broken (deadlocked, out of memory, serving 503s). The architecture's health model will report this as healthy. The drift detector ("machine X should be running service Y but isn't") will see no problem.

**Flapping.** If a service oscillates between healthy and unhealthy rapidly, the control plane's last-seen health report will flip between states. With a 30-second health report interval, the control plane might see alternating healthy/unhealthy states across reports. Does it immediately restart the service on the first unhealthy report? Does it wait for N consecutive unhealthy reports? The architecture does not say. Naive implementations that restart on first failure will thrash flapping services.

**Who defines the health probes?** The architecture says the agent "probes local services." What does that mean for Ollama? An HTTP GET to `/api/tags`? A model inference request? For the queue server? For the MLX server? Different services need different health semantics. The architecture doesn't specify how health probe definitions are configured, who can add new probes, or how the agent knows what probe to run for a service it has never seen before.

**Fix:**
1. Define health as a tiered concept: `process_alive`, `accepting_connections`, `serving_requests`, `within_sla`. The health report should include which tier the service is at.
2. Health probes should be configured in the service catalog, not hardcoded in the agent. Each service entry specifies its probe type (TCP connect, HTTP GET with expected status, custom script), probe endpoint, timeout, and failure thresholds.
3. Implement hysteresis: a service is marked unhealthy only after N consecutive failures. It is marked healthy only after M consecutive successes. This eliminates flapping restarts.

---

## 10. Model Management During Active Inference

The `swap_model` command:

```json
{
  "type": "swap_model",
  "unload": "gemma4:e2b",
  "load": "gemma4:e4b",
  "runtime": "ollama"
}
```

The architecture does not address what happens when a model swap is issued while the model being unloaded is serving an active inference request. Ollama will return an error or hang, depending on implementation. The agent will report failure, but there is no retry policy, no graceful drain, and no mechanism to queue the swap until the model is idle.

For a system that manages inference models, model swaps with active requests are a routine operational event, not an edge case. The CLAUDE.md for the existential repo describes this concern explicitly for the 16GB M1 constraint: "Only one model loaded at a time on ren3." Getting the swap sequencing wrong means dropped inference requests.

**Fix:** The swap command needs a drain mode. Before unloading, the agent signals the service to stop accepting new requests and waits for in-flight requests to complete (up to a configurable timeout). After drain, unload, load, and signal ready. The control plane tracks swap state and does not route new inference to the machine until the agent confirms the new model is loaded and responsive.

---

## 11. Coupling the Queue to the Control Plane

Section "Open Questions" asks: "Should the control plane own the inference queue too?" The document leans toward "no, keep them separate."

That is the right answer. Do not couple them. Here is why, more forcefully than the document states:

The control plane's uptime requirement is "best effort — the fleet keeps running without it." The queue's uptime requirement is "every inference request must be served." These are different SLAs on the same binary if you merge them. A control plane restart (routine, during upgrades) would drop the queue. A queue full of long-running inference jobs would block control plane restarts.

The foundation doc (`fleet-coordination-foundation-2026-04-01.md`) is explicit on this: "ren-queue stays the work queue" and lists queue execution as a non-responsibility of the control plane. The architecture doc's open question should be closed: the queue stays separate. The control plane provides service discovery for the queue (where is the queue server?) but does not own queue operation.

---

## 12. Control Plane Upgrade Strategy

The architecture is silent on how to upgrade the control plane itself. This is not a v2 problem. The moment you deploy this thing, you need to upgrade it.

The architecture proposes running the control plane as a Docker container. Upgrading a Docker container means:
1. `docker pull` the new image.
2. `docker stop` the old container.
3. `docker start` the new container.

Between steps 2 and 3, all agent WebSocket connections drop. Every agent begins exponential backoff reconnection. The fleet is unmanageable during this window. For a 30-second downtime, this is tolerable. For an upgrade that requires config migration, it could be minutes.

Zero-downtime upgrade is not trivial for a stateful WebSocket server. You need either:
- Blue-green deployment with DNS-level cutover (requires two instances, works but expensive).
- A connection drainer that gracefully migrates connections to the new instance (complex to implement correctly).
- Accept the downtime and ensure agents are robust during it.

For v1 with three machines on a LAN, accepting downtime is fine. But the architecture should say this explicitly: "control plane upgrades cause a maintenance window of N seconds during which the fleet is unmanageable but continues running on last-known config."

Similarly for agent upgrades: the architecture mentions `seed fleet update` as a phase 4 feature, but does not describe how to upgrade the agent without interrupting the services it manages. If the agent process restarts, do managed services restart too? Is there a supervisord-style process hierarchy or does the agent use launchd/systemd to manage services independently?

---

## 13. Observability Gap

The architecture mentions `seed fleet logs <machine> [service]` as a CLI command but says nothing about how log aggregation works.

Logs are on fleet machines. The control plane is the central hub. Getting logs from machine Ren3 to the user running the CLI means:
- Option A: Agent tails logs and streams them over the WebSocket connection on demand. This is stateful and adds backpressure concerns.
- Option B: Agent exposes a local HTTP endpoint for log streaming; CLI connects directly. This requires the machine to be reachable, breaking the outbound-only topology.
- Option C: Control plane acts as a proxy, forwarding log stream from agent to CLI. This adds load to the control plane and requires multiplexing multiple log streams.

The architecture has not chosen among these options. Each has significant implementation implications. Log streaming over WebSocket (Option A) requires careful flow control — if the CLI is slow to consume, the agent's buffer fills and you either drop logs or block the health report channel.

More critically: when a machine is not reporting ("machine X hasn't reported in 5 minutes"), you want to debug it. But if the machine isn't reporting, the WebSocket connection is down, and Options A and C don't work. The debug path for a dead machine must go outside the control plane — which means you still need SSH, or a local diagnostics endpoint, or out-of-band access. The architecture's framing that "SSH is replaced by the control plane" breaks down precisely when you most need debugging capability.

**Fix:** The agent should expose a local HTTP endpoint (`/debug/logs`, `/debug/health`, `/debug/status`) on localhost or a management network. This is the break-glass path when the control plane connection is down. Document this explicitly. Do not promise that SSH is no longer needed.

---

## 14. Capacity Planning: 3 Machines vs. 100

The architecture targets three Macs but is described as something "anyone can deploy." Let's look at the scaling assumptions.

**WebSocket connections:** At 3 machines, 30-second health reports, each report is small JSON — this is trivially manageable. At 100 machines, you have 100 persistent connections and 3+ health reports per second. At 1000 machines, you have 1000 connections and 33 health reports per second. The health aggregator must process all of these and maintain an in-memory view. The architecture doesn't specify the data structure for this view or the memory overhead per machine record.

**Config push fan-out:** A single config change might need to be broadcast to all machines. At 1000 machines over 1000 WebSocket connections, this is serialization of the same payload 1000 times. If the control plane serializes synchronously, this is a throughput bottleneck.

**The config store:** JSON on disk does not scale to frequent concurrent writes under load. At 3 machines, this is fine. At 100 machines reporting health every 30 seconds, if any health data is written to the config store (rather than held in memory), you have frequent writes contending on one file.

**Verdict:** The architecture is designed for 3-10 machines. It will not survive to 100 without the SQLite fix and an explicit "state held in memory, persisted to SQLite asynchronously" architecture. At 1000 machines, this design requires a complete rewrite around a dedicated time-series database and a message broker. These don't need to be solved now, but the architecture should explicitly state the scaling ceiling: "designed for fleets up to ~20 machines; beyond that, expect rework."

---

## 15. Comparison to Existing Tools

The architecture does not justify why a custom control plane is being built instead of using an existing tool. This is a critical omission.

### What Existing Tools Do

**Ansible:** Push-based, agentless (SSH), excellent for one-shot deployments and configuration management. Poor for continuous fleet monitoring and real-time commands. Requires SSH. Not a good fit for the outbound-only topology requirement.

**Salt (SaltStack):** Has an agent (minion) that connects outbound to the master. Persistent ZeroMQ connections. Built-in command dispatch, config management, health monitoring, event bus. This is basically what Seed is building, except Salt has been in production for 15 years. The Salt master can be made HA. Salt has grains (machine self-reporting metadata) and pillars (per-machine config slices). Salt has peer-reviewed security with mTLS and AES key exchange per minion.

**Nomad (HashiCorp):** Designed for job scheduling across heterogeneous fleets. Has an agent model. Has a well-defined upgrade path. HA control plane. But it's a job scheduler, not a service manager for persistent daemons on fixed machines.

**Puppet:** Push-based, agent-based, mature config management. Poor real-time command dispatch.

**Kubernetes:** Control plane for containerized workloads. Massive operational overhead for three Macs running bare-metal processes.

**Fleet (CoreOS/systemd):** Deprecated, but the concept is relevant — systemd unit management across a cluster.

### The Honest Comparison

Salt is the closest analog to what this architecture is building. Salt has:
- Agent connects outbound to master (same topology).
- Per-minion authentication with AES key exchange.
- Config management (states) pushed to minions.
- Real-time command dispatch (execution modules).
- Health monitoring (beacons).
- Per-machine config slices (pillars).
- A HA master configuration.

The question is whether wrapping Salt is more work than building a custom control plane. For a small fleet of known machines running specific software, a custom control plane is defensible — Salt has significant operational complexity (key management, formula management, pillar encryption) that may exceed the complexity of a simple WebSocket daemon.

But the decision should be explicit: "We evaluated Salt, Ansible, and Nomad. We are building custom because [specific reasons]. We accept the following risks: [list]." Without this, the architecture looks like it's reinventing Salt without knowing Salt exists.

**Recommendation:** Use Salt for operations that are already solved (config management, command dispatch, health monitoring), and build only what Salt doesn't do (inference-specific health probes, model management commands, integration with the Seed config model). If Salt is too heavy, use a purpose-built thin agent framework and document clearly what is being foregone.

---

## 16. The Tension with the Foundation Document

The control plane architecture and the fleet coordination foundation doc (`fleet-coordination-foundation-2026-04-01.md`) are in partial tension, and the architecture doc does not acknowledge this.

The foundation doc, written three days earlier, established:
- Static fleet truth lives in git (`existential/config/`).
- A thin control-plane daemon that reads those git files and publishes dynamic runtime truth.
- The control plane does NOT own fleet-wide code deployment or model routing policy.
- Machine identity comes from git-managed manifests, not from a centralized config store.

The control plane architecture doc proposes:
- A "single source of truth" config store that lives on the control plane (not in git).
- The control plane stores machine identity, roles, services, and models.
- The control plane manages deployment (phase 4).

These are different architectural models. The foundation doc keeps static truth in git and uses the control plane for dynamic truth. The architecture doc collapses both into the control plane's config store. The architecture doc explicitly says it replaces `fleet-machines.json` (which the foundation doc treats as authoritative static truth).

This is a real design fork that needs resolution before implementation. Both can't be right. If the control plane owns the config store, the git-managed manifests become stale backups. If git owns static truth, the control plane's config store is only dynamic state. Pick one and document the decision.

**Recommendation:** The foundation doc's separation is cleaner. Keep machine identity and role assignments in git. The control plane reads them as its initial config and can accept runtime overrides for dynamic state (current model loaded, current heartbeat schedule). This preserves version history for fleet topology changes while allowing the control plane to track runtime state.

---

## 17. NAT Traversal and Cloudflare Tunnels

The architecture mentions Cloudflare Tunnels as planned but defers the details. This deserves more attention because the topology choice — agents connect outbound — is specifically designed to work with tunnels, and the details matter.

**Cloudflare Tunnel behavior with WebSocket:**
- Cloudflare proxies WebSocket connections. This works but with caveats.
- By default, Cloudflare terminates TLS at the edge and re-encrypts to the origin. The WebSocket content is visible to Cloudflare.
- Cloudflare's free plan has a 100MB upload limit per request (not per message), which means large file transfers over the WebSocket connection could fail.
- Cloudflare may close idle WebSocket connections. The ping/pong interval must be under Cloudflare's idle timeout (which is not documented clearly and varies).
- The Cloudflare Tunnel client (`cloudflared`) must be running on the control plane machine. If it restarts, all agent connections drop.

**Machine-side tunnel behavior:**
- Agents connect outbound — they do not run `cloudflared`. This is correct.
- The agent connects to the Cloudflare-fronted control plane URL. If the control plane moves (new IP, new Cloudflare account), agents need a config update to learn the new URL. But the config update goes through the control plane... which has moved. Bootstrapping problem.

**Fix:** The control plane URL must be stable. For Cloudflare Tunnel deployments, this is a static hostname (`control.seed.example.com`). Agents store this hostname, not an IP. If the control plane migrates to new infrastructure, the DNS record updates and agents reconnect to the same hostname without config changes. This should be documented as the canonical deployment pattern.

---

## Summary: Prioritized Issues

### Must Fix Before Writing Code

| Priority | Issue | Why It's Blocking |
|----------|-------|-------------------|
| P0 | Shared bearer token model | Compromised agent = compromised fleet. Per-machine tokens are not a lot of extra work at design time and extremely painful to retrofit. |
| P0 | `run_script` with no command envelope spec | This is RCE as a feature. Define the command protocol exhaustively first. |
| P0 | Machine ID impersonation via shared token | No gate on "who can claim to be Ren1" is a takeover vector. |
| P1 | Config corruption recovery | JSON on disk with no atomicity guarantees. Use SQLite with WAL from day one. |
| P1 | Config schema / static vs. dynamic tension | Foundation doc and architecture doc disagree on who owns machine identity. Resolve before writing a config struct. |
| P1 | Health probe definition | "Probes local services" is not a spec. Define probe types per service before the health reporter is implemented. |

### Should Fix in v1

| Priority | Issue | Why It Matters |
|----------|-------|----------------|
| P2 | Offline resilience spec | "Keep running on last-known config" needs to be specified, not aspirational. |
| P2 | Config acknowledgment protocol | Without acks, the control plane doesn't know if config was applied. |
| P2 | Audit log | Without it, post-incident analysis is impossible. |
| P2 | WSS unconditionally | WS on "trusted LAN" is a footgun. Enforce TLS. |
| P2 | Model swap drain | Active inference during model swap is a data loss scenario. |
| P2 | Cloudflare Tunnel caveats | Document ping interval requirements and idle timeout behavior. |

### Design Decisions That Should Be Explicit

| Issue | Current State | Required |
|-------|--------------|---------|
| Why custom vs. Salt/Ansible/Nomad | Unstated | Explicit justification or evaluation |
| Scaling ceiling | Unstated | State the designed-for fleet size |
| Control plane upgrade procedure | Unstated | Document the maintenance window |
| Debug path when control plane is down | Unstated (SSH implied) | Define the break-glass procedure |
| Service dependency ordering | Not modeled | Add to service config schema |
| Split-brain config conflict resolution | Not mentioned | Spec required for any multi-network deployment |

---

## What the Architecture Gets Right

To be fair: the outbound-connection topology is the correct fundamental insight. Agents connecting outbound eliminates firewall/NAT complexity, removes the need for SSH key distribution, and makes the fleet work across arbitrary network boundaries. This should not change.

The phased implementation plan is realistic. Phases 1 and 2 are well-scoped. The instinct to keep the inference queue separate is correct.

The foundation doc from three days ago is the better-designed document. If the control plane architecture were to inherit the foundation doc's discipline about separating static truth (git) from dynamic truth (control plane), and add the security fixes outlined above, it would be a solid foundation.

The problems identified here are serious but not fatal. They are design problems, not implementation problems. The right time to find them is in a document review, not in production at 3am.
