# Handoff — GAPS §1.4 cleanup + §1.1 memory observability + §1.2 fleet-topology

**Date:** 2026-04-05 (afternoon, ryan-air)
**From:** Claude session (ryan-air with Ryan)
**Previous handoff:** `docs/HANDOFF-cli-architecture-and-release-orchestration-2026-04-05.md`

---

## TL;DR

Closed three of the immediate-priority gaps from the prior handoff:
- §1.4 (a/b/c) — retro-cleanup command for dead workload state on fleet machines
- §1.1 — vec insert call-site fan-out + hidden errors (root cause deferred; observability landed)
- §1.2 — fleet topology coupled to router release cadence

Four PRs landed (#26–#29). No fleet state changed — all code is on main, nothing deployed. Cutting v0.4.6 + rolling out via `seed fleet release` is the next step.

---

## What shipped this session

### phyter1/seed#26 — docs(handoff): prior session carry-forward
Committed the CLI-architecture handoff doc that was sitting uncommitted on main.

### phyter1/seed#27 — `seed fleet workload gc`
New `workload.gc` action + `seed fleet workload gc` CLI subcommand. Retro-cleans what PR #22 prevents going forward.

Usage:
```
seed fleet workload gc --machine <id> [--workload <id>]
                       [--keep-prior N] [--include-tmp] [--dry-run]
```

Scope per invocation:
1. **Install-dirs** (§1.4a) — prune `~/.local/share/seed/workloads/${id}-*` not matching `current + keepPrior` most recent
2. **Artifact tarballs** (§1.4b) — prune `~/.local/share/seed/workload-artifacts/${id}-*.tar.gz` not matching a retained install-dir version
3. **`/tmp` orphans** (§1.4c, opt-in via `--include-tmp`) — sweep `${id}-${semver}-*.tar.gz` and `seed-${id}-*.db` from `/tmp`, conservatively pattern-matched with semver prefix

Agent returns structured JSON report; CLI pretty-prints with human-readable byte counts. 23 new tests, 269 → 292 pass baseline for the fleet/control suite once topology tests are counted.

### phyter1/seed#28 — `MemoryDB.safeInsertEmbedding`
Consolidates the three try/catch sites in `backfillEmbeddings` into a single handler that classifies failures into six discrete reasons (`pk_conflict`, `dim_mismatch`, `zero_length`, `nan_or_inf`, `no_vec_extension`, `other`) and logs non-pk skips at warn level.

Does **not** root-cause vec0's PK disagreement. Multiple in-isolation repros (DELETE+re-INSERT, persist-reopen, DROP TABLE cascade, out-of-order PKs, scale test 500 parents × 3 chunks, LEFT JOIN IS NULL against arbitrary id sets) all ran correctly. The bug only manifests on ren1's production corpus.

This pass makes the next production backfill produce the telemetry needed to root-cause — once deployed on ren1, `POST /backfill` returns `{ embedded, skipped: {reason→count}, total }` instead of swallowing errors. Also fixes a silent data-loss bug: the multi-chunk path previously rolled back chunk rows on vec failure; now chunks persist and are eligible for re-embed on the next pass.

104 memory tests pass (+11 from 93 baseline).

### phyter1/seed#29 — `fleet-topology` workload
Decouples seed.config.json from the router release cadence.

Three pieces:
1. **New "static" workload kind** (`manifest.kind: "static"`) — file-drop only: extract, verify checksums, no binary, no supervisor. Installer branches on kind; reconcile + runner handle empty `supervisor_label` correctly; agent handlers for `workload.remove`/`workload.reload` branch appropriately.
2. **`${workloadId}-current` stable symlink** — every successful install (static OR service) atomically updates a symlink to the latest version dir. Lets cross-workload consumers read through a version-independent path.
3. **`@seed/fleet-topology` package** — ships only `seed.config.json` + its manifest. Build script at `packages/fleet/topology/scripts/build-artifact.sh`.

Router's manifest env now: `SEED_CONFIG={{install_root}}/fleet-topology-current/seed.config.json` with `SEED_CONFIG_FALLBACK={{install_dir}}/seed.config.json`. Router's `loadRouterConfig()` falls back to the in-router copy if the shared symlink doesn't exist yet — so new router installs boot even before fleet-topology is installed. 12 new installer/reconcile tests.

---

## Fleet state at handoff

**Unchanged from prior handoff.** ren1 / ren2 / ren3 all on 0.4.5 (agent + CLI), control plane 0.4.5 on ren2. No release cut this session. None of this session's code has been rolled out.

| Machine | Role | Agent | CLI | Status |
|---|---|---|---|---|
| ryan-air | operator | n/a | 0.4.5 | — |
| ren1 | fleet (memory workload) | 0.4.5 | 0.4.5 | connected |
| ren2 | fleet + control plane | 0.4.5 | 0.4.5 | connected, CP at 0.4.5 |
| ren3 | fleet (fleet-router workload) | 0.4.5 | 0.4.5 | connected |

ren1 still carries ~750MB of dead workload state that #27 was built to clean up.

---

## Pending deploys (before any of this session's work takes effect)

### Cut v0.4.6
```
git tag v0.4.6 -m "workload gc + memory observability + static workloads"
git push origin v0.4.6
```
This kicks off the release workflow which builds the seed binaries (agent, cli, control-plane), memory workload, vec0 extensions, and publishes them to GitHub releases.

### Roll out
```
seed fleet release --version v0.4.6 --control-plane-machine ren2
```
This runs the Phase 1 (control plane) + Phase 2 (agents + CLIs) flow from PR #25. Fleet will end up at 0.4.6 with the new `workload.gc` action whitelisted on each agent.

### Retro-clean ren1
```
seed fleet workload gc --machine ren1 --include-tmp --dry-run  # preview
seed fleet workload gc --machine ren1 --include-tmp            # apply
```
Expect ~750MB reclaimed (500MB install-dirs + 192MB artifacts + ~57MB `/tmp` orphans).

### Deploy memory@0.4.10
The memory workload needs to be rebuilt + re-published to pick up `safeInsertEmbedding`. After deploy:
```
curl -X POST http://ren1.local:PORT/backfill | jq
```
Output shape:
```json
{
  "status": "done",
  "backfilled": 770,
  "embedded": 770,
  "skipped": {"pk_conflict": 3, "dim_mismatch": 0, "zero_length": 0, "nan_or_inf": 0, "no_vec_extension": 0, "other": 0},
  "total": 773
}
```
`skipped` tells us the vec0 failure distribution. If `other > 0`, there's a new error class worth investigating. If `pk_conflict` dominates and `dim_mismatch=0`, the vec0-LEFT-JOIN theory is confirmed and the next step is an upstream sqlite-vec issue with a real repro from the ren1 DB.

### Deploy fleet-topology@0.1.0
1. `bash packages/fleet/topology/scripts/build-artifact.sh`
2. Upload the tarballs to wherever the control-plane artifact server expects them (or `file://` stage on ren3 for now)
3. `PUT /v1/workloads/ren3` with the fleet-topology declaration added
4. `workload.install fleet-topology` → `${installRoot}/fleet-topology-current` symlink created on ren3
5. Ship the next router release built with the new manifest env (PR #29's build-artifact.sh changes); router will then consult the shared symlink

Order of 4 vs 5 doesn't matter — the router fallback covers either sequence.

---

## Follow-ups, prioritized

### Immediate

1. **vec0 PK root cause** — still open. Waiting on the telemetry from the deployed memory@0.4.10 backfill. Once `skipped` counts are known, file the upstream sqlite-vec issue with a ren1-derived repro (or deprecate the worry if `pk_conflict=0`).

2. **`seed fleet workload install / reload / remove / status` CLI subcommands.** The agent-side handlers exist; the CLI only exposes `workload gc` today. Operators still have to `curl /v1/workloads/.../install` to kick an install. This is the obvious next CLI gap — and it's the operator-facing surface for deploying fleet-topology from the terminal.

### Near-term

3. **Sensitivity classifier wiring** (§1.7) — `@seed/sensitivity` ships, is not consulted before cloud dispatch in the router. Open design question: fail-hard vs downgrade-to-local on SENSITIVE. Needs a design conversation.
4. **Artifact staging purge + /tmp sweep on install** — PR #22 closes §1.4(a) proactively; §1.4(b) and (c) are closed *retroactively* via `workload gc`, but the install path itself still doesn't clean up after itself. Consider extending the installer to sweep its own artifacts after extraction.
5. **Heartbeat memory reads** — `/search` exists; heartbeat still doesn't consult memory before acting. Commented-out ingest stub at `packages/heartbeat/heartbeat.sh:109`.

### Refactor EPICs (GAPS §6)
- EPIC-001 (canonical FS contract) — still not started, still blocks 002/006/009
- EPIC-009 (README describes files that don't exist) — still not started
- EPIC-010 (CI on PRs) — `release.yml` is still the only workflow

---

## Locked decisions this session

- `seed fleet workload gc` semantics: keep current + keepPrior install-dirs; artifact tarballs follow install-dir retention 1:1; `/tmp` sweep is opt-in and requires semver prefix
- Static workload kind uses an empty `supervisor_label` as the sentinel (not a nullable field) so existing DB schema is unchanged
- `${workloadId}-current` symlink is maintained for **both** static and service workloads — general improvement, not static-only
- `INSTALL_ROOT` template token added for cross-workload path references
- Router keeps a fallback copy of seed.config.json in its own tarball during the transition; will be removed in a follow-up release once fleet-topology is deployed everywhere
- `POST /backfill` response keeps `backfilled` field as a backward-compat alias for `embedded`

---

## Don't touch

- The memory workload's `storeMemory()` transaction atomicity for the **normal ingest path** — it still rolls back on vec failure by design. Only the backfill multi-chunk path was decoupled.
- The router's in-tarball seed.config.json — it's the fallback. Remove in a later release after fleet-topology is confirmed rolled out.
- `kind: "service"` workload behavior — the static branch is additive, service flow is unchanged.

---

## Verification one-liners

```bash
# Tests
( cd packages/fleet/control && bun test )      # 281 pass
( cd packages/memory && bun test )             # 104 pass
( cd packages/inference/router && bun test )   # 16 pass

# Build fleet-topology artifact locally
bash packages/fleet/topology/scripts/build-artifact.sh --targets "darwin-arm64"

# CLI arg check
bun run packages/fleet/control/src/cli.ts fleet workload gc --help || \
  bun run packages/fleet/control/src/cli.ts fleet workload

# Fleet status
seed fleet status
```

---

## Stats

- PRs landed: 4 (#26–#29)
- New tests added: ~46 (GC: 23, memory: 11, topology: 12)
- LOC delta: ~1,750 insertions / ~115 deletions
- Tests passing: fleet/control 281, memory 104, router 16
- Open GAPS items addressed: §1.1 (partial — observability, not root cause), §1.2 (infra landed, deploy pending), §1.4a/b/c (via retro-cleanup tool)
