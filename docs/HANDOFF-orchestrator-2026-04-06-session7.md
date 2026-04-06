# Orchestrator Handoff — Seed Fleet (Session 7)

**Date:** 2026-04-06
**From:** Orchestration cycle — 3 issues filed and closed, 5 tracks shipped
**Prior orchestrator handoff:** `docs/HANDOFF-orchestrator-2026-04-06-session6.md`
**Active working handoff:** `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`

This is for the next **orchestrator** (not a worker). Audit state, plan scope, write worker prompts, review worker output. Workers execute against written prompts.

---

## Current fleet state (verified 2026-04-06)

| Machine | Agent | CP | Workloads |
|---|---|---|---|
| ren1 | 0.5.0 | — | memory@0.4.10 (loaded) |
| ren2 | 0.5.0 | 0.5.0 | — |
| ren3 | 0.5.0 | — | fleet-router@1.3.0 (loaded, mlx-vlm runtime), fleet-topology@0.1.0 (static) |

Main at `44d2394`, in sync with origin, working tree clean. CI gate active on 3 packages with zero-skip guard. **688 tests passing** (up from 454 at session start). Gitleaks hooks active.

**v0.5.0 is still the deployed fleet version.** This session's code changes (memory fixes, CLI config, stage server, sensitivity wiring) are on main but not released. A release cut is recommended — the memory fixes (#59, #60) close a data loss path.

**ren2 is macOS** (Intel Mac, not Linux). All three machines run launchd.

---

## What this session accomplished

### Issues filed and closed (3)

1. **#58** — `CLI config not written by installer — broken on fresh installs` — Fixed: CLI falls back to agent.json for control URL. Installer accepts `--operator-token` and writes cli.json. Config resolution extracted to testable cli-config.ts. 14 new tests.

2. **#59** — `Concurrent backfill PK conflicts` — Fixed: Process-level lock (`_backfillRunning` flag with try/finally) on `backfillEmbeddings()`. Concurrent calls return `{ alreadyRunning: true }`. HTTP endpoint returns 409. 3 new tests.

3. **#60** — `storeMemory transaction rolls back memories row on vec0 failure` — Fixed: Vec INSERT moved outside the transaction, routed through `safeInsertEmbedding()`. Memory row always persisted; vec failure leaves it eligible for backfill. 3 new tests.

### Features shipped (2)

4. **`--stage` flag on workload declare** — Ephemeral single-file HTTP server with LAN IP detection. `seed fleet workload declare memory --machine ren1 --version 0.4.10 --stage ./dist/artifacts/memory-0.4.10-darwin-x64.tar.gz` starts a staging server, rewrites artifact_url, keeps alive until Ctrl-C. No agent-side changes needed. New files: `stage-server.ts`, `stage-server.test.ts`. 23 new tests.

5. **Sensitivity classifier wired into router** — `@seed/sensitivity` now consulted on every request. Sensitivity level passed to jury. Type deduplicated (jury imports from sensitivity package). `locality` field added to ModelEntry for future cloud rerouting. 9 new tests across router and jury.

### Documentation (1)

6. **Architecture doc rewrite** — `docs/architecture.md` rewritten from 134 to 234 lines. Every layer grounded in actual packages. New sections: Package Map, rewritten Fleet (control plane + agents + workloads), rewritten Inference (keyword router, jury, sensitivity), Deployment Model.

### Stats

- 24 files changed, +1,477 / -148 lines
- 234 new tests (454 → 688 total)
- 3 issues opened and closed
- 0 open issues, 0 open PRs

---

## Lessons learned

**1. Investigation-before-fix pays off.**
Tracks 1 and 2 ran as investigation-only workers first. Both found things the handoff didn't predict: the concurrent backfill race was the actual root cause (not a stale PK collision), and the CLI was already fixed operationally. Having the diagnosis before writing fix prompts made the fix workers fast and precise.

**2. Worktrees prevent conflicts on parallel implementation workers.**
Tracks 3, 4, 5 ran in parallel on separate worktree branches. No merge conflicts despite touching overlapping areas (cli.ts, package.json files). This should be the default for any session running 2+ implementation workers.

**3. The handoff doc is getting long.**
`HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md` now has follow-up sections from sessions 4–7. It's still the right place for chronological worker reports, but the orchestrator handoff (this file) is the one to read for state and direction.

---

## Open work (ordered by leverage)

### Deployment (recommended first)

| Item | Notes |
|---|---|
| **Release cut (v0.5.1 or v0.6.0)** | Memory fixes (#59, #60) close a data loss path. CLI config fallback, stage server, and sensitivity wiring are also on main. Worth deploying. |

### Decisions needed

| Item | Source | Notes |
|---|---|---|
| **Heartbeat divergence** | GAPS §2.2 | existential heartbeat and seed heartbeat have diverged. Memory integration (PR #57) widened the gap. Decision: which is canonical? Seed heartbeat has memory wiring; existential heartbeat has Ryan's customizations. |

### Structural (unfiled)

| Item | Source | Scope | Notes |
|---|---|---|---|
| **EPIC-001: Canonical filesystem contract** | GAPS §2.1 | Large | Split-brain between root-level identity files and `packages/core/` templates. Blocks EPICs 002, 006. |
| **Standalone `seed.config.json` workload** | GAPS §1.2 | Medium | Fleet topology coupled to router releases. Config should have its own lifecycle. |

### Operational debt (unfiled)

| Item | Source | Severity | Notes |
|---|---|---|---|
| **Fleet skills use SSH** | GAPS §1.6 | Medium | Should wrap CLI. **Now unblocked** — #58 makes CLI work on all machines. |
| **Skills bifurcation** | GAPS §2.3 | Medium | 9 migrated to `packages/skills/`, 33+ still Claude-only in `.claude/skills/`. No render/sync pipeline. |
| **Boot spec not source of truth** | GAPS §2.4 | Medium | `BOOT.md` exists but `CLAUDE.md` is the actual boot artifact. No render pipeline. |
| **Installer self-cleanup** | GAPS §1.4b/c | Low | Installer doesn't self-clean temp artifacts after extraction. GC exists retroactively. |
| **Telemetry observability gap** | Session 3 backlog | Low | `/v1/audit` is command-events only. No API for inference telemetry. |

### Documentation debt (unfiled)

| Item | Source | Notes |
|---|---|---|
| **Cross-platform sqlite-vec build** | GAPS §3.3 | Workaround exists, not documented. |
| **Backlog DAG stale** | GAPS §3.4 | EPICs 003/006 shipped without 001; dependency graph doesn't reflect reality. |

### Items resolved across sessions 4–7 (do not re-file)

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
| vec0 PK root cause + fix | #59, closed (session 7) |
| storeMemory tx rollback fix | #60, closed (session 7) |
| CLI config bootstrap | #58, closed (session 7) |
| Workload `--stage` flag | Merged (session 7) |
| Sensitivity classifier wiring | Merged (session 7) |
| Architecture doc refresh | Merged (session 7) |

---

## Recommended tracks for next session

1. **Release cut** — Ship what's on main. Memory fixes are the priority. Decide v0.5.1 (patch) or v0.6.0 (minor, given new features).

2. **Fleet skills migration (GAPS §1.6)** — Now unblocked by #58. Rewrite fleet skills to wrap `seed` CLI instead of SSH. Medium scope.

3. **Heartbeat divergence decision** — Not code, just a decision. Which heartbeat is canonical? The answer shapes whether to converge them or let them diverge intentionally.

4. **Skills bifurcation (GAPS §2.3)** — 33+ skills stuck in `.claude/skills/`. Define a render/sync pipeline to packages/skills/.

5. **EPIC-001: Canonical filesystem contract** — Large but foundational. Split-brain between root identity files and packages/core/ templates.

---

## Conventions reinforced this session

- **Worker prompts are inline**, numbered steps, explicit rules block.
- **Worktrees for parallel implementation workers.** Investigation workers can share main if they don't change production code.
- **Investigation gate before implementation.** Tracks 1 and 2 diagnosed before fixing.
- **Read actual source before writing prompts.** Cite real line numbers.
- **Stage by explicit path, never `git add -A` / `git add .`.**
- **No Claude/AI mention in commits, PRs, or issues.**
- **Workers leave handoff-append uncommitted. Orchestrator commits.**
- **TDD for all code changes.** Tests written first, 234 new tests this session.

---

## Key files for next orchestrator

- This handoff: `docs/HANDOFF-orchestrator-2026-04-06-session7.md`
- Prior handoff: `docs/HANDOFF-orchestrator-2026-04-06-session6.md`
- Active working handoff: `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`
- Full gaps inventory: `docs/GAPS-2026-04-05.md` (audit against current state — many items now resolved)
- CLAUDE.md: project conventions, architecture, commands
- New this session:
  - `packages/fleet/control/src/stage-server.ts` — artifact staging server
  - `packages/fleet/control/src/cli-config.ts` — extracted CLI config resolution
  - `packages/inference/router/src/sensitivity-routing.test.ts` — sensitivity wiring tests
  - `packages/memory/scripts/repro-pk-conflict.ts` — vec0 reproduction script

Don't start without confirming direction with Ryan.
