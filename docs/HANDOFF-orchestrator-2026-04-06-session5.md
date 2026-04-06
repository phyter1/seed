# Orchestrator Handoff — Seed Fleet (Session 5)

**Date:** 2026-04-06
**From:** Orchestration cycle — 3 PRs merged, 1 release deployed, 0 open issues remaining
**Prior orchestrator handoff:** `docs/HANDOFF-orchestrator-2026-04-06-session4.md`
**Active working handoff:** `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`

This is for the next **orchestrator** (not a worker). Audit state, plan scope, write worker prompts, review worker output. Workers execute against written prompts.

---

## Current fleet state (verified 2026-04-06)

| Machine | Agent | CP | Workloads |
|---|---|---|---|
| ren1 | 0.5.0 | — | memory@0.4.10 (loaded) |
| ren2 | 0.5.0 | 0.5.0 | — |
| ren3 | 0.5.0 | — | fleet-router@1.3.0 (loaded, mlx-vlm runtime), fleet-topology@0.1.0 (static) |

Main at `e5f8f25`, in sync with origin, working tree clean. CI gate active on 3 packages with zero-skip guard. All tests passing (310 in fleet/control, 104 in memory, 40 in inference/router). Gitleaks hooks active.

**v0.5.0 is deployed.** Port-fencing, launchd exit 5 idempotency, and `process.kill-by-port` action are live. The `workload declare` CLI command and bun workspaces are in main but are build/CLI-only changes — they don't require a fleet deploy to be usable (CLI updates were rolled as part of v0.5.0).

**ren2 is macOS** (Intel Mac, not Linux). All three machines run launchd.

---

## What this session accomplished

### PRs merged (3)

1. **#54** — `feat: add bun workspaces for transitive file: dep resolution` — Root `package.json` with `workspaces: ["packages/*", "packages/*/*"]`. Eliminates the fragile conditional pre-install CI hack from #42. Root `bun install` resolves all `file:` deps transitively. Also fixed router's tsconfig (`"types": ["bun-types"]` → `"types": ["bun"]`) to handle workspace hoisting on CI.
2. **#55** — `feat(fleet): add workload declare CLI command` — Two modes: set mode (`seed fleet workload declare <id> --machine <m> --version <v> --artifact-url <url> [--env K=V ...]`) fetches existing declarations, replaces-or-appends by id, PUTs merged list. List mode (`seed fleet workload declare --machine <m>`) prints current declarations. Added `apiPut` helper. 13 tests with DI for testability.
3. **#56** — `docs: audit and update README to match current state (EPIC-009)` — Fixed stale architecture tree (added `packages/memory/`, expanded fleet and inference sub-packages with `(planned)` markers), rewrote Fleet/Inference/Skills descriptions, added Memory subsection, fixed launchd/systemd claim, clarified Quick Start.

### Release deployed (1)

- **v0.5.0** tagged at `d30e84f`, release CI passed, rolled to all three machines via `seed fleet release`. Includes PRs #50-53 from session 4 (port-fencing, launchd exit 5, zero-skip CI, kill-by-port action).

### Open issues: 0

---

## Lessons learned

**1. Workspace hoisting catches you on CI, not locally.**
PR #54 passed all local tests but failed CI because Bun workspaces hoist `devDependencies` to root `node_modules/`. The router's `tsconfig.json` had `"types": ["bun-types"]` (referencing the package name directly) instead of `"types": ["bun"]` (using the `@types/bun` resolution path). Every other package already used `"bun"`. One-line fix. Lesson: after structural build changes, verify CI before merging — local state masks hoisting behavior.

**2. DI makes CLI commands testable.**
PR #55 exported `parseWorkloadDeclareArgs` and `runWorkloadDeclare` with injectable `get`/`put`/`log` functions. 13 tests cover arg parsing and business logic without needing a real control plane. Same pattern as `isPortDeclared` and `fencePort` from session 4 — extract logic, inject dependencies, test independently.

**3. README drift is invisible until you audit.**
The README described fleet as "git-based sync and SSH" and didn't mention the memory service at all. Both are production systems. Quick fix, high visibility. Worth doing periodically.

---

## Open work (ordered by leverage)

### Investigation tracks (unfiled, recommended next)

| Item | Source | Notes |
|---|---|---|
| **vec0 PK root cause** | GAPS §1.1, session 4 backlog | try/catch papering over sqlite-vec PK errors in memory service. Needs dedicated investigation with real ingestion traffic to reproduce. Bleeding slowly — not urgent but accumulating call-site fan-out. |
| **Fleet CLI bootstrap (GAPS §1.5)** | GAPS §1.5, session 4 backlog | CLI broken on non-CP hosts — no config file, no token. Running `seed status` on ren1 or ren3 fails. Blocks CLI-based skills (§1.6). Investigation first: what exactly fails, what's the minimal fix. |

### Structural (unfiled, from GAPS doc and prior handoffs)

| Item | Source | Scope | Notes |
|---|---|---|---|
| **Artifact `--stage` flag on `workload install`** | Session 3 backlog | Small-medium | No built-in way to serve/stage an artifact. Today: manual `python3 -m http.server`. |
| **EPIC-001: Canonical filesystem contract** | GAPS §2.1 | Large | Split-brain between root-level identity files and `packages/core/` templates. Blocks EPICs 002, 006, 009 (009 now done). |

### Operational debt (unfiled, from GAPS doc)

| Item | Source | Severity | Notes |
|---|---|---|---|
| **Installer self-cleanup** | GAPS §1.4b/c | Low (GC exists) | Retroactive `workload.gc` action works. Installer doesn't self-clean temp artifacts after extraction. |
| **Telemetry observability gap** | Session 3 backlog | Low | `/v1/audit` is command-events only. No API for inference telemetry. |
| **Standalone `seed.config.json` workload** | GAPS §1.2 | Medium | Fleet topology coupled to router releases. Config should have its own lifecycle. |
| **Sensitivity classifier not wired** | GAPS §1.7 | Medium | `@seed/sensitivity` exists, passes tests, but nothing consults it before dispatch. |

### Architectural drift (unfiled, from GAPS doc)

| Item | Source | Notes |
|---|---|---|
| **Heartbeat divergence** | GAPS §2.2 | existential heartbeat and seed heartbeat have diverged. Decision pending on which is canonical. |
| **Skills bifurcation** | GAPS §2.3 | 9 migrated to `packages/skills/`, 33+ still Claude-only in `.claude/skills/`. No render/sync pipeline. |
| **Boot spec not source of truth** | GAPS §2.4 | `BOOT.md` exists but `CLAUDE.md` is still the actual boot artifact. No render pipeline. |
| **Fleet skills use SSH** | GAPS §1.6 | Skills should wrap CLI, not SSH. Blocked by §1.5 (CLI broken on remote). |

### Documentation debt

| Item | Source | Notes |
|---|---|---|
| **Cross-platform sqlite-vec build** | GAPS §3.3 | Workaround exists, not documented in README or build script. |
| **Architecture doc stale** | GAPS §3.2 | Doesn't explain host/provider split or current package topology. |
| **Backlog DAG stale** | GAPS §3.4 | EPICs 003/006 shipped without 001; dependency graph doesn't reflect reality. |

### Items resolved across sessions 4-5 (do not re-file)

| Item | Resolution |
|---|---|
| Installer port-fencing (#48) | PR #50 (session 4) |
| Installer launchd exit 5 (#43) | PR #51 (session 4) |
| Zero-skip CI guard | PR #52 (session 4) |
| process.kill-by-port action (#49) | PR #53 (session 4) |
| Workspace deps refactor (#42) | PR #54 (session 5) |
| `workload declare` CLI command | PR #55 (session 5) |
| EPIC-009: README audit | PR #56 (session 5) |
| v0.5.0 release + deploy | Tagged and rolled (session 5) |

---

## Recommended tracks for next session

1. **Investigation: vec0 PK root cause** — The try/catch in memory is accumulating call-site fan-out. Dedicated session with real ingestion traffic to reproduce. Diagnosis only — file issues, don't fix in the same session.

2. **Investigation: Fleet CLI bootstrap (GAPS §1.5)** — CLI fails on non-CP hosts. Unblocks CLI-based skills (§1.6), makes `seed status` work from any machine. Investigation first: what exactly fails, what's the minimal bootstrap.

3. **Artifact `--stage` flag** — Quality-of-life for workload deployment. Today requires manual `python3 -m http.server`. Small-medium scope.

4. **Sensitivity classifier wiring (GAPS §1.7)** — `@seed/sensitivity` passes tests but nothing uses it. Wire it into the router's dispatch path.

5. **Architecture doc refresh (GAPS §3.2)** — Doc doesn't explain host/provider split or current package topology. Similar to the README audit but deeper.

---

## Conventions reinforced this session

- **Worker prompts are inline**, numbered steps, explicit rules block.
- **Read the actual source before writing prompts.** Don't describe code from handoff memory — read it fresh, cite real lines.
- **Stage by explicit path, never `git add -A` / `git add .`.**
- **No Claude/AI mention in commits, PRs, or issues.**
- **Workers leave handoff-append uncommitted. Orchestrator commits.**
- **Investigation gate before implementation.** Both remaining tracks are investigation-first.
- **Verify CI after structural build changes.** Workspace hoisting broke CI despite local tests passing.
- **Extract testable utilities with DI.** CLI commands, agent handlers — same pattern.

---

## Key files for next orchestrator

- This handoff: `docs/HANDOFF-orchestrator-2026-04-06-session5.md`
- Prior handoff: `docs/HANDOFF-orchestrator-2026-04-06-session4.md`
- Active working handoff: `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`
- Full gaps inventory: `docs/GAPS-2026-04-05.md` (audit against current state before acting — some items are now resolved)
- CLAUDE.md: project conventions, architecture, commands
- `packages/fleet/control/src/cli.ts` — CLI with new `workload declare` command
- `packages/memory/src/` — memory service (vec0 PK investigation target)
- `package.json` (root) — Bun workspaces config

Don't start without confirming direction with Ryan.
