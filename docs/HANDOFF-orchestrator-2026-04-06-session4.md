# Orchestrator Handoff — Seed Fleet (Session 4)

**Date:** 2026-04-06
**From:** Orchestration cycle — 4 PRs merged, 4 issues closed, 0 open issues remaining
**Prior orchestrator handoff:** `docs/HANDOFF-orchestrator-2026-04-05-session3.md`
**Active working handoff:** `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`

This is for the next **orchestrator** (not a worker). Audit state, plan scope, write worker prompts, review worker output. Workers execute against written prompts.

---

## Current fleet state (verified 2026-04-06)

| Machine | Agent | CP | Workloads |
|---|---|---|---|
| ren1 | 0.4.9 | — | memory@0.4.10 (loaded) |
| ren2 | 0.4.9 | 0.4.9 | — |
| ren3 | 0.4.9 | — | fleet-router@1.3.0 (loaded, mlx-vlm runtime), fleet-topology@0.1.0 (static) |

Main at `6e55bb3`, in sync with origin, working tree clean. CI gate active on 3 packages with zero-skip guard. All tests passing (297 in fleet/control, 104 in memory). Gitleaks hooks active.

**Note:** Code is at v0.5.0 (package.json + version.ts bumped in PR #53 for the new ACTION_WHITELIST entry), but fleet machines are still running v0.4.9 binaries. A release + deploy is needed to roll the new `process.kill-by-port` action to the fleet. The port-fencing (#50) and launchd exit 5 fix (#51) are also in-tree but not deployed.

**ren2 is macOS** (Intel Mac, not Linux). All three machines run launchd.

---

## What this session accomplished

### PRs merged (4)

1. **#50** — `fix(fleet): fence port before supervisor swap during workload upgrade (#48)` — `fencePort()` function in workload-installer.ts. Uses lsof to find zombie PIDs, kills them, polls for port release. Integrated between plist write and supervisor swap. Closes #48.
2. **#51** — `fix(fleet): treat launchctl bootstrap exit 5 as idempotent when service is in-domain (#43)` — Private `isInDomain()` helper using `launchctl print` (broader visibility than `list` during transitions). Closes #43.
3. **#52** — `ci: add zero-skip guard to test workflow` — Test step now captures output and greps for bun's `N skip` line. Fails CI if any `.skip`/`.todo` tests slip in.
4. **#53** — `feat(fleet): add process.kill-by-port agent action (#49)` — New ACTION_WHITELIST entry + agent handler. Security-gated: port must be declared in a workload's env. Extracted `isPortDeclared()` utility. Version bump to 0.5.0. Closes #49.

### Issues closed (4)

- **#43** — installer exit 5 false-negative (PR #51)
- **#45** — zombie runtime parent issue (closed with comment: both fix paths shipped via #48/#49)
- **#48** — installer port-fencing (PR #50)
- **#49** — process.kill-by-port action (PR #53)

### Open issues: 0

The entire reliability backlog from the v0.4.9 deploy cycle is resolved.

---

## Lessons learned

**1. Well-scoped worker prompts with file:line citations produce clean PRs.**
All four PRs merged without revision. The key: read the actual source code before writing the prompt, include the exact function signatures and test patterns, and cite real line numbers. Don't describe the code from memory — read it fresh.

**2. Bundle tiny wins into the workflow.**
The zero-skip CI guard (PR #52) took one worker cycle and locks in an invariant permanently. Worth doing between larger items rather than deferring indefinitely.

**3. Extract testable utilities from agent handlers.**
The agent's `handleCommand` dispatch is deeply integrated with WebSocket state and makes unit testing hard. Extracting `isPortDeclared()` into workload-installer.ts made it independently testable. Same pattern worked for `fencePort()` in PR #50. Future agent actions should follow this: logic in a utility, handler calls the utility.

**4. version.ts ships as `"0.0.0-dev"` — the release workflow stamps it.**
PR #53 set it to `"0.5.0"` directly. This means local dev builds now report v0.5.0 instead of dev. Non-breaking (release workflow overwrites it at tag time) but worth noting. Future version bumps should only touch `package.json` and let the release workflow handle `version.ts`.

---

## Open work (ordered by leverage)

### Needs a release + deploy

Code has shipped to main but fleet machines are on v0.4.9. Before the new features are live:

```bash
# When ready:
# 1. If version.ts already reads "0.5.0", just tag:
git tag -a v0.5.0 -m "v0.5.0 — port-fencing, launchd idempotency, kill-by-port action"
git push origin v0.5.0
# 2. Watch CI, then roll:
seed self-update
seed fleet release --version v0.5.0 --control-plane-machine ren2
```

This is an operator decision, not a worker task. Ryan picks the timing.

### Structural (unfiled, from GAPS doc and prior handoffs)

| Item | Source | Scope | Notes |
|---|---|---|---|
| **Workspace deps refactor** | GAPS via #42 | Medium | Transitive `file:` dep resolution uses a CI pre-install hack. Bun workspaces or root-level install would fix properly. More urgent as packages grow. |
| **`seed fleet workload declare` CLI command** | Session 3 backlog | Medium | Declarations are still hand-rolled `curl PUT`. CLI command would match the rest of the fleet surface. |
| **Artifact `--stage` flag on `workload install`** | Session 3 backlog | Small-medium | No built-in way to serve/stage an artifact. Today: manual `python3 -m http.server`. |
| **EPIC-009: README accuracy** | GAPS §3.1 | Small | 130 lines, unaudited vs current state. References files that don't exist at root. |
| **EPIC-001: Canonical filesystem contract** | GAPS §2.1 | Large | Split-brain between root-level identity files and `packages/core/` templates. Blocks EPICs 002, 006, 009. |

### Operational debt (unfiled, from GAPS doc)

| Item | Source | Severity | Notes |
|---|---|---|---|
| **vec0 PK disagreement** | GAPS §1.1 | Bleeding slowly | try/catch papering over sqlite-vec PK errors. Needs dedicated investigation with real ingestion traffic. |
| **Installer self-cleanup** | GAPS §1.4b/c | Low (GC exists) | Retroactive `workload.gc` action works. Installer doesn't self-clean temp artifacts after extraction. |
| **Fleet CLI bootstrap on remote machines** | GAPS §1.5 | Medium | CLI broken on non-CP hosts — no config, no token. Blocks §1.6 (CLI-based skills). |
| **Telemetry observability gap** | Session 3 backlog | Low | `/v1/audit` is command-events only. No API for inference telemetry. Can't verify OTLP changes end-to-end. |
| **Standalone `seed.config.json` workload** | GAPS §1.2 | Medium | Fleet topology coupled to router releases. Config should have its own lifecycle. |
| **Sensitivity classifier not wired** | GAPS §1.7 | Medium | `@seed/sensitivity` exists, passes tests, but nothing in router/jury consults it before dispatch. |

### Architectural drift (unfiled, from GAPS doc)

| Item | Source | Notes |
|---|---|---|
| **Heartbeat divergence** | GAPS §2.2 | existential heartbeat and seed heartbeat have diverged. Decision pending on which is canonical. |
| **Skills bifurcation** | GAPS §2.3 | 9 migrated to `packages/skills/`, 33 still Claude-only in `.claude/skills/`. No render/sync pipeline. |
| **Boot spec not source of truth** | GAPS §2.4 | `BOOT.md` exists but `CLAUDE.md` is still the actual boot artifact. No render pipeline. |
| **Fleet skills use SSH** | GAPS §1.6 | Skills should wrap CLI, not SSH. Blocked by §1.5 (CLI broken on remote). |

### Documentation debt

| Item | Source | Notes |
|---|---|---|
| **Cross-platform sqlite-vec build** | GAPS §3.3 | Workaround exists, not documented in README or build script. |
| **Architecture doc stale** | GAPS §3.2 | Doesn't explain host/provider split or current package topology. |
| **Backlog DAG stale** | GAPS §3.4 | EPICs 003/006 shipped without 001; dependency graph doesn't reflect reality. |

### Items already resolved (do not re-file)

| Item | Resolution |
|---|---|
| GAPS §1.3 — installer launchd re-bootstrap | Fixed in workload-installer.ts (unload/load sequence exists since v0.4.x) |
| GAPS §1.4a — install-dir GC | `pruneOldInstalls()` + `workload.gc` action exist |
| GAPS §4.3 — CI on PRs | PR #40 (EPIC-010), plus zero-skip guard in PR #52 |
| Stale "file:// only" comment | Fixed in PR #50 |
| SSH CP-upgrade instructions in CLAUDE.md | Fixed in `87a4fad` |
| `git add -A` in CLAUDE.md release workflow | Fixed in `87a4fad` |

---

## Recommended tracks for next session

1. **Release + deploy v0.5.0** — Roll the 3 reliability fixes + kill-by-port action to the fleet. One command once tagged. Quick win to get code into production.

2. **Workspace deps refactor** — Eliminates the fragile pre-install CI hack from #42. Becomes more urgent with each new package. Medium scope.

3. **`workload declare` CLI command** — Closes the last manual-curl gap in the fleet operations surface. Medium scope, well-patterned (follow existing CLI commands).

4. **EPIC-009: README audit** — Quick documentation pass. High visibility, low risk.

5. **Investigation: vec0 PK root cause** — The try/catch in memory is accumulating call-site fan-out. Needs a dedicated session with real ingestion traffic to reproduce.

6. **Investigation: Fleet CLI bootstrap (GAPS §1.5)** — Unblocks CLI-based skills (§1.6) and makes the CLI useful from every machine, not just ren2.

---

## Conventions reinforced this session

- **Worker prompts are inline**, numbered steps, explicit rules block.
- **Read the actual source before writing prompts.** Don't describe code from handoff memory — read it fresh, cite real lines.
- **Stage by explicit path, never `git add -A` / `git add .`.**
- **No Claude/AI mention in commits, PRs, or issues.**
- **Workers leave handoff-append uncommitted. Orchestrator commits.**
- **Extract testable utilities from agent handlers** — logic in a utility function, handler calls the utility.
- **Verify claims before building on them.** Fourth session in a row where this lesson applied.

---

## Key files for next orchestrator

- This handoff: `docs/HANDOFF-orchestrator-2026-04-06-session4.md`
- Active working handoff: `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`
- Full gaps inventory: `docs/GAPS-2026-04-05.md` (audit against current state before acting — some items are now resolved)
- CLAUDE.md: project conventions, architecture, commands
- `packages/fleet/control/src/workload-installer.ts` — installer + fencePort + isPortDeclared
- `packages/fleet/control/src/supervisors/launchd.ts` — isInDomain helper
- `packages/fleet/control/src/types.ts` — ACTION_WHITELIST (now includes process.kill-by-port)
- `packages/fleet/control/src/agent.ts` — command handler dispatch

Don't start without confirming direction with Ryan.
