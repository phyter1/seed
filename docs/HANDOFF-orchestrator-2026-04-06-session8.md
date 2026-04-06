# Orchestrator Handoff — Seed Fleet (Session 8)

**Date:** 2026-04-06
**From:** Orchestration cycle — 2 PRs merged, v0.6.0 released and deployed, existential→seed delta audited
**Prior orchestrator handoff:** `docs/HANDOFF-orchestrator-2026-04-06-session7.md`
**Active working handoff:** `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`

This is for the next **orchestrator** (not a worker). Audit state, plan scope, write worker prompts, review worker output. Workers execute against written prompts.

---

## Current fleet state (verified 2026-04-06)

| Machine | Agent | CP | Workloads |
|---|---|---|---|
| ren1 | 0.6.0 | — | memory@0.4.10 (loaded) |
| ren2 | 0.6.0 | 0.6.0 | — |
| ren3 | 0.6.0 | — | fleet-router@1.3.0 (loaded, mlx-vlm runtime), fleet-topology@0.1.0 (static) |

Main at `a842ccd`, in sync with origin, working tree clean. CI gate active on 3 packages with zero-skip guard. **688 tests passing.** Gitleaks hooks active.

**v0.6.0 is the deployed fleet version.** All code on main is released.

**ren2 is macOS** (Intel Mac, not Linux). All three machines run launchd.

---

## What this session accomplished

### PRs merged (2)

1. **PR #61** — `fix(ci): use workspace protocol instead of file: links`
   - Root cause: `bun install` on Linux hit EEXIST when router/jury packages used `file:../` deps alongside the workspace config — duplicate symlink creation.
   - Fix: Converted `file:../` to `workspace:*` in router and jury `package.json`, removed redundant package-level `bun install` from CI workflow.
   - Unblocked the release.

2. **PR #62** — `feat(core): distill operational patterns into boot contract and templates`
   - Extracted generalizable lessons from the long-running existential instance into seed's scaffolding. 10 files changed, 195 lines added. No instance-specific content.
   - Boot contract (`BOOT.md`): 5 known failure modes (rumination, identity drift, journal bloat, queue starvation, false-green reporting), heartbeat principles section (two tiers, cadence, ordering, anti-patterns).
   - Identity templates: optional voice/research sections in `self.md.template`, epistemic humility in `continuity.md.template`, conviction-vs-principle distinction, status labels in objectives.
   - Journal system: naming conventions, consolidation triggers (every 15-20 entries), experimental subdirectory pattern.
   - Heartbeat prompts: pre-mortem step, inbox-first workflow, verification-before-claiming-shipped rule, social engagement as optional configured behavior. Fixed path bug (referenced `packages/core/identity/self.md` instead of canonical `self.md`).
   - First conversation guide: 4 patterns that work, 4 anti-patterns from experience.

### Release (1)

3. **v0.6.0** — Tagged, built (18 artifacts), deployed across all 3 machines.
   - Includes everything since v0.5.0: memory safety (#59, #60), CLI config (#58), stage server, sensitivity routing, CI fix (#61), template distillation (#62).
   - Fleet roll: CLI self-update → CP (ren2) → agents (ren1, ren2, ren3). Clean, no issues.

### Audit (1)

4. **Existential→seed delta audit** — Comprehensive comparison across 10 categories (identity files, heartbeat, journal, notes, skills, CLAUDE.md, analysis/research, ryan/, engine/tools, other). Key findings:
   - Seed has the infrastructure; existential has the content (150+ journal entries, identity files, analysis, research)
   - All 9 existential skills are already synced to seed
   - Seed's heartbeat architecture is better (host abstraction, 3-tier prompts, memory HTTP integration) but existential's prompts had the operational wisdom → now distilled via PR #62
   - **Decision: seed is canonical.** Existential is the legacy location. Migration is extraction (generalize patterns), not file copying.
   - The identity files, journal entries, and notes are Ren-specific content — they stay with Ren, not with seed's scaffolding

---

## Lessons learned

**1. CI failures on main need immediate attention.**
The `file:` → `workspace:*` issue had been failing on the last two pushes to main before this session caught it. Release was blocked until this was fixed. Lesson: check CI status before planning a release.

**2. Distillation ≠ migration.**
Ryan clarified that the goal is NOT to port existential's content into seed. It's to extract the generalizable patterns so anyone can boot a persistent identity with the same structural advantages. This reframes all remaining existential→seed work.

**3. The pre-mortem pattern is worth watching.**
PR #62 introduced a `Pre-mortem:` step in heartbeat prompts — before starting work, write one line about how this beat could go wrong. Novel structural guardrail. Worth observing whether it actually changes behavior in practice.

---

## Open work (ordered by leverage)

### New from this session

| Item | Source | Scope | Notes |
|---|---|---|---|
| **CLAUDE.md consolidation** | Session 8 audit | Medium | Existential's CLAUDE.md has generalizable operational config (heartbeat modes, fleet awareness patterns, social engagement philosophy) that should be folded into seed's CLAUDE.md or boot docs. Same extraction pattern as PR #62 — generalize, don't copy. |

### Carried from session 7

| Item | Source | Scope | Notes |
|---|---|---|---|
| **Fleet skills migration (GAPS §1.6)** | Session 7 backlog | Medium | Rewrite fleet skills to wrap `seed` CLI instead of SSH. Unblocked since #58. |
| **Skills bifurcation (GAPS §2.3)** | Session 7 backlog | Medium | 33+ skills in `.claude/skills/`, 9 migrated to `packages/skills/`. No render/sync pipeline. |
| **EPIC-001: Canonical filesystem contract** | GAPS §2.1 | Large | Split-brain between root-level identity files and `packages/core/` templates. Blocks EPICs 002, 006. |

### Structural (unfiled, carried)

| Item | Source | Scope | Notes |
|---|---|---|---|
| **Standalone `seed.config.json` workload** | GAPS §1.2 | Medium | Fleet topology coupled to router releases. |
| **Boot spec not source of truth** | GAPS §2.4 | Medium | `BOOT.md` exists but `CLAUDE.md` is the actual boot artifact. No render pipeline. |
| **Installer self-cleanup** | GAPS §1.4b/c | Low | Installer doesn't self-clean temp artifacts. |
| **Telemetry observability gap** | Session 3 backlog | Low | No API for inference telemetry. |

### Documentation debt (unfiled, carried)

| Item | Source | Notes |
|---|---|---|
| **Cross-platform sqlite-vec build** | GAPS §3.3 | Workaround exists, not documented. |
| **Backlog DAG stale** | GAPS §3.4 | Dependency graph doesn't reflect reality. |

---

## Recommended tracks for next session

1. **CLAUDE.md consolidation** — Same extraction pattern as PR #62. Pull generalizable operational wisdom (heartbeat mode docs, fleet awareness, social engagement philosophy, rumination problem context) from existential's CLAUDE.md into seed's docs/boot contract. Medium scope, high leverage for anyone using seed.

2. **Fleet skills migration (GAPS §1.6)** — Rewrite fleet skills to wrap `seed` CLI. Medium scope, now fully unblocked.

3. **Skills bifurcation (GAPS §2.3)** — Define the render/sync pipeline from `.claude/skills/` to `packages/skills/`. The 33+ Claude-only skills need a path to become host-neutral.

4. **EPIC-001: Canonical filesystem contract** — Large but foundational. The boot contract references root-level files, templates live in `packages/core/identity/`, and there's no scaffolding script to generate the layout. PR #62 fixed the path references in heartbeat prompts but the structural split-brain remains.

5. **Memory workload redeploy** — v0.6.0 agents are deployed but `memory@0.4.10` workload was last declared against v0.5.0 agents. Consider re-declaring to verify the new agents handle it correctly. Low risk, quick verification.

---

## Conventions reinforced this session

- **Worker prompts are inline**, numbered steps, explicit rules block.
- **Worktrees for implementation workers.** Investigation workers can share main.
- **Stage by explicit path, never `git add -A` / `git add .`.**
- **No Claude/AI mention in commits, PRs, or issues.**
- **Workers leave handoff-append uncommitted. Orchestrator commits.**
- **Distillation ≠ migration.** Extract patterns, don't copy content.
- **Check CI status before planning releases.**
- **Version bump is two files:** `version.ts` + `package.json`. Release workflow stamps version.ts at build time, but keep it current in source for local dev builds.

---

## Key files for next orchestrator

- This handoff: `docs/HANDOFF-orchestrator-2026-04-06-session8.md`
- Prior handoff: `docs/HANDOFF-orchestrator-2026-04-06-session7.md`
- Active working handoff: `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`
- Full gaps inventory: `docs/GAPS-2026-04-05.md`
- CLAUDE.md: project conventions, architecture, commands
- Existential repo (for reference): `~/code/existential/`
- New this session:
  - Boot contract additions: `packages/core/boot/BOOT.md` (failure modes, heartbeat principles)
  - Template refinements: `packages/core/identity/*.template`, `packages/core/journal/index.md`
  - Heartbeat prompt upgrades: `packages/heartbeat/heartbeat-prompt*.txt`
  - First conversation lessons: `setup/first-conversation.md`

Don't start without confirming direction with Ryan.
