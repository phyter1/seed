# Orchestrator Handoff — Seed Fleet (Session 9)

**Date:** 2026-04-06
**From:** Orchestration cycle — 4 PRs merged (#63-#66), skills render pipeline shipped, full gaps audit completed
**Prior orchestrator handoff:** `docs/HANDOFF-orchestrator-2026-04-06-session8.md`
**Active working handoff:** `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`

This is for the next **orchestrator** (not a worker). Audit state, plan scope, write worker prompts, review worker output. Workers execute against written prompts.

---

## Current fleet state (verified 2026-04-06)

| Machine | Agent | CP | Workloads |
|---|---|---|---|
| ren1 | 0.6.0 | — | memory@0.4.10 (loaded) |
| ren2 | 0.6.0 | 0.6.0 | — |
| ren3 | 0.6.0 | — | fleet-router@1.3.0 (loaded, mlx-vlm runtime), fleet-topology@0.1.0 (static) |

Main at `ed3f7d1`, in sync with origin, working tree clean. CI gate active on 3 packages with zero-skip guard. **711 tests passing** (up from 688 — +23 render pipeline tests). 0 open issues, 0 open PRs. Gitleaks hooks active.

**v0.6.0 is the deployed fleet version.** All code on main is released.

**ren2 is macOS** (Intel Mac, not Linux). All three machines run launchd.

---

## What this session accomplished

### PRs merged (4)

1. **PR #63** — `docs(boot): distill operational patterns into boot contract`
   - Extracted 6 generalizable operational patterns into `packages/core/boot/BOOT.md`: machine awareness (10 lines), model tiering (11 lines), publishing (6 lines), social engagement (11 lines), skills (5 lines), fleet operations (4 lines). Total: 63 lines added.
   - All content host-neutral — no machine names, model names, accounts, or platform specifics.

2. **PR #64** — `refactor(skills): migrate fleet skills to wrap seed CLI`
   - Rewrote `fleet-status` to use `seed fleet status` as primary data source, removing all SSH commands. Supplementary HTTP probes retained for services the CP doesn't monitor.
   - Reframed `fleet-ssh` as an explicit escape hatch with "prefer seed CLI" guidance. Simplified SSH access to uniform `ssh ryanlowe@<host>.local`.
   - Updated `seed` skill with current CLI surface: `upgrade-cp`, `release`, all `workload` subcommands. Fixed stale "no seed fleet release yet" note.

3. **PR #65** — `feat(skills): add render pipeline and migrate fleet-status`
   - Built `packages/skills/render.ts` — host-neutral skill authoring pipeline. Parses abstract capabilities from `skill.md`, maps to Claude Code tools, renders `.claude/skills/<name>/SKILL.md`.
   - Per-skill `claude.json` overrides for fine-grained tool restrictions.
   - 23 tests (56 assertions). `--dry-run` and `--skill <name>` flags.
   - Migrated `fleet-status` as proof of concept — rendered output matches original except for comment header.

4. **PR #66** — `feat(skills): migrate remaining identity skills to render pipeline`
   - Migrated all 8 remaining identity skills: fleet-dns, fleet-inference, fleet-ssh, publish, research, social, voice, wake.
   - 7 of 8 needed `claude.json` overrides (coarse capability mapping doesn't match original tool restrictions exactly). fleet-ssh was the only 1:1 match.
   - All 9 identity skills now flow through the render pipeline.

### Design doc (1)

5. **Skills bifurcation design** — `docs/skills-bifurcation-design.md`
   - Full audit of all 35 skills: 9 identity, 18 pipeline/product, 8 repo-specific.
   - Pipeline design: `packages/skills/<name>/skill.md` (host-neutral) → render script → `.claude/skills/<name>/SKILL.md` (Claude adapter).
   - Decisions made: committed (not gitignored), coarse capabilities + overrides, Claude-only adapter, existential stays manual.

### Full gaps audit (1)

6. **Cross-referenced GAPS-2026-04-05.md against current state.** Found 7 of 17 original gaps resolved across sessions 4-9. Updated EPIC status. Produced prioritized open work list (see below).

---

## Lessons learned

**1. The override rate on capability mapping is high (7/8).**
Coarse capabilities are the right abstraction for routing, but almost every skill needs a `claude.json` to match the original tool restrictions exactly. This is fine — it validates the design (coarse for routing, override for precision). But it means the render script is more "source of truth for body + override for frontmatter" than "automatic frontmatter generation."

**2. GAPS doc drift is significant.**
The GAPS doc from April 5 had 7 items that were already resolved when this session audited it. Planning docs that aren't maintained become phantom claims that waste investigation time. Worth keeping the GAPS doc current after each session.

**3. The skills pipeline shipped end-to-end in one session.**
Render script + proof of concept + full migration in 3 PRs. The design doc upfront (investigation worker) made the implementation workers clean and fast. The pattern works: investigate → design → implement in sequence, not mixed.

---

## GAPS resolution status (comprehensive)

### Resolved (7 of 17)

| GAPS # | Item | Resolved in | How |
|---|---|---|---|
| 1.1 | vec0 PK disagreement | Session 7 | PR #59 — root cause found, per-row try/catch removed |
| 1.3 | Installer launchd re-bootstrap | Session 4 | PR #48 — bootout + bootstrap on plist rewrite |
| 1.4a | Install-dir GC | Session 4 | `workload gc` CLI command |
| 1.5 | CLI broken on fleet machines | Session 7 | PR #58 — config fallback + installer operator token |
| 1.6 | Fleet skills use SSH | Session 9 | PR #64 — rewritten to wrap `seed` CLI |
| 1.6a | Binary distribution / release command | Session 7 | `seed fleet release` exists |
| 4.3 | CI on PRs | Session 4 | 3-package matrix + zero-skip guard |

Plus: Architecture doc (3.2) resolved in session 7.

### Still open (10 of 17 + new items)

See "Open work" section below for the full prioritized list.

---

## EPIC status (updated session 9)

| EPIC | Status | Session 9 change |
|---|---|---|
| 001 Canonical FS contract | Not started | No change. Still foundational. Blocks 002, 009. |
| 002 Host-neutral boot spec | Partial | BOOT.md significantly expanded (PR #63). No BOOT.md → CLAUDE.md render. |
| 003 Host adapter interface | Done | — |
| 004 Provider adapter interface | Done | — |
| 005 Runtime config model | Partial | No change |
| 006 Heartbeat host dispatch | Done | — |
| 007 Host-neutral skills | **Substantially done** | Render pipeline built, all 9 identity skills migrated. CI drift check pending. |
| 008 Setup refactor | Partial | No change |
| 009 Documentation realignment | Partial | Architecture doc done. README blocked by 001. |
| 010 Repo quality + validation | Partial | CI on PRs done. Adapter smoke tests, path validation open. |

---

## Open work (ordered by leverage)

### Tier 1 — High leverage, unblocked

| # | Item | Source | Scope | Notes |
|---|---|---|---|---|
| 1 | **Skills render CI drift detection** | Bifurcation Phase 2 | Small | Add CI step: run `bun run render-skills`, diff against committed adapters, fail if divergent. Completes the pipeline. ~30 min. |
| 2 | **EPIC-001: Canonical filesystem contract** | GAPS 2.1 | Large | Root-level identity files don't exist, templates aren't rendered, README lies. Pick one layout (root canonical, `packages/core/` is template source), implement scaffolding script, update all references. Blocks EPICs 002, 009. ~2 sessions. |
| 3 | **Sensitivity classifier wiring** | GAPS 1.7 | Medium | Classifier + identity profile exist but nothing in router/jury consults them before dispatch. Design question first (fail-hard vs. downgrade-to-local), then implementation. ~1-2 sessions. |

### Tier 2 — Moderate leverage

| # | Item | Source | Scope | Notes |
|---|---|---|---|---|
| 4 | **Standalone `seed.config.json` workload** | GAPS 1.2 | Medium | Decouple fleet topology from router releases. Every topology edit requires router redeploy. |
| 5 | **Artifact staging cleanup** | GAPS 1.4b | Small | Tarballs accumulate unbounded (~74MB/release on ren1). Delete after extraction or GC policy. |
| 6 | **Boot spec → CLAUDE.md render** | GAPS 2.4 | Medium | BOOT.md is substantive but CLAUDE.md is what loads. No automated sync. |
| 7 | **Heartbeat divergence decision** | GAPS 2.2 | Decision | Running heartbeat is existential's. Does seed replace it or do they stay separate? |

### Tier 3 — Low leverage / deferred

| # | Item | Source | Scope | Notes |
|---|---|---|---|---|
| 8 | Adapter smoke tests | GAPS 4.1 | Small | One smoke test per adapter |
| 9 | Path/doc drift CI validation | GAPS 4.2 | Small | CI script checks paths in README exist |
| 10 | Cross-platform sqlite-vec docs | GAPS 3.3 | Small | Document the build workaround |
| 11 | Backlog DAG refresh | GAPS 3.4 | Small | Dependency graph doesn't match reality |
| 12 | Bootstrap `/tmp` orphan cleanup | GAPS 1.4c | Trivial | One-time operator cleanup |
| 13 | Runtime config model (EPIC-005) | GAPS | Medium | No `seed.machine.json`, no JSON schema |
| 14 | Setup refactor (EPIC-008) | GAPS | Medium | `seed.config.example.json` defaults `"claude"` |

### Skills bifurcation — remaining phases

| Phase | Status | Notes |
|---|---|---|
| Phase 0: Render script | **Done** (PR #65) | |
| Phase 1: Migrate identity skills | **Done** (PR #65 + #66) | All 9 migrated |
| Phase 2: CI drift detection | **Open** | Tier 1 item #1 above |
| Phase 3: Cross-repo strategy | **Deferred** | Decision: existential stays manual |
| Phase 4: Second host adapter | **Deferred** | Claude-only for now |

---

## Conventions reinforced this session

- **Worker prompts are inline**, numbered steps, explicit rules block.
- **Worktrees for implementation workers.** Investigation workers can share main.
- **Stage by explicit path, never `git add -A` or `git add .`.**
- **No Claude/AI mention in commits, PRs, or issues.**
- **Workers leave handoff-append uncommitted. Orchestrator commits.**
- **Distillation ≠ migration.** Extract patterns, don't copy content.
- **Investigation → design → implement.** The skills pipeline shipped clean because the design doc came first.
- **TDD for code changes.** Render pipeline had 23 tests before the migration PRs landed.
- **Verify CI after structural build changes.**
- **Version bump is two files:** `version.ts` + `package.json`.

---

## Key files for next orchestrator

- This handoff: `docs/HANDOFF-orchestrator-2026-04-06-session9.md`
- Prior handoff: `docs/HANDOFF-orchestrator-2026-04-06-session8.md`
- Active working handoff: `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`
- Full gaps inventory: `docs/GAPS-2026-04-05.md` (7 of 17 items now resolved — see this handoff for current status)
- Skills bifurcation design: `docs/skills-bifurcation-design.md`
- CLAUDE.md: project conventions, architecture, commands
- Render pipeline: `packages/skills/render.ts` + `packages/skills/render.test.ts`
- Boot contract: `packages/core/boot/BOOT.md`

Don't start without confirming direction with Ryan.
