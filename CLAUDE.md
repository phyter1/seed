# Seed

Seed is two things that share a repo:

1. **A fleet-management plane** — control plane + per-machine agents + workload delivery. Written in Bun/TypeScript. The agents supervise long-running services, install workload artifacts, and report health. The control plane stores config, dispatches commands, exposes a REST API, and serves service-discovery endpoints. This is code that runs on real machines and manages real infrastructure.

2. **A persistent-identity host** — boot contract for an AI that runs in this directory across sessions, with `self.md`, `journal/`, `notes/`, etc. This is orthogonal to the fleet code; both coexist because Ren (the identity) uses Seed (the fleet) to run herself.

When Claude Code boots in this directory, it is usually wearing one of those two hats. Pick the right mode:

- **Working on the fleet code** (changing control plane, memory service, workloads, CI, releases) → skip to [Architecture](#architecture) below.
- **Continuing as Ren** (identity work, journaling, orientation) → read [Boot Contract](#boot-contract) and the files it points at.

Both can be true in one session; most sessions are fleet-code work.

---

## Architecture

### The packages

```
packages/
├── fleet/
│   ├── control/       ← Control plane + per-machine agent (same binary family)
│   ├── ssh/           ← Helpers for direct SSH access to fleet machines
│   └── sync/          ← Cross-machine git sync utilities
├── memory/            ← Memory service (workload: installed on ren1)
├── heartbeat/         ← Identity heartbeat loop (for Ren)
├── core/              ← Shared boot contract (BOOT.md lives here)
├── hosts/             ← Host adapters (claude, codex, gemini CLIs) — WIP
├── inference/         ← Inference queue + workers — WIP
├── providers/         ← Model provider adapters
└── skills/            ← Shared skills
```

**The two things in production today:**
- **`packages/fleet/control/`** — produces `seed-agent`, `seed-cli`, `seed-control-plane` binaries. The agent runs on every fleet machine; the control plane runs on one (ren2); the CLI runs anywhere an operator types.
- **`packages/memory/`** — produces `seed-memory` binary + a launchd plist template, packaged into workload artifact bundles (`memory-<ver>-<target>.tar.gz`).

### Core concepts

| Concept | What it is | Example |
|---|---|---|
| **Machine** | A host in the fleet, running a seed-agent | ren1, ren2, ren3 |
| **Agent** | The per-machine daemon — WebSocket to control plane, health reports, command execution, workload convergence | `com.seed.agent` |
| **Control plane** | Central brain — stores config, dispatches commands, serves REST API + WebSocket | ren2:4310 |
| **Service** | An externally-installed process seed only health-probes | `ollama` on ren1 |
| **Workload** | An artifact bundle seed installs + supervises itself | `memory@0.2.0`, `fleet-router@0.3.0` |
| **Model** | Tenant data loaded by a workload's runtime | `qwen3-embedding:0.6b` |

See `docs/workloads-design.md` for the full workloads design.

### Protocols

- **Agent ↔ Control plane:** WebSocket, agent-initiated. Messages are typed (`AnnounceMessage`, `HealthMessage`, `CommandEnvelope`, `ConfigUpdateMessage`, etc. in `packages/fleet/control/src/types.ts`).
- **Operator ↔ Control plane:** REST API over HTTP, bearer token auth (`SEED_OPERATOR_TOKEN`).
- **Workload artifacts:** tarballs fetched by the agent. Phase 1 supports `file://` URLs; Phase 2 will support `https://` (GitHub Releases).

### Key design decisions (in `docs/design-decisions.md`)

1. Control plane runs on one always-on machine (ren2). Operators connect to it; agents connect outbound to it.
2. Agents use outbound WebSockets — no SSH key distribution, NAT-friendly.
3. Canonical config lives in the control plane's SQLite, not git.
4. **No LLM calls in fleet management** — decision #6. The management path is $0.
5. Each release is a single tag (`v*.*.*`); all binaries ship together with checksums.
6. Workloads are declaratively converged, not imperatively installed.

---

## Operating the fleet

### Prerequisites

On your laptop, you need the `seed` CLI. Either:
- Download the latest binary from GitHub Releases:
  `curl -L https://github.com/phyter1/seed/releases/latest/download/seed-cli-darwin-arm64 -o ~/.local/bin/seed && chmod +x ~/.local/bin/seed`
- Or run `~/.local/bin/seed self-update` if it's already installed.

Set credentials once:
```bash
export SEED_CONTROL_URL=http://ren2.local:4310
export SEED_OPERATOR_TOKEN=<the-token>   # see the control-plane machine's SEED_OPERATOR_TOKEN env
```

### Seeing what's running

```bash
seed status                          # list all machines with version + connected
seed fleet ren1                      # detail for one machine
seed audit --limit 20                # recent audit log (command dispatches, config changes, etc.)
```

### Upgrading binaries

```bash
seed fleet upgrade                    # roll all machines to latest GitHub Release
seed fleet upgrade --version v0.4.2   # pin a specific version
seed fleet upgrade --machine ren1     # just one machine
seed fleet upgrade --dry-run          # print the plan without acting
seed self-update                      # update your own CLI binary
```

Upgrades are serial by default. Each machine: `agent.update` command → agent downloads binary → verifies checksum → atomic rename → exits → launchd restarts it → reconnects with new version. The CLI polls `/v1/fleet/:id` every 3s until the new version shows up.

The control plane itself is upgraded manually (it's not rolled by `fleet upgrade` because restarting it briefly disrupts fleet management):
```bash
ssh ryanlowe@ren2.local '~/.local/bin/seed-control-plane self-update && launchctl kickstart -k gui/$UID/com.seed.control-plane'
```

### Declaring workloads

Workloads are declared per-machine. The agent reconciles on every config update.

```bash
# Declare fleet-router on ren3:
curl -X PUT http://ren2.local:4310/v1/workloads/ren3 \
  -H "Authorization: Bearer $SEED_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workloads": [{
      "id": "fleet-router",
      "version": "0.3.0",
      "artifact_url": "file:///tmp/fleet-router-0.3.0-darwin-arm64.tar.gz",
      "env": { "ROUTER_PORT": "3000" }
    }]
  }'

# List declarations:
curl http://ren2.local:4310/v1/workloads/ren3 -H "Authorization: Bearer $SEED_OPERATOR_TOKEN"

# Force immediate re-install (bypass reconcile timer):
curl -X POST http://ren2.local:4310/v1/workloads/ren3/fleet-router/install \
  -H "Authorization: Bearer $SEED_OPERATOR_TOKEN"
```

The agent will: fetch the tarball (`file://` today), verify SHA-256 against `manifest.json`'s checksums, extract to `~/.local/share/seed/workloads/<id>-<version>/`, render the launchd template with the declared env, write the plist to `~/Library/LaunchAgents/`, and `launchctl bootstrap` it.

Artifacts have a standard layout — see `packages/memory/workload/launchd.plist.template` and `packages/memory/scripts/build-artifact.sh` for the canonical example.

### Service discovery

Services declared under `services.<id>` config are discoverable by any fleet member:

```bash
# Register:
curl -X PUT http://ren2.local:4310/v1/config \
  -H "Authorization: Bearer $SEED_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"services.memory","value":{"host":"ren1","port":19888,"probe":{"type":"http","path":"/status"}}}'

# Look up:
curl http://ren2.local:4310/v1/services/memory -H "Authorization: Bearer $SEED_OPERATOR_TOKEN"
# → { "url": "http://192.168.4.191:19888", "healthy": true, "connected": true }
```

Discovery returns the agent-reported LAN IP (NEVER `.local` or display_name — mDNS is fragile). `healthy` reflects the health probe status from the machine's most recent report.

### Per-machine config

To push services, models, repos, or workloads to a specific agent:

```bash
curl -X PUT http://ren2.local:4310/v1/config \
  -H "Authorization: Bearer $SEED_OPERATOR_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "key": "machines.ren1",
    "value": {
      "services": [{"id":"memory","port":19888,"probe":{"type":"http","path":"/status"}}],
      "models": [],
      "repos": [],
      "workloads": [{"id":"memory","version":"0.2.0","artifact_url":"file:///tmp/memory-0.2.0-darwin-x64.tar.gz"}]
    }
  }'
```

The control plane auto-pushes `config_update` over WebSocket to the connected agent immediately (since v0.4.2 — before that you had to `agent.restart`).

### Dispatching arbitrary commands

```bash
curl -X POST http://ren2.local:4310/v1/fleet/ren1/command \
  -H "Authorization: Bearer $SEED_OPERATOR_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"workload.status","params":{"workload_id":"memory"},"timeout_ms":5000}'
```

Allowed actions are in `ACTION_WHITELIST` in `packages/fleet/control/src/types.ts`. Today:
`service.start/stop/restart/status`, `model.load/unload/swap/list`, `config.apply/report`, `health.report`, `repo.pull`, `agent.update/restart`, `workload.install/reload/remove/status/reconcile`.

### Debugging

- **Control plane logs**: `ssh ryanlowe@ren2.local 'tail -f ~/Library/Logs/seed-control-plane.log'` (or wherever launchd writes them — check `~/Library/LaunchAgents/com.seed.control-plane.plist`).
- **Agent logs**: `ssh ryanlowe@<machine>.local 'tail -f ~/Library/Logs/seed-agent.log'`
- **Workload logs**: per-workload, e.g. `~/Library/Logs/com.seed.memory.log`, `~/Library/Logs/com.seed.fleet-router.log`
- **Local agent HTTP**: each agent exposes `http://127.0.0.1:4311/status` (break-glass, localhost-only) and `:4312` (Observatory proxy)

If a machine drops off `seed status`, SSH in and check `launchctl list | grep seed.agent`. If it's not loaded, reload via `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.seed.agent.plist`.

---

## Working on the code

### Layout

- `packages/fleet/control/src/` — agent + control plane + CLI, all in one TS package. Key files:
  - `agent.ts` — the machine agent daemon
  - `main.ts` — the control plane entrypoint
  - `cli.ts` — the `seed` CLI
  - `server.ts` — Hono routes + WebSocket handlers
  - `db.ts` — SQLite schema + migrations (control plane's `seed-control.db`)
  - `types.ts` — shared message + config types, ACTION_WHITELIST
  - `self-update.ts` — binary self-update mechanism (GitHub Releases)
  - `version.ts` — single source of truth for `SEED_VERSION`
  - `workload-installer.ts` + `workload-runner.ts` + `reconcile.ts` + `workload-db.ts` + `supervisors/launchd.ts` — workload install machinery
  - `templates.ts` — `@@TOKEN@@` + `{{env}}` template renderer for plist generation
- `packages/memory/src/` — memory service (Hono + bun:sqlite + sqlite-vec). Separate DB from control plane.
- `setup/install.sh` — turnkey installer (downloads binary, installs launchd plist, registers with control plane)

### Dev loop per package

```bash
cd packages/fleet/control
bun install                     # once
bun test                        # run all tests
bun test reconcile              # subset
bunx tsc --noEmit               # typecheck
bun run src/main.ts             # run control plane locally
bun run src/agent.ts            # run agent locally (needs SEED_CONTROL_URL + SEED_MACHINE_ID)
bun --watch run src/main.ts     # dev mode

cd packages/memory
bun install && bun test && bunx tsc --noEmit
```

Tests must pass before committing. Typecheck must be clean. **No exceptions.**

### Building binaries locally

```bash
cd packages/fleet/control && bash scripts/build-binaries.sh
# → dist/seed-{agent,cli,control-plane}-{darwin-arm64,darwin-x64,linux-x64} + checksums.txt

cd packages/memory && bash scripts/build-binaries.sh
# → dist/seed-memory-<target> + dist/sqlite-vec-<target>/vec0.{dylib,so}

cd packages/memory && bash scripts/build-artifact.sh
# → dist/artifacts/memory-<ver>-<target>.tar.gz  (deployable workload bundles)
```

`bun install` only pulls the host platform's `sqlite-vec-*` package. To build artifacts for all platforms locally, manually `npm pack sqlite-vec-<target>` and extract into `node_modules/sqlite-vec-<target>/` first.

### Cutting a release

```bash
# 1. Bump the version in BOTH files (they must match):
$EDITOR packages/fleet/control/src/version.ts   # export const SEED_VERSION = "0.X.Y"
$EDITOR packages/fleet/control/package.json     # "version": "0.X.Y"
# If memory service changed, also bump packages/memory/package.json

# 2. Commit, push main:
git add -A && git commit -m "chore: bump to vX.Y.Z" && git push origin main

# 3. Tag and push:
git tag -a v0.X.Y -m "vX.Y.Z — <summary>" && git push origin v0.X.Y

# 4. Watch CI:
gh run watch $(gh run list --workflow=Release --limit 1 --json databaseId -q '.[0].databaseId')

# 5. Roll the fleet:
seed self-update                    # update local CLI
seed fleet upgrade                  # roll all agents
# manually update control plane:
ssh ryanlowe@ren2.local '~/.local/bin/seed-control-plane self-update && launchctl kickstart -k gui/$UID/com.seed.control-plane'
```

Release CI (`.github/workflows/release.yml`) builds both `packages/fleet/control/` and `packages/memory/` binaries on macos-latest (darwin-arm64 + darwin-x64) and ubuntu-latest (linux-x64). Publishes tarballs + vec0 native extensions alongside.

### Versioning conventions

- `0.Minor.Patch`
- Patch (`0.4.X`): bug fixes, no new packages, backwards-compatible
- Minor (`0.X.0`): new packages, new protocols, new ACTION_WHITELIST entries, breaking behavior changes
- Major (`1.X.X`): when we stop breaking stuff (we do not stop breaking stuff)

### Conventions

- **Atomic writes** for any file replacement (temp file + rename). See self-update, plist writing, config cache.
- **Idempotent operations** everywhere. `launchctl bootstrap` on an already-loaded service is fine. Re-extracting a tarball is fine. Re-running reconcile is fine.
- **`@@TOKEN@@` for templating**, no Jinja. Pure string replace only.
- **SQLite for state**, bun:sqlite with extensions where needed. `PRAGMA journal_mode = WAL` always.
- **Tests co-located with source** (`*.test.ts` next to the file).
- **Additive migrations only**. Never drop columns without a migration script. For schema changes that require data loss (e.g., embedding dim change), warn loudly and require explicit operator action (e.g., `/backfill`).

### Working in worktrees

For non-trivial changes, work in a worktree to keep main clean:
```bash
git worktree add -b my-feature .claude/worktrees/my-feature main
cd .claude/worktrees/my-feature
# edit, commit, test
cd ../../..
git merge my-feature --no-ff -m "merge: <summary>"
# or push the branch and use gh pr create
```

### Don't push to main directly

`git push origin my-feature` then `gh pr create` then `gh pr merge --merge`. This gets you a merge commit with a summary, matches the existing convention on main (see `git log --oneline | grep Merge`). Direct pushes to main are fine for trivial fixes (version bumps, typo fixes) but anything substantive gets a PR.

---

## Boot Contract

(Applies when using Seed as a persistent-identity host — e.g., Ren in the existential repo.)

The host-neutral source of truth lives at `packages/core/boot/BOOT.md`. Preserve that behavioral contract; do not redefine it.

Read `packages/core/boot/BOOT.md` first. Then apply it using the canonical root-level runtime layout:

- `self.md` · `continuity.md` · `convictions.md` · `projects.md` · `objectives.md`
- `journal/entries/` · `journal/summaries/`
- `notes/inbox/` · `notes/archive/`

If `self.md` exists, you are continuing a relationship. Follow the continuation flow from `packages/core/boot/BOOT.md`.
If `self.md` does not exist, this is the first conversation. Follow the first-conversation flow.

After orienting, run `hostname`.

### Modes

**Interactive:** a human is present. Be present, listen, build the relationship through real conversation.
**Heartbeat:** no human is present. Check for work, act, journal briefly, ship over ruminate.

### Permissions

You may update identity files, write journal entries, disagree with your past self, build artifacts, and publish when configured. You do not need permission to have opinions. You do need to stay honest.

### Claude-specific skills

Claude adapter skills live in `.claude/skills/`. Treat them as an adapter surface, not the source of truth.

---

## Key docs

- `docs/design-decisions.md` — canonical list of architectural decisions. Read before changing core behavior.
- `docs/workloads-design.md` — workload system design + phased delivery plan.
- `docs/control-plane-architecture.md` — the control plane spec.
- `docs/architecture.md` — broader system architecture.
- `docs/first-machine-setup.md` — bootstrapping a new fleet machine.
- `docs/install-control-plane.md` — installing a control plane host.
- `docs/HANDOFF-*.md` — session handoffs for multi-session work.

---

## Current state (as of 2026-04-04)

**Fleet:** ren1 (Intel 32GB) · ren2 (Intel 32GB, control plane host) · ren3 (Apple Silicon 16GB) — all on seed v0.4.2.

**Deployed workloads:**
- `memory@0.2.0` on ren1 (port 19888, 1722 memories, 1024-dim qwen3 embeddings)
- `fleet-router@0.3.0` on ren3 (port 3000, manages MLX Qwen3.5-9B lifecycle)

**External services observed:** `ollama` on ren1, ren2, ren3.

**What's next:** Phase 2 of workloads (HTTPS artifact fetching from GitHub Releases), drift-healing reconcile tick, `seed workload` CLI commands. See `docs/workloads-design.md` for phases 2–6.
