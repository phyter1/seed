# Handoff — fleet-router@1.0.0 Live on ren3, Memory Integration Next

**Date:** 2026-04-05 (afternoon, ryan-air)
**From:** Claude session (ryan-air with Ryan)
**Previous handoff:** `docs/HANDOFF-router-port-smoke-and-workload-build-2026-04-05.md`

---

## TL;DR

`fleet-router@1.0.0` (the #14 jury-port rebuild) is **deployed to ren3 and healthy**. Workload build scaffolding is committed on `main`. The router is now a workload-managed artifact with a compiled bun binary, matching the `@seed/memory` delivery pattern.

No production impact — behaviour-equivalent to pre-#14 except for the expected juror count increase (4 → 5, ren2/qwen3-coder:30b now in fleet).

Next track is **memory integration** — `@seed/memory` is still a data sink with zero reads into prompts/skills/router. Items 1–6 from the previous handoff are now the backlog.

---

## What shipped this session

### Workload build scaffolding for @seed/router (committed: `c858b71`)

- `packages/inference/router/workload/launchd.plist.template` — mirror of memory's, label `com.seed.fleet-router`.
- `packages/inference/router/scripts/build-artifact.sh` — compiles `src/router.ts` into a self-contained bun binary via `bun build --compile --target=bun-darwin-arm64`, stages `bin/fleet-router`, `bin/start-mlx-server.py`, `seed.config.json`, `templates/launchd.plist.template`, writes `manifest.json` with sha256 checksums, tarballs to `dist/artifacts/`.

**Key decision: Option 2 (compiled binary), not Option 1 (JS bundle).**
Self-contained, no bun runtime dependency on target, matches memory pattern.

**Key detail: `import.meta.dir` resolves to `/$bunfs/root` inside compiled bun binaries** — the virtual filesystem. Verified empirically. Consequence: the manifest env must pin every path the router reads via `import.meta.dir` to absolute `{{install_dir}}` paths. Currently pinned:
- `MLX_STARTER_PATH={{install_dir}}/bin/start-mlx-server.py`
- `SEED_CONFIG={{install_dir}}/seed.config.json`

**Key detail: `seed.config.json` is gitignored.** The build script reads `SEED_CONFIG_SRC` env var (defaults to repo-root `seed.config.json`) and fails with a clear error if missing. Pass `SEED_CONFIG_SRC=/path/to/seed.config.json` when building from a worktree.

### Deployed fleet-router@1.0.0 to ren3

Artifact: `file:///Users/ryanlowe/.local/share/seed/workload-artifacts/fleet-router-1.0.0-darwin-arm64.tar.gz`
SHA256: `3f6f142d39eb4180007d9de24d00e80bacbd7f470cf448bfeb98c9339e9226f6`
Control-plane `config_version`: v2 → v3.
Install dir: `~/.local/share/seed/workloads/fleet-router-1.0.0/` on ren3.
launchd label: `com.seed.fleet-router`.
Old `fleet-router-0.3.0/` install dir still present (Phase 1 installer does not GC — known).

**Post-deploy smoke test (against `ren3:3000`):**
- `/health` → `{"status":"ok","router":"rule-based-v1.0","fleet":6,"mlx":{...},"config_source":"seed"}` ✓
- `/v1/jury` non-streaming color query → `"Blue"`, `agreement: 1`, same `_jury` schema as pre-deploy baseline ✓
- SSE stream event sequence (`jury`×2, `juror`×N, `aggregation`×2, `done`×1) identical to baseline ✓
- Juror count 4 → 5 (new ren2/qwen3-coder:30b in fleet — expected, not a regression)

Baselines saved in `/tmp/router-smoke-2/` on ryan-air (may not survive reboot).

---

## Known quirks carried forward

1. **Pre-existing `agreement: 0` on non-streaming math queries.** Surfaced last session, still there. Not introduced by #14 — inherited. `calculateAgreement` handles the word-vs-numeric case inconsistently. Low priority, worth chasing when someone wants to dig into jury aggregation internals.

2. **seed.config.json bundled into router artifact.** Bundling fleet topology into router releases is not ideal. **Decision (Ryan, this session):** control-plane should ship `seed.config.json` as a standalone workload/out-of-band config eventually. Not urgent — no secrets, just hostnames + model IDs — but track it. When that lands, drop `seed.config.json` from the router tarball and remove `SEED_CONFIG` from manifest env (or point it at the out-of-band path).

3. **Workload installer doesn't GC old install dirs.** `fleet-router-0.3.0/` still present on ren3. Known Phase 1 limitation.

---

## Memory system follow-ups (the current backlog)

Carried from previous handoff — `@seed/memory` is a data sink, no integration into inference paths. These are the next track.

1. **Build a `recall` skill** — `.claude/skills/recall/` that hits `http://ren1.local:19888/search?q=...&k=...` and formats top-k results for prompt injection. Mirror the ergonomics of `/recall` in the existential repo but point at `@seed/memory`. **Highest-leverage first bite.**
2. **Heartbeat memory reads** — on boot, heartbeat should recall memories related to recent journal context before acting. Complement the commented-out ingest stub at `packages/heartbeat/heartbeat.sh:109` with a read path.
3. **Router pre-dispatch memory hints** — surface related entities/relationships as routing signals. Speculative; design needed.
4. **Jury challenger seeding** — let the challenge round in `@seed/jury` optionally receive conflicting past memories as priming. Speculative.
5. **Root-cause the vec0 PK disagreement** — memory@0.4.8 papers over with per-row try/catch at every `INSERT INTO vec_memories` call site. Likely requires reading `sqlite-vec` internals (`vec_memories_rowids` table) or filing an upstream issue with a repro.
6. **Cross-platform sqlite-vec install docs** — `packages/memory/scripts/build-binaries.sh` still doesn't document the sqlite-vec install story for linux-x64 targets.

Also now tracked:

7. **Standalone seed.config.json workload** (see "Known quirks" #2) — decouple fleet topology from router releases.
8. **Pre-dispatch sensitivity wiring into router** — follow-up #1 from the pre-previous handoff. Design conversation with Ryan about fail-hard vs. downgrade-to-local semantics on SENSITIVE requests that would otherwise cloud-dispatch.

---

## Locked decisions (unchanged)

From prior handoffs, all still apply:

- Jury package at `packages/inference/jury`, provider-agnostic.
- `ProviderTier = 'local' | 'midtier' | 'frontier'` required on `ProviderDefinition`.
- Challenge round uses pass-through (advisory) semantics by default.
- `Sensitivity:'SENSITIVE'` + `sensitivityLock` caps challenger to local tier.
- `@seed/jury` depends on `@seed/inference-utils` via `file:../utils`.
- Router aggregator prompt stays byte-identical via `makeRouterAggregator` — **do NOT swap in `makeDefaultAggregator` without validation**.
- `vec_memories` INSERTs wrapped in try/catch when iterating (vec0 PK disagreement quirk).
- Router workload build uses `bun build --compile`; absolute paths via env, not `import.meta.dir`.
- seed.config.json shipped as sidecar inside router artifact (interim; to be replaced by standalone workload).
- gitleaks hooks active; bypass only with `--no-verify` when certain.
- No mention of generation or Claude in git commits or PRs.

---

## Don't touch

- Fleet machines without explicit ask.
- The 7 pre-existing worktrees under `.claude/worktrees/` from prior sessions.
- Prior session `docs/HANDOFF-*.md` files — reference, don't modify.

---

## Operator reference: deploying a router rebuild

```bash
# Build (from main worktree):
cd packages/inference/router
bash scripts/build-artifact.sh

# Build (from a different worktree where seed.config.json is absent):
SEED_CONFIG_SRC=/Users/ryanlowe/code/seed/seed.config.json bash scripts/build-artifact.sh

# Stage on ren3:
scp dist/artifacts/fleet-router-1.0.0-darwin-arm64.tar.gz \
  ryanlowe@ren3.local:~/.local/share/seed/workload-artifacts/

# Update declaration + trigger install via control-plane on ren2:
OPERATOR_TOKEN=$(ssh ryanlowe@ren2.local 'plutil -extract EnvironmentVariables.OPERATOR_TOKEN raw ~/Library/LaunchAgents/com.seed.control-plane.plist')
curl -X PUT http://ren2.local:4310/v1/workloads/ren3 \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workloads":[{"id":"fleet-router","version":"1.0.0","artifact_url":"file:///Users/ryanlowe/.local/share/seed/workload-artifacts/fleet-router-1.0.0-darwin-arm64.tar.gz"}]}'
curl -X POST http://ren2.local:4310/v1/workloads/ren3/fleet-router/install \
  -H "Authorization: Bearer $OPERATOR_TOKEN"

# Verify:
curl -s http://ren3.local:3000/health
```

Control-plane workload API lives in `packages/fleet/control/src/server.ts`:
- `GET /v1/workloads/:machine_id` — read current declarations
- `PUT /v1/workloads/:machine_id` — replace declarations (preserves services/models/repos in MachineConfig)
- `POST /v1/workloads/:machine_id/:workload_id/install` — dispatch `workload.install` command to connected agent

---

## Suggested first action for next session

**Build the `/recall` skill** (memory follow-up #1). Highest-leverage first step toward integrating `@seed/memory` into inference paths. Mirror the existing `/recall` ergonomics in the existential repo, but point at `http://ren1.local:19888/search`.

After that, pick from memory follow-ups 2–7 based on what Ryan prioritizes. The sensitivity wiring (#8) is a design conversation, not a directed task — flag it when you have context but wait for a clear ask.
