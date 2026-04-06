# Orchestrator Handoff — Seed Fleet (Session 6)

**Date:** 2026-04-06
**From:** Orchestration cycle — 1 PR merged, 0 open issues remaining
**Prior orchestrator handoff:** `docs/HANDOFF-orchestrator-2026-04-06-session5.md`
**Active working handoff:** `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`

This is for the next **orchestrator** (not a worker). Audit state, plan scope, write worker prompts, review worker output. Workers execute against written prompts.

---

## Current fleet state (verified 2026-04-06)

| Machine | Agent | CP | Workloads |
|---|---|---|---|
| ren1 | 0.5.0 | — | memory@0.4.10 (loaded) |
| ren2 | 0.5.0 | 0.5.0 | — |
| ren3 | 0.5.0 | — | fleet-router@1.3.0 (loaded, mlx-vlm runtime), fleet-topology@0.1.0 (static) |

Main at `0c637b7`, in sync with origin, working tree clean. CI gate active on 3 packages with zero-skip guard. All tests passing (310 in fleet/control, 104 in memory, 40 in inference/router). Gitleaks hooks active.

**v0.5.0 is deployed.** No new release cut this session — the heartbeat memory integration is a package-level change, not a fleet binary change.

**ren2 is macOS** (Intel Mac, not Linux). All three machines run launchd.

---

## What this session accomplished

### PRs merged (1)

1. **#57** — `feat(heartbeat): wire memory service into beat lifecycle` — Three additions to `heartbeat.sh`: (a) memory URL resolution via four-tier cascade (env → config → control plane discovery → fallback), (b) pre-beat recall that queries `/search` + `/memories`, deduplicates, and injects numbered summaries as `## Memory Context` into the prompt, (c) post-beat ingest that diffs journal entries before/after the beat and POSTs new ones to `/ingest`. All three prompt files updated with Memory Context section between Orient and What to do. All memory ops fail open with 5s/10s timeouts.

### Open issues: 0

---

## Lessons learned

**1. The host adapter already existed.**
Session 5's heartbeat analysis said `packages/hosts/src/run-headless.ts` didn't exist. It does — full adapter system with Claude, Codex, and Gemini support, config resolution, and host detection. Ground-truth claims from handoffs before building plans on them.

**2. Memory integration is a shell concern, not a host concern.**
The recall/ingest logic lives in `heartbeat.sh` (the orchestration layer) rather than the host adapter or the prompts themselves. The shell queries memory pre-beat and ingests post-beat; the host adapter doesn't need to know memory exists. Clean separation.

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
| **EPIC-001: Canonical filesystem contract** | GAPS §2.1 | Large | Split-brain between root-level identity files and `packages/core/` templates. Blocks EPICs 002, 006. |

### Operational debt (unfiled, from GAPS doc)

| Item | Source | Severity | Notes |
|---|---|---|---|
| **Sensitivity classifier not wired** | GAPS §1.7 | Medium | `@seed/sensitivity` exists, passes tests, but nothing consults it before dispatch. |
| **Installer self-cleanup** | GAPS §1.4b/c | Low (GC exists) | Retroactive `workload.gc` action works. Installer doesn't self-clean temp artifacts after extraction. |
| **Telemetry observability gap** | Session 3 backlog | Low | `/v1/audit` is command-events only. No API for inference telemetry. |
| **Standalone `seed.config.json` workload** | GAPS §1.2 | Medium | Fleet topology coupled to router releases. Config should have its own lifecycle. |

### Architectural drift (unfiled, from GAPS doc)

| Item | Source | Notes |
|---|---|---|
| **Heartbeat divergence** | GAPS §2.2 | existential heartbeat and seed heartbeat have diverged. Decision pending on which is canonical. Memory integration in seed heartbeat widens the gap. |
| **Skills bifurcation** | GAPS §2.3 | 9 migrated to `packages/skills/`, 33+ still Claude-only in `.claude/skills/`. No render/sync pipeline. |
| **Boot spec not source of truth** | GAPS §2.4 | `BOOT.md` exists but `CLAUDE.md` is still the actual boot artifact. No render pipeline. |
| **Fleet skills use SSH** | GAPS §1.6 | Skills should wrap CLI, not SSH. Blocked by §1.5 (CLI broken on remote). |

### Documentation debt

| Item | Source | Notes |
|---|---|---|
| **Architecture doc refresh** | GAPS §3.2 | Doesn't explain host/provider split or current package topology. |
| **Cross-platform sqlite-vec build** | GAPS §3.3 | Workaround exists, not documented. |
| **Backlog DAG stale** | GAPS §3.4 | EPICs 003/006 shipped without 001; dependency graph doesn't reflect reality. |

### Items resolved across sessions 4-6 (do not re-file)

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
| Heartbeat memory integration | PR #57 (session 6) |

---

## Recommended tracks for next session

1. **Investigation: vec0 PK root cause** — The try/catch in memory is accumulating call-site fan-out. Dedicated session with real ingestion traffic to reproduce. Diagnosis only — file issues, don't fix in the same session.

2. **Investigation: Fleet CLI bootstrap (GAPS §1.5)** — CLI fails on non-CP hosts. Unblocks CLI-based skills (§1.6), makes `seed status` work from any machine. Investigation first: what exactly fails, what's the minimal bootstrap.

3. **Artifact `--stage` flag** — Quality-of-life for workload deployment. Today requires manual `python3 -m http.server`. Small-medium scope.

4. **Sensitivity classifier wiring (GAPS §1.7)** — `@seed/sensitivity` passes tests but nothing uses it. Wire it into the router's dispatch path.

5. **Architecture doc refresh (GAPS §3.2)** — Doc doesn't explain host/provider split or current package topology.

---

## Conventions reinforced this session

- **Worker prompts are inline**, numbered steps, explicit rules block.
- **Read the actual source before writing prompts.** Session 5 handoff claimed the host adapter didn't exist — it did. Always verify.
- **Stage by explicit path, never `git add -A` / `git add .`.**
- **No Claude/AI mention in commits, PRs, or issues.**
- **Workers leave handoff-append uncommitted. Orchestrator commits.**
- **Investigation gate before implementation.** Both top investigation tracks remain investigation-first.
- **Memory is enhancement, not dependency.** The heartbeat memory integration fails open — this pattern should apply to any future memory consumer.

---

## Key files for next orchestrator

- This handoff: `docs/HANDOFF-orchestrator-2026-04-06-session6.md`
- Prior handoff: `docs/HANDOFF-orchestrator-2026-04-06-session5.md`
- Active working handoff: `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`
- Full gaps inventory: `docs/GAPS-2026-04-05.md` (audit against current state before acting — some items are now resolved)
- CLAUDE.md: project conventions, architecture, commands
- `packages/heartbeat/heartbeat.sh` — newly wired memory integration
- `packages/memory/src/` — memory service (vec0 PK investigation target)
- `packages/hosts/src/` — host adapter system (exists and works, three adapters)

Don't start without confirming direction with Ryan.
