# Orchestrator Handoff — Seed Fleet

**Date:** 2026-04-05 (evening)
**From:** Audit/orchestrator session with Ryan
**To:** Next orchestrator session
**Prior handoff:** `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`

This handoff is for the next **orchestrator** (not a worker). The orchestrator audits state, plans scope, writes worker prompts, and reviews worker output. Workers execute discrete bounded tasks against written prompts.

---

## Current fleet state (verified 2026-04-05)

| Machine | Agent | CLI | Role | Workloads |
|---|---|---|---|---|
| ren1 (linux-x64) | 0.4.8 | 0.4.8 | — | memory@0.4.10 (loaded) |
| ren2 (linux-x64) | 0.4.8 | 0.4.8 | **control-plane host** (PID 7269) | — |
| ren3 (darwin-arm64) | 0.4.8 | 0.4.8 | — | fleet-router@1.1.0 (loaded, MLX-supervised), fleet-topology@0.1.0 (static) |

Main at `cbeced9`, in sync with origin, working tree clean. All tests passing. Gitleaks hooks active.

---

## What this session accomplished

Started as an audit, turned into an orchestration cycle. Six worker sessions dispatched, all landed clean:

1. **Audit pass 1** — initial status report on SEED. Too optimistic.
2. **Audit pass 2** — critical re-read, caught skipped tests, stub host adapters, hardcoded config paths, load-bearing vec0 workaround.
3. **Verification pass** — ground-truthed v0.4.8 deployment claims against fleet reality. Caught drift: missing router symlink, stale workload dir, CP host mislabeled.
4. **Worker: drift cleanup** — fixed ren3 symlinks, restarted router on symlinked config, **corrected my CP-location misread** (CP is on ren2, not ren1).
5. **Worker: diagnosis** — traced `--control-plane-machine` flag, filed #35. **Closed as not-a-bug** after audit log showed the original rollout dispatched to ren2 correctly (the handoff misremembered its own flag value).
6. **Worker: MLX repoint** — killed stale MLX PID on ren3, verified new one spawned from fleet-router-1.0.0 path. Flagged lack of auto-recovery as #36.
7. **Worker: doc fixes + issue filing** — corrected fleet-state table (ren2 is CP), filed #36 (MLX supervisor gap).
8. **Worker: implement #36** — shipped MLX supervisor with exponential backoff, failure cap, health-state exposure. 32 unit + 2 E2E tests. Deployed as fleet-router@1.1.0 on ren3, live-verified. PR #37 merged as `1e8568f`.
9. **Worker: branch reconcile + polish** — rebased local main, merged #37, filed #38 (EADDRINUSE race), added router README.

Main is now 4 commits ahead of where this session started.

---

## Lessons learned (for next orchestrator)

**1. Binary presence ≠ running process.**
I verified the CP binary's sha256 on ren1 and chained that into "CP runs on ren1." It doesn't. CP is on ren2. When verifying host identity in the future: always pair `shasum` with `pgrep` or process listing. A binary on disk is just an artifact; a running process is the source of truth.

**2. Don't chain assumptions into bug reports.**
The #35 "bug" was built on a misremembered flag value + my incorrect CP location. Neither was true. The flag worked correctly; the rollout succeeded legitimately. **Validate the foundational facts before diagnosing contradictions.** An audit-log grep would have resolved the whole #35 thread in 30 seconds.

**3. Worker scope held well.**
Every worker this session stopped at scope boundaries. When #35 turned out to be not-a-bug, the worker closed it cleanly rather than refactoring the flag. When the MLX launcher was already correct (afternoon session had pre-fixed it), the worker just killed the stale PID and moved on. The "stop and ask rather than improvise" rule produced good results — keep using it.

**4. I routed work to the wrong repo once.**
Nearly sent a worker to `~/code/ren-jury` for #36 work. The router was **ported to seed** during Phase 1 — canonical source is `packages/inference/router/` in seed. Ryan caught it. For the future: **when referencing "where does X live," grep the current repo first instead of recalling.** The harvest-map doc can help; so can `git log --all --oneline -- <path>`.

**5. No CI on the repo.**
PR #37 merged without automated verification. The MLX supervisor had strong local tests so it wasn't risky, but the fleet repo is shipping v0.4.x releases without any PR gates. EPIC-010 exists for this reason and has been deferred through Phase 1. **This is the next structural work worth prioritizing.**

---

## Open work (ordered by leverage, not urgency)

**Structural / highest leverage:**
- **EPIC-010: CI on PRs** — a minimal `.github/workflows/test.yml` running `bun test` on PRs. One session. Single biggest risk reducer in the backlog.
- **EPIC-009: README accuracy** — `README.md` is 131 lines, last audited as "current" but not verified against v0.4.x state.
- **EPIC-001: Canonical filesystem contract** — backlog §9 documents gap between root-level identity files and `packages/core/` scaffolding. Unprioritized, still unresolved.

**Filed issues ready for pickup:**
- **#38 (port 8080 EADDRINUSE race)** — MLX respawn racing old child for port. Log noise today, could become failure under load. Fix: SIGKILL + `kill -0` poll, or connect-probe on :8080 before spawn. Small scope, implementable in one session.

**Load-bearing operational debt (from GAPS-2026-04-05.md):**
- **vec0 PK disagreement** (§1.1) — observability landed in memory@0.4.10, root cause unresolved, no sqlite-vec repro yet. Needs dedicated investigation session with real ingestion traffic to produce a repro.
- **Workload installer self-cleanup** (§1.4b/c) — retroactive GC works; installer doesn't self-clean after extraction. Fresh example on ren3 (0.3.0 dir) was cleaned manually this session.
- **Fleet CLI bootstrap on remote machines** (§1.5) — CLI unusable from non-CP hosts. Operators fall back to SSH+curl.

**CLI surface gaps:**
- **`seed fleet workload declare`** — `PUT /v1/workloads/:machine_id` still hand-rolled curl
- **Artifact `--stage` flag** on `workload install` — manual SCP required for every deploy

**Wiring gaps (design needed first):**
- **Sensitivity classifier → router pre-dispatch** (GAPS §1.7) — `@seed/sensitivity` ships, not consulted before cloud dispatch
- **Heartbeat → `/search`** — endpoint exists, heartbeat doesn't call it. Stub at `packages/heartbeat/heartbeat.sh:109`

**Test hygiene:**
- **28 skipped tests** not tracked in GAPS. Silent debt. Triage session to decide keep/delete/fix.

**Router follow-ups from #37:**
- Router artifacts are gitignored; fresh installs need `build-artifact.sh` rebuild (documented in new `packages/inference/router/README.md`)
- `fleet-router@1.1.0` artifact only exists locally on orchestrator machine + on ren3

---

## Conventions this session established

- **Worker prompts are inline**, not files. Ryan pastes them into fresh agent contexts.
- **Worker scope is explicit**: numbered list, "do these, stop." Plus a "rules" block.
- **Diagnosis vs. fix separation**: when uncertain about impact, workers diagnose and file issues rather than changing code.
- **Every worker appends a follow-up section** to the active handoff doc before finishing.
- **Stage by explicit path, never `git add -A`** (from user memory — swept up in-flight work historically).
- **No Claude/generation mention in commits, PRs, or issues.**
- **Doc-only changes can be committed directly to main.** Code changes go through PRs.

---

## Next session recommendations

If Ryan wants **structural work**: EPIC-010 (CI on PRs). One session, highest leverage.

If Ryan wants **operational polish**: #38 (EADDRINUSE race). Small, scoped, clean follow-up to #37.

If Ryan wants **investigation**: vec0 PK root cause. Open-ended, needs real traffic to produce a repro.

If Ryan wants **hygiene**: triage the 28 skipped tests.

Don't start without confirming which direction. The backlog has more than enough for several sessions; picking the wrong thing wastes a cycle.
