# Workloads — Design

**Status:** Implemented (Phase 1 complete, Phase 2 partial)
**Implementation notes:** Phase 1 (single-machine install, launchd driver, convergence loop, workload.install command) is complete and deployed. Phase 2 (GitHub Releases artifact distribution, checksum verification) is partially implemented. Phases 3-6 remain as future work.
**Date:** 2026-04-04
**Author:** Ren (interactive session with Ryan)
**Prompted by:** ren3 rebooted, `com.ren-jury.router` + `com.ren-jury.mlx-server` weren't seed-managed, so nothing brought them back. Seed claims to own ren3 but doesn't own the services that give ren3 its purpose.

---

## Problem

Seed has a **service** concept — a declared, supervised, health-probed process — but has no **workload** concept: a declared artifact bundle that seed can *install* and *bring back* after a reboot or drift.

The gap is concrete:

- `MachineConfig.services[]` declares `{ id, port, probe, manager, launchd_label, depends_on }` — this describes what a service *looks like when running*, not where its binary came from or how it gets loaded after a reboot.
- The `service.start / service.stop / service.restart` action handlers in `packages/fleet/control/src/agent.ts:521` are stubs: `"${action}: not yet implemented"`.
- Binaries and plist templates exist (e.g., `packages/memory/com.seed.memory.plist.template`) but nothing in seed *delivers* them to a target machine and renders them.

**Symptom that surfaced this:** ren3's fleet-router and MLX server were launchd services created by the ren-jury repo, outside seed's supervision. When ren3 cycled (uptime 2h), they didn't come back. Seed reported ren3 as "connected, agent v0.2.2, 0 services, 0 models" — factually correct, architecturally incoherent. If seed owns the machine, seed should own the workloads.

The same gap will block deploying `seed-memory` to ren1.

---

## Design Principles

1. **Declarative, not imperative.** The operator declares "ren1 runs the memory workload at version 0.1.0." Seed figures out whether that's currently true and, if not, makes it true.
2. **Convergent, not one-shot.** The agent periodically reconciles declared-vs-actual. Reboot recovery is the same code path as first-install. Drift detection is a side effect.
3. **Artifact bundles are self-describing.** A workload ships a manifest that declares its own binary, plist/unit template, sidecar files, env requirements, and probe config. Seed's installer is generic.
4. **No AI in the management path.** Consistent with decision #6 in `design-decisions.md` — fleet management is $0.
5. **Supervisor-agnostic at the API layer, supervisor-specific at the driver layer.** `launchd` on macOS, `systemd --user` on Linux. Same workload manifest feeds both.
6. **Fail visibly.** If a workload install fails, the agent reports `install_failed` with the exact error. Seed does not retry forever silently.

---

## Core Concepts

### Workload

A **workload** is a named, versioned, installable unit that produces a supervised long-running process.

```
workload = artifact_bundle + render_spec + supervisor_spec + probe_spec
```

Examples from the current fleet:
| Workload ID | Hosted on | What it is |
|---|---|---|
| `memory` | ren1 | seed-memory HTTP service (port 19888) |
| `fleet-router` | ren3 | ren-jury rule-based router (port 3000) |
| `mlx-server` | ren3 | MLX inference server (port 8080) |
| `ollama` | ren1, ren2 | Ollama daemon (port 11434) — externally managed, not installed by seed |
| `heartbeat` | ren1 | Heartbeat daemon — git repo, not a binary |

**Not every supervised process is a seed workload.** Ollama is installed by the user via `brew install ollama` and seed just talks to it. The heartbeat runs from a git repo, not an artifact. Workloads are specifically the things seed *installs and updates* from an artifact.

### Artifact Bundle

A tarball published alongside each seed release containing:

```
memory-0.1.0-darwin-arm64.tar.gz
├── manifest.json
├── bin/
│   └── seed-memory
├── templates/
│   ├── launchd.plist.template
│   └── systemd.service.template        # optional (linux only)
├── lib/
│   └── vec0.dylib                      # sidecar files
└── README.md                           # operator-facing notes
```

`manifest.json` is the declaration:

```jsonc
{
  "id": "memory",
  "version": "0.1.0",
  "description": "Seed memory service (ingest, query, knowledge graph)",
  "platform": "darwin",
  "arch": "arm64",
  "binary": "bin/seed-memory",
  "sidecars": [
    { "src": "lib/vec0.dylib", "dest_rel": "lib/vec0.dylib" }
  ],
  "env": {
    "SEED_VEC_PATH": "{{install_dir}}/lib/vec0.dylib"
  },
  "required_env": ["MEMORY_DB", "SEED_EMBED_URL"],
  "port": 19888,
  "probe": { "type": "http", "path": "/status" },
  "supervisor": {
    "launchd": {
      "label": "com.seed.memory",
      "template": "templates/launchd.plist.template",
      "log_path_rel": "Library/Logs/seed-memory.log"
    },
    "systemd": {
      "unit": "seed-memory.service",
      "template": "templates/systemd.service.template"
    }
  },
  "checksums": {
    "bin/seed-memory": "sha256:...",
    "lib/vec0.dylib": "sha256:..."
  }
}
```

### Declaration (control-plane config)

A workload is assigned to a machine via a new config key:

```jsonc
"workloads.ren1": [
  {
    "id": "memory",
    "version": "0.1.0",
    "env": {
      "MEMORY_DB": "~/.local/share/seed/memory.db",
      "SEED_EMBED_URL": "http://localhost:11434",
      "SEED_LLM_URL": "http://ren3.local:3000"
    },
    "depends_on": ["ollama"]
  }
]
```

The agent for `ren1` sees this slice of config, resolves it to "I should have `memory@0.1.0` installed and running," and converges.

### Install State (per-machine, agent-side)

The agent tracks, in its own local store (`~/.local/share/seed/workloads.db`):

| Field | Meaning |
|---|---|
| `workload_id` | `memory` |
| `version` | `0.1.0` |
| `install_dir` | `~/.local/share/seed/workloads/memory-0.1.0` |
| `installed_at` | ISO timestamp |
| `supervisor_label` | `com.seed.memory` |
| `last_probe` | health_tier + timestamp |
| `state` | `installed`, `loaded`, `running`, `install_failed`, `drift` |
| `failure_reason` | populated when state=install_failed |

---

## Convergence Loop

On each reconcile tick (every 60s, aligned with existing health interval), the agent:

```
declared = config.workloads[machine_id]          # from control plane
installed = local workloads.db
supervisor_state = launchctl list / systemctl list-units

for each w in declared:
    if w not in installed:
        → fetch artifact
        → verify checksums
        → extract to install_dir
        → render supervisor template (env, paths)
        → supervisor.load()
        → record state=loaded
    elif installed[w].version != declared[w].version:
        → supervisor.unload()
        → archive old install_dir
        → install new (same as above)
    elif declared[w] not in supervisor_state:
        → state = drift
        → supervisor.load() (re-attach after reboot / manual unload)

for each w in installed but not in declared:
    → supervisor.unload()
    → archive install_dir
    → record state=removed
```

**Idempotency:** Every step is safe to re-run. `launchctl load` of an already-loaded plist is a no-op (or yields a known error we ignore). Extracting an already-extracted tarball overwrites with identical bytes.

**Drift is the reboot-recovery case.** After ren3 reboots, the agent reconnects to the control plane, pulls config, sees `workloads.ren3` includes `fleet-router@x.y.z`, checks launchctl, finds it missing, runs `launchctl load` on the plist (still on disk at `install_dir`). No full reinstall needed.

**Hard drift (install_dir wiped):** treated as "not installed" — fetches artifact fresh.

---

## Artifact Distribution

Three options, pick one for v1:

**Option A — GitHub Releases (recommended for v1)**
- Seed release CI uploads `<workload>-<version>-<platform>-<arch>.tar.gz` alongside binaries.
- Agent downloads via HTTPS from `https://github.com/phyter1/seed/releases/download/v<seed-version>/memory-0.1.0-darwin-arm64.tar.gz`.
- Checksums published in `checksums.txt` on the release.
- Matches the existing binary distribution pattern.

**Option B — Control plane as artifact server**
- Control plane serves artifacts at `GET /v1/artifacts/:id/:version/:platform-:arch`.
- Control plane pulls from GitHub on demand and caches.
- Benefits: air-gapped installs, bandwidth sharing.
- Defer until needed.

**Option C — Embed in agent**
- Bundle common workloads into the agent binary.
- Rejected: bloats the agent, couples release cadences.

Go with A for v1.

---

## Supervisor Drivers

`packages/fleet/control/src/supervisors/launchd.ts`:
```ts
interface SupervisorDriver {
  load(label: string, plistPath: string): Promise<void>;
  unload(label: string): Promise<void>;
  list(): Promise<Array<{ label: string; pid: number | null; status: number }>>;
  status(label: string): Promise<{ loaded: boolean; pid?: number; last_exit?: number }>;
}
```

`launchd` driver wraps `launchctl bootstrap gui/$UID <plist>` + `launchctl bootout`. (`launchctl load`/`unload` are deprecated on modern macOS; use bootstrap/bootout.)

`systemd --user` driver wraps `systemctl --user daemon-reload`, `systemctl --user enable --now <unit>`, `systemctl --user stop <unit> && systemctl --user disable <unit>`.

Both drivers capture stderr/stdout and exit codes — surfaced in the agent's `install_failed` reports.

---

## Template Rendering

Templates use `@@TOKEN@@` placeholders (matches existing seed convention, see `com.seed.control-plane.plist.template`). The installer provides:

| Token | Value |
|---|---|
| `@@BINARY@@` | `{install_dir}/bin/{binary_name}` |
| `@@HOME@@` | `$HOME` of the running user |
| `@@INSTALL_DIR@@` | `{install_dir}` |
| `@@LOG_PATH@@` | rendered log path (stderr/stdout) |
| `@@ENV_KEY@@` | any env value from `declaration.env` or `manifest.env` |

Rendering is pure string replacement — no Jinja, no templating engine (matches security posture from `design-decisions.md` #12).

---

## New Control Plane API

| Method | Path | Purpose |
|---|---|---|
| `GET /v1/workloads` | list all declared workloads (all machines) |
| `GET /v1/workloads/:machine_id` | list declared workloads for a machine |
| `PUT /v1/workloads/:machine_id` | replace declared workloads for a machine |
| `POST /v1/workloads/:machine_id/:workload_id/install` | force immediate install (bypass next reconcile) |
| `DELETE /v1/workloads/:machine_id/:workload_id` | remove a workload declaration (agent will unload) |
| `GET /v1/workloads/:machine_id/:workload_id/status` | current install state from agent |

Declarations are stored under the existing config key-value store with key prefix `workloads.<machine_id>` so they version the same way regular config does.

---

## New Agent Commands (ACTION_WHITELIST additions)

| Action | Purpose |
|---|---|
| `workload.install` | `{ workload_id, version }` — force fetch+install+load (no-op if already current) |
| `workload.reload` | `{ workload_id }` — unload + load from existing install_dir (quick restart) |
| `workload.remove` | `{ workload_id }` — unload + archive install_dir |
| `workload.status` | `{ workload_id }` — return full install state |
| `workload.reconcile` | trigger a reconcile tick immediately |

All actions continue to be dispatched via the existing WebSocket command envelope.

---

## Service Discovery Integration

The existing `GET /v1/services/:service_id` (added in the memory service work) can be upgraded to check declared workloads:

1. Look up `services.<id>` in config (existing path) — explicit wiring.
2. If absent, look up workload declarations across all machines; if exactly one machine declares `workload.id == service_id`, return its host + manifest.port.
3. `healthy` is derived from the agent's `workload.state == running` reports in last_health.

This means: **declaring a workload automatically makes it discoverable**. No separate `services.*` entry to maintain.

---

## Workload vs Service vs Model

| Concept | What seed does | Examples |
|---|---|---|
| **Workload** | installs, supervises, reconciles | `memory`, `fleet-router`, `mlx-server` |
| **Service** | health-probes only (externally installed) | `ollama` |
| **Model** | loads into a runtime via API | `qwen3-embedding:0.6b`, `gemma4:e4b` |

A workload can *host* a service and *own* the models it loads. A service is a plain process seed doesn't own. A model is tenant data loaded into a runtime.

Most entries in the current `services[]` config array should migrate to workloads.

---

## Open Questions

1. **User vs system scope.** launchd GUI agent (per-user, dies on logout) vs LaunchDaemon (system-wide, survives logout). User scope is simpler but requires auto-login on the host machine. For ren1/ren2/ren3 (always-on, auto-login) user scope is fine. For ren4 (Linux headless server) we need system scope via `systemctl enable --now`. **Proposal:** workloads default to user scope; per-workload override via `supervisor.scope: "system" | "user"`.
2. **Dependency ordering during convergence.** If `memory` depends on `ollama`, and ollama isn't reporting healthy yet, delay the memory install? Or install and let the service fail its probe until ollama is up? **Proposal:** install unconditionally (launchd/systemd will retry), but delay `launchctl bootstrap` until dependencies are at `accepting_connections`.
3. **Secret handling.** Some env values are secrets (operator tokens, API keys). The current plan renders them straight into plists on disk. **Proposal:** treat env values prefixed `secret:` as references into a per-machine keychain (macOS Keychain, systemd credential store on Linux). Defer to v2.
4. **Rollback.** If a new workload version crashes immediately, should we auto-rollback? **Proposal:** no auto-rollback in v1. Operator dispatches `PUT /v1/workloads/:machine_id` with the prior version. Archive old installs for 3 versions to make rollback cheap.
5. **Cross-machine workloads.** Some services are logically fleet-level (the fleet-router). **Proposal:** no special-casing. A workload runs on a specific machine. Fleet-level is just "declared on exactly one machine, discovered via service discovery."

---

## Phased Delivery

**Phase 1 — Single-machine install (ren1: memory)**
- Workload manifest format
- launchd supervisor driver
- Agent-side convergence loop (happy path only)
- Control plane config key `workloads.<machine_id>`
- `workload.install` command
- No artifact distribution yet — local file:// URLs for testing

**Phase 2 — Artifact distribution**
- GitHub Releases integration
- Checksum verification
- Caching in `~/.local/share/seed/workload-cache/`

**Phase 3 — Full convergence + drift healing**
- Periodic reconcile tick
- Reboot recovery (re-bootstrap existing installs)
- Drift detection and reporting

**Phase 4 — Linux + systemd**
- systemd --user driver
- Linux workload manifests
- CI target expansion

**Phase 5 — Operator UX**
- `seed workload list / install / remove / status` CLI
- Workload status in `seed status` dashboard output

**Phase 6 — Harden**
- Secret handling
- Dependency ordering enforcement
- Rollback flow
- User vs system scope

After Phase 1, `seed-memory` can deploy to ren1. After Phase 2, `fleet-router` and `mlx-server` can deploy to ren3 — closing the loop that prompted this design.
