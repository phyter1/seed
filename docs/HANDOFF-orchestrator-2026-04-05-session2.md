# Orchestrator Handoff — Seed Fleet (Session 2)

**Date:** 2026-04-05 (later session)
**From:** Orchestration cycle — 5 workers dispatched, 4 PRs shipped, 3 issues filed, 1 phantom backlog item retired
**Prior orchestrator handoff:** `docs/HANDOFF-orchestrator-2026-04-05.md`
**Active working handoff:** `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`

This is for the next **orchestrator** (not a worker). Audit state, plan scope, write worker prompts, review worker output. Workers execute against written prompts.

---

## Current fleet state (verified 2026-04-05)

| Machine | Agent | CLI | Role | Workloads |
|---|---|---|---|---|
| ren1 (linux-x64) | 0.4.8 | 0.4.8 | — | memory@0.4.10 (loaded) |
| ren2 (linux-x64) | 0.4.8 | 0.4.8 | **control-plane host** (PID 7269) | — |
| ren3 (darwin-arm64) | 0.4.8 | 0.4.8 | — | fleet-router@1.2.0 (loaded, mlx-vlm runtime, MLX-supervised), fleet-topology@0.1.0 (static) |

Main at `2ec0d1d`, in sync with origin, working tree clean. CI gate active on 3 packages. All tests passing. Gitleaks hooks active.

**ren3 MLX runtime:** `mlx-vlm` (replaced `mlx-lm` this session). One process serves all three fleet models: Qwen3.5-9B-MLX-4bit, gemma-4-e2b-it-4bit, gemma-4-e4b-it-4bit. Thinking-mode controlled per-request via `enable_thinking` body field; default OFF.

---

## What this session accomplished

**PRs merged (4, all clean through the new CI gate):**

1. **#40** — `ci: add test workflow for PRs (EPIC-010)` (`eae8e0c`). Matrix over `packages/fleet/control` + `packages/memory`, bun install → tsc → bun test. EPIC-010 closed.
2. **#41** — `fix(router): wait for port release before MLX respawn (#38)` (`871d05a`). TCP connect-probe on :8080 before spawn, 5s cap. New supervisor state field `lastPortWaitMs`. `fleet-router@1.1.1` deployed to ren3. #38 closed.
3. **#42** — `ci: add router package to test matrix` (`1fdc241`). Third matrix entry for `packages/inference/router`. Surfaced transitive `file:` dep resolution gap — worked around with conditional pre-install step for jury + utils.
4. **#44** — `feat(router): migrate MLX runtime from mlx-lm to mlx-vlm (1.2.0)` (`8487456`). Runtime swap, telemetry field migration (internal only), `enable_thinking` moved from restart-toggle to per-request. `fleet-router@1.2.0` deployed to ren3.

**Issues filed (3):**

- **#43** — installer treats `launchctl bootstrap` exit 5 as hard-failure when service is already loaded. Cites `supervisors/launchd.ts:48-63, 80-84` and `workload-installer.ts:640-641`.
- **#45** — workload upgrade can leave detached child from prior version running (zombie runtime). Exposed during PR #44's deploy — the dying v1.1.1 router's mlx-lm child survived and v1.2.0 silently proxied to it.
- **#46** — OTLP telemetry key rename (`tokens_prompt`/`tokens_completion` → `tokens_input`/`tokens_output`). Cross-package: 7 router emit sites, 1 normalizer, 5+2 tests, 1 doc. Not schema-bound in fleet/control.

**Audit docs:**

- `docs/SKIPPED-TESTS-AUDIT-2026-04-05.md` — formal audit. **Zero skipped tests in the repo.** The "~28 skipped tests" claim carried through multiple prior handoffs was never true (git log confirms the directives were never added/removed). Claim retired.

---

## Lessons learned (for next orchestrator)

**1. Claims drift through handoffs. Verify numbers before passing them forward.**
The "28 skipped tests" appeared in the prior audit handoff, got inherited by the first orchestrator handoff, got inherited by my session's worker prompts — at no point did anyone grep. The actual number was zero. When a handoff cites a specific count or fact, spend 30 seconds ground-truthing it before building plans on it. The prior orchestrator handoff had the same lesson from a different incident (CP location, flag values) — this is a pattern.

**2. Worker scope discipline held, including when the worker had to reverse a scope decision.**
PR #44's worker hit a real conflict: the prompt said "rename OTLP keys" AND "don't touch anything outside `packages/inference/router/`". Renaming the wire keys would have silently regressed control-plane token counts. Worker kept the internal rename, adapted at emit sites, flagged the follow-up in the handoff. That's the behavior I want — sensible judgment within scope, clear escalation of what was deferred. Keep writing prompts that allow for this.

**3. Runtime upgrades can silently preserve the old runtime.**
PR #44's zombie-runtime surprise is a real bug class (#45). When v1.1.1's router died, its detached MLX child survived; v1.2.0 came up, probed `:8080`, got a 200, and happily proxied to the *old* mlx-lm. Clients saw mlx-lm's field shape across an "upgrade" that health-checked green. Any workload with detached children can leak old-binary behavior across upgrades. Worth thinking about before the next runtime-swap PR.

**4. Cross-package contracts aren't always obvious.**
The OTLP key names `tokens_prompt`/`tokens_completion` live in router emit sites AND `normalizer.ts:251-252` AND tests in both packages. Renaming them locally would have regressed the control-plane contract. If I'd grepped harder up front I'd have caught it and written a cross-package prompt from the start. Lesson: before scoping a rename to a single package, grep the wider repo for the string.

**5. Transitive `file:` deps don't resolve on cold runners.**
Router → jury → inference-utils. Bun's install doesn't recurse into symlinked workspaces. #42's workaround is a conditional pre-install step; a real fix is a bun-workspaces setup or a root-level install. Watch for this when adding more packages to CI.

**6. Don't commit the handoff-append from a worker prompt unless you mean to.**
Task 3 worker in this session committed its handoff append directly to main ("doc-only changes can go to main" is in conventions). But when I wrote "append a follow-up" I expected it uncommitted — the orchestrator owns when those land. I tightened the prompt explicitly for Tasks 2 and 3 by adding "do NOT commit or push the handoff append." Keep that line in.

---

## Open work (ordered by leverage, not urgency)

**Filed issues ready for pickup:**

- **#43** (installer exit 5 false-negative) — small scope, file:line citations in place. Fix: probe `launchctl print gui/<uid>/<label>` before treating exit 5 as hard-failure, or widen the idempotency check beyond `launchctl list`.
- **#45** (zombie runtime on upgrade) — needs design decision (installer preinstall-hook vs supervisor identity-probe). Diagnosis complete.
- **#46** (OTLP key rename) — cross-package atomic PR. Router + normalizer + tests in both packages + 1 doc. Not schema-bound. Good candidate for the first **cross-package** PR through the CI gate.

**Structural:**

- **Workspace deps (new from #42)** — transitive `file:` resolution via pre-install hacks is fragile. Bun workspaces or a root-level install would fix it properly. Becomes more urgent if more packages join CI.
- **EPIC-009: README accuracy** — 131 lines, unaudited vs v0.4.x state.
- **EPIC-001: Canonical filesystem contract** — gap between root-level identity files and `packages/core/` scaffolding. Unprioritized, still unresolved.

**Small wins:**

- **Zero-skip CI guard** — grep-based workflow step to lock in the zero-skipped-tests invariant. Suggested by the audit worker. Tiny PR.

**Load-bearing operational debt:**

- **vec0 PK disagreement** (GAPS §1.1) — observability landed in memory@0.4.10; root cause unresolved, no repro. Needs dedicated investigation session with real ingestion traffic.
- **Installer self-cleanup** (GAPS §1.4b/c) — retroactive GC works; installer doesn't self-clean after extraction.
- **Fleet CLI bootstrap on remote machines** (GAPS §1.5) — CLI unusable from non-CP hosts.

**CLI surface gaps:**

- `seed fleet workload declare` — `PUT /v1/workloads/:machine_id` still hand-rolled curl.
- Artifact `--stage` flag on `workload install` — manual SCP required for every deploy.

**Wiring gaps (design first):**

- Sensitivity classifier → router pre-dispatch (GAPS §1.7).
- Heartbeat → `/search` (stub at `packages/heartbeat/heartbeat.sh:109`).

**Router follow-ups from #44:**

- `fleet-router@1.2.0` artifact only exists locally on orchestrator machine + on ren3. GitHub Releases for router artifacts is still deferred.
- mlx-vlm requires `torch` + `torchvision` on any machine running it. Today that's ren3 only. Document when a second machine runs MLX.

---

## Conventions reinforced this session

- **Worker prompts are inline**, numbered steps, explicit rules block.
- **Scope boundary explicit + an escape hatch**: "stop and ask rather than improvise" + "if X, report and stop, don't restructure."
- **Diagnosis-only is a valid worker task** (PRs #45, #46, #43 plus skipped-test audit).
- **Every worker appends to the active handoff doc.** Orchestrator decides when to commit.
- **Stage by explicit path, never `git add -A` / `git add .`** (from user memory).
- **No Claude/generation mention in commits, PRs, or issues.**
- **Doc-only changes to main are allowed** — but scope it in the prompt. Default: worker leaves handoff-append uncommitted, orchestrator commits.
- **Investigation gate before implementation** when a fact is unknown (see PR #44 prompt's "Step 1 — Investigation gate").

---

## Next session recommendations

If Ryan wants **cross-package practice**: **#46 (OTLP key rename)**. First atomic cross-package PR through the CI gate. Clean scope, fully cataloged, not schema-bound.

If Ryan wants **operational polish**: **#43 (installer exit 5)**. Small, scoped, file:line citations in place. Direct fix to the false-negative observed during PR #44's deploy.

If Ryan wants **structural work**: **workspace deps refactor**. Closes the transitive `file:` dep gap and removes the #42 pre-install hack.

If Ryan wants **a tiny win**: **zero-skip CI guard**. One workflow step. Locks in the zero-skipped-tests invariant discovered in the audit.

If Ryan wants **design work**: **#45 (zombie runtime)** needs a design decision before implementation. Preinstall-hook vs supervisor identity-probe. Short research session first, then implementation.

If Ryan wants **investigation**: **vec0 PK root cause**. Still blocked on getting a real-traffic repro.

Don't start without confirming direction. The backlog has more than enough for several sessions; picking the wrong thing wastes a cycle.
