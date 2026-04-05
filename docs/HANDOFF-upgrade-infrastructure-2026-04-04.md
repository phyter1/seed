# Handoff — Upgrade Infrastructure + Memory Service

**Date:** 2026-04-04
**From:** Ren (interactive session on ryan-air with Ryan)
**Current state:** v0.2.0 released, ren2 + ren3 running agents, ren1 still on legacy infrastructure

---

## Where We Are

Seed has a working fleet control plane with turnkey install for macOS + Linux:

- ✅ Control plane on ren2 (`http://ren2.local:4310`)
- ✅ Agent on ren3 (Apple Silicon, reporting health)
- ✅ Agent on ren2 (Intel, reporting health, running alongside control plane)
- ✅ Install telemetry working (caught 3 real bugs in live testing — see v0.1.0→v0.1.3 fixes)
- ✅ Runtime installation (Ollama, MLX, Python, Homebrew) — v0.2.0
- ❌ No upgrade path — every bug fix requires manual re-installation on each machine
- ❌ Ren1 still runs legacy infrastructure (heartbeat, ren-queue, memory agent)
- ❌ No centralized memory service — Rusty Memory Haiku is a separate repo on ren1

**Operator token for testing:** use your local `$SEED_OPERATOR_TOKEN` env var (redacted; rotated 2026-04-05)
**Control plane URL:** `http://ren2.local:4310`

---

## Why Upgrade Infrastructure First

We're going to keep finding bugs during real-world testing (we already found 3 in a single session). Right now every fix requires:

1. Find bug
2. Fix it
3. Push commit, tag release, wait for GitHub Actions
4. SSH into each machine
5. Manually `curl` new binaries
6. Restart services

This doesn't scale. We need the fleet to update itself.

Without upgrade infrastructure, every future feature ships with friction. With it, we ship changes fluidly and can confidently deploy the memory service knowing the next patch will land cleanly.

---

## What to Build

### 1. Version tracking in the control plane

**Database:** Extend `machines` table with:
- `agent_version: TEXT` — the version the agent is currently running
- `agent_updated_at: TEXT` — ISO timestamp of last version change

**Agent announce message:** Extend `AnnounceMessage` in `packages/fleet/control/src/types.ts` to include `agent_version: string`. Agent reads its own version from a compile-time constant (embedded at build time) or from a `VERSION` file.

**Control plane response to announce:** After receiving announce, the control plane records the version and can respond with "latest available version" so the agent knows if it's out of date.

**CLI display:** `seed status` output gets a VERSION column showing each machine's agent version + a ⚠ indicator if behind latest.

### 2. `seed-agent self-update` command

The agent binary gets a subcommand:

```bash
seed-agent self-update [--version <tag>] [--force]
```

Behavior:
1. Fetch latest release metadata from GitHub API
2. Compare against own version
3. If newer (or `--force`), download the new binary
4. Verify checksum
5. Write to a temp path, atomic rename over `~/.local/bin/seed-agent`
6. Exit (launchd/systemd restarts the process automatically via KeepAlive)

Implementation notes:
- The same logic exists in `setup/install.sh` — can be factored out
- On Linux, the binary is held open by the running process; need to use atomic rename (which works since we're replacing, not truncating)
- On macOS, same applies

### 3. Control-plane-initiated upgrades

New whitelisted command: `agent.update` (already in the action whitelist in `types.ts`, just needs handler implementation in `packages/fleet/control/src/agent.ts`).

When the control plane dispatches `{ action: "agent.update", params: { version: "v0.3.0" } }`:
1. Agent shells out to itself with `seed-agent self-update --version <tag>`
2. On success, the agent process exits (launchd/systemd restarts it)
3. New agent announces with new version

Control plane's `agent.update` dispatcher needs to handle the expected "connection drops and reconnects with new version" flow — don't treat it as a failure.

### 4. `seed fleet upgrade` CLI command

```bash
seed fleet upgrade                    # upgrade all machines to latest
seed fleet upgrade --version v0.3.0   # upgrade to specific version
seed fleet upgrade --machine ren3     # upgrade one machine
seed fleet upgrade --dry-run          # show what would happen
```

Behavior:
1. Query latest release from GitHub (or use `--version`)
2. List machines needing upgrade (skip if already at target version)
3. Dispatch `agent.update` to each via control plane
4. Poll each machine's reported version every few seconds
5. Print progress bar / status
6. Handle failures: if a machine doesn't come back within 2 minutes, flag it

Respect rollout order: don't upgrade all at once. Default to serial (one at a time) with `--parallel N` flag if needed.

### 5. Control plane self-upgrade

Same mechanism, applied to the control plane itself. The control plane binary gets a `self-update` subcommand. Triggered manually (not by itself — operator decides when to upgrade the brain).

```bash
seed-control-plane self-update [--version <tag>]
```

Not auto-triggered by `seed fleet upgrade` — the control plane is upgraded by the operator directly, because its upgrade momentarily breaks fleet management.

### 6. Installer updates

The `setup/install.sh` script's binary download logic should be factored into a shared helper that both the installer and self-update can call. Extract:
- `detect_arch()` function
- `download_binary(repo, version, name, dest)` function
- `verify_checksum(binary_path, checksums_file)` function

Put these in a single shared script OR keep duplicated but tested. Your call.

---

## Testing Plan

1. Build on a branch, tag as `v0.2.1` (or `v0.3.0` if you want to signal a minor version bump)
2. Manually download the new agent to ren2 (only ren2, not ren3) — verify the self-update works on a "current-version" agent upgrading itself
3. If that works, issue `seed fleet upgrade --machine ren3` from ryan-air
4. Verify ren3 auto-updates and comes back with new version reported
5. Verify `seed status` shows the new version
6. Try `seed fleet upgrade` (upgrade all) with a `v0.2.2` release

---

## After Upgrade Infrastructure: Memory Service

Once upgrades work, the next workstream is harvesting Rusty Memory Haiku into Seed as a core service.

**Source:** `/Users/ryanlowe/code/rusty-memory-haiku/` (on ren1, also cloned locally)
**Destination:** `packages/memory/` (new)

**Key points:**
- Memory becomes fleet infrastructure, not a workload
- Any agent on any machine asks the control plane for the memory endpoint
- Uses local models for embedding (qwen3-embedding via fleet router) and summarization (fleet router picks)
- `$0` per-query cost (no Haiku/Claude calls)
- Data backed up at `~/backups/ren1-cleanup-20260404/memory.db` (9.4MB, on ryan-air)
- Control plane's service catalog adds `memory` entry with endpoint

**Deployment pattern:**
- Memory service runs on ren1 (where the data lives, most uptime)
- Config file specifies: `{ services: { memory: { host: "ren1", port: 19888 } } }`
- `GET /v1/services/memory` on control plane returns the URL

**Not a blocker for upgrade work** — memory is phase 2.

---

## After Memory: Ren1 Cleanup

Last phase. Strip ren1 the same way we did ren2, install Seed agent + memory service, import the backed-up memory.db, restart heartbeat as a workload. See earlier cleanup approach for ren2 — same pattern.

---

## Constraints & Patterns

- **No LLM calls in fleet management** — decision #6 in `docs/design-decisions.md`
- **Follow existing patterns** — `packages/fleet/control/src/` for structure, `db.ts` for SQLite patterns, `server.ts` for Hono routes
- **Write tests** — `db.test.ts`, `server.test.ts`, `cli.test.ts` for new code paths
- **Atomic writes** — binary replacement, config updates, etc. always via temp + rename
- **Tests + typecheck must pass** — `bun test packages/fleet/control/src/` and `bunx tsc --noEmit -p packages/fleet/control`

---

## Files to Read First

1. `docs/control-plane-architecture.md` — the canonical spec
2. `docs/design-decisions.md` — all locked decisions
3. `packages/fleet/control/src/agent.ts` — the agent daemon (where self-update lives)
4. `packages/fleet/control/src/server.ts` — control plane Hono routes
5. `packages/fleet/control/src/types.ts` — `AgentMessage`, `ControlMessage`, `ACTION_WHITELIST`
6. `packages/fleet/control/src/cli.ts` — where `seed fleet upgrade` command lands
7. `setup/install.sh` — binary download logic to factor out
8. `.github/workflows/release.yml` — how releases are built

---

## Key Commands

```bash
# Check fleet status (from ryan-air)
SEED_CONTROL_URL=http://ren2.local:4310 \
SEED_OPERATOR_TOKEN=$SEED_OPERATOR_TOKEN \
~/.local/bin/seed status

# SSH into fleet machines (passwordless auth configured)
ssh ryanlowe@ren1.local
ssh ryanlowe@ren2.local
ssh ren3  # uses ~/.ssh/config alias

# Run tests
cd ~/code/seed && bun test packages/fleet/control/src/

# Typecheck
cd ~/code/seed/packages/fleet/control && bunx tsc --noEmit

# Build binaries locally
cd ~/code/seed/packages/fleet/control && bash scripts/build-binaries.sh
```
