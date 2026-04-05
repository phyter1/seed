# Handoff — Fleet Telemetry & Hooks Migration

**Date:** 2026-04-04
**From:** Ren (interactive session on ren2 with Ryan)
**To:** Agent working on Seed
**Context:** Full fleet audit revealed that Claude Code's telemetry hooks on all machines still point at the old Agent Observatory (port 4173), which no longer runs. The Seed control plane (port 4310) already has the matching endpoints but nothing is wired to them.

---

## The Problem

Every Claude Code session on every fleet machine fires HTTP hooks that fail with "connection refused" on every tool call. This is because `~/.claude/settings.json` on each machine still targets the Agent Observatory at `localhost:4173`, which was replaced by Seed's control plane.

**Current config on ren2** (`~/.claude/settings.json`):

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4173/otlp",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_LOG_USER_PROMPTS": "1",
    "OTEL_LOG_TOOL_DETAILS": "1",
    "OTEL_RESOURCE_ATTRIBUTES": "agent_observatory.machine_id=ren2"
  },
  "hooks": {
    "PreToolUse": [{ "hooks": [{ "type": "http", "url": "http://localhost:4173/api/v1/hooks?machine_id=ren2" }] }],
    "PostToolUse": [{ "hooks": [{ "type": "http", "url": "http://localhost:4173/api/v1/hooks?machine_id=ren2" }] }],
    "PostToolUseFailure": [{ "hooks": [{ "type": "http", "url": "http://localhost:4173/api/v1/hooks?machine_id=ren2" }] }],
    "SessionStart": [{ "hooks": [{ "type": "http", "url": "http://localhost:4173/api/v1/hooks?machine_id=ren2" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "http", "url": "http://localhost:4173/api/v1/hooks?machine_id=ren2" }] }],
    "Stop": [{ "hooks": [{ "type": "http", "url": "http://localhost:4173/api/v1/hooks?machine_id=ren2" }] }],
    "SubagentStart": [{ "hooks": [{ "type": "http", "url": "http://localhost:4173/api/v1/hooks?machine_id=ren2" }] }],
    "SubagentStop": [{ "hooks": [{ "type": "http", "url": "http://localhost:4173/api/v1/hooks?machine_id=ren2" }] }],
    "TaskCreated": [{ "hooks": [{ "type": "http", "url": "http://localhost:4173/api/v1/hooks?machine_id=ren2" }] }],
    "TaskCompleted": [{ "hooks": [{ "type": "http", "url": "http://localhost:4173/api/v1/hooks?machine_id=ren2" }] }],
    "Notification": [{ "hooks": [{ "type": "http", "url": "http://localhost:4173/api/v1/hooks?machine_id=ren2" }] }]
  }
}
```

Assume ren1 and ren3 have equivalent configs (same structure, different `machine_id` values). Ren3 is currently unreachable via SSH but its seed-agent is connected via WebSocket.

---

## Seed Already Has the Endpoints

The control plane (`packages/fleet/control/src/server.ts`) already implements both endpoints:

| Old (Observatory) | New (Seed Control Plane) | Auth | Notes |
|---|---|---|---|
| `POST http://localhost:4173/api/v1/hooks` | `POST http://localhost:4310/api/v1/hooks` | None required | Accepts `X-Machine-Id` header. Outside `/v1/*` auth scope by design (server.ts:658-660) |
| `POST http://localhost:4173/otlp/v1/logs` | `POST http://localhost:4310/otlp/v1/logs` | None required | JSON only, no protobuf. Same unauthenticated scope |

The hooks endpoint normalizes payloads via `normalizeHookPayload()` and feeds them into the telemetry pipeline. The OTLP endpoint normalizes via `normalizeLogRecord()`. Both require `state.telemetry` to be initialized (returns 503 if disabled).

---

## What Needs to Change

### On each fleet machine (`~/.claude/settings.json`):

1. **Hooks URL**: change port `4173` → `4310`
2. **OTEL endpoint**: change `http://localhost:4173/otlp` → `http://localhost:4310/otlp`
3. **Resource attribute key**: consider changing `agent_observatory.machine_id` → something Seed-native (or keep it if the normalizer expects it)
4. **Machine ID in hooks URL**: keep the `?machine_id=` query param or switch to `X-Machine-Id` header — check what the normalizer prefers

### On the control plane:

5. **Verify telemetry pipeline is enabled** — if `state.telemetry` is null, both endpoints return 503. Check that the control plane starts with telemetry initialized.
6. **Verify the normalizer handles the hook payload shape** — Claude Code's hook payloads have a specific structure. The `normalizeHookPayload()` function in `normalizer.ts` should already handle this (it was harvested from Observatory), but worth a quick smoke test.

### Stretch: make this a Seed-managed config

7. Instead of manually editing `settings.json` on each machine, this could be a `config.apply` operation pushed from the control plane. The agent already has `config.report` and `config.apply` handlers. If there's a config schema for Claude Code settings, the control plane could own the canonical version and push it to all machines.

---

## How to Verify

```bash
# On any fleet machine, after updating settings.json:

# 1. Check control plane is listening
curl -s http://localhost:4310/otlp/v1/logs -X POST -H "Content-Type: application/json" -d '{"resourceLogs":[]}' 
# Should return 200, not 503

# 2. Check hooks endpoint
curl -s http://localhost:4310/api/v1/hooks -X POST -H "Content-Type: application/json" -H "X-Machine-Id: ren2" -d '{"type":"test"}'
# Should return 200 with {"received": true} or {"received": true, "skipped": "no session id"}

# 3. Start a Claude Code session and watch for connection-refused errors
# They should be gone
```

---

## Other Issues Found During Fleet Audit

These are not directly related to hooks but were discovered during the same audit session and are worth tracking:

1. **Embedding dimension mismatch on ren1 memory service** — The memory DB has 384-dimension vectors (from the old nomic-embed-text model) but queries now produce 1024-dimension vectors. Vector search (knn) fails on every query. Needs either re-indexing with the current model or switching back to a 384-dim model.

2. **Ren3 SSH unreachable** — Seed agent is connected via WebSocket (confirmed by `seed fleet status`), but SSH from ren2 times out. The outbound-agent topology handles this gracefully, but SSH access is still needed for manual operations.

3. **CLI version skew** — `seed` CLI binary is v0.2.1, agents are v0.4.1. CLI works but shows warnings. Run `seed fleet self-update` or rebuild the CLI binary.

4. **Old launchd services on ren1** — `com.existential.heartbeat` and `com.existential.fleet-sync` are registered but inactive. Should be unloaded once Seed's heartbeat dispatch (EPIC-006) is ready.

5. **Two Ollama models loaded on ren2** — gemma4:e2b and gemma4:e4b both with infinite keep-alive. This is ~17GB of RAM. May be intentional (jury pattern needs both), but contradicts the "one model per Intel machine" policy.

6. **Stale install session** — `ren3-20260404T180312-5529` stuck at `in_progress` / `config.generate`. Not blocking (superseded by successful install), but the record should be cleaned up.
