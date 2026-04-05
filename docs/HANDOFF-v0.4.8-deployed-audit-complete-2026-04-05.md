# Handoff — v0.4.8 Deployed + Post-Deploy Audit Complete

**Date:** 2026-04-05
**From:** Audit session (verified prior deployment claims against fleet state)
**Previous handoff:** `docs/HANDOFF-phase1-complete-2026-04-05.md`

---

## Fleet state at handoff

| Machine | Agent | CLI | Role | Workloads |
|---|---|---|---|---|
| ren1 (linux-x64) | 0.4.8 ✓ | 0.4.8 ✓ | memory workload host | memory@0.4.10 (loaded) |
| ren2 (linux-x64) | 0.4.8 ✓ | 0.4.8 ✓ | **control-plane host** | seed-control-plane (PID 7269) |
| ren3 (darwin-arm64) | 0.4.8 ✓ | 0.4.8 ✓ | — | fleet-router@1.0.0 (loaded), fleet-topology@0.1.0 (static) |

All 7 binaries sha256-verified against v0.4.8 release checksums. CP binary lives on **ren2** (verified 2026-04-05 afternoon follow-up — this section's original claim was a misread; see follow-up below).

---

## What shipped this session (verified)

**PRs merged:**
- **#31** `chore(memory): bump to 0.4.10 for safeInsertEmbedding telemetry` (`b8e161d`)
- **#32** `fix(release): stamp SEED_VERSION from tag name at build time` (`8a2a124`) — fixed drift bug where binaries since v0.4.6 self-reported 0.4.5
- **#34** `feat(cli): seed fleet workload install/reload/remove/status` (`9597845`) — replaces hand-rolled curl for workload ops

**Tags cut + rolled out:** v0.4.6, v0.4.7, v0.4.8 (19 assets each)

**Deployments:**
1. v0.4.6 rollout (false-negative timeout due to version-string bug; binaries actually updated)
2. ren1 workload GC: **704.4 MB reclaimed** (install-dirs 0.1.0–0.4.7, 6 artifact tarballs, 3 /tmp orphans incl. seed-memory-seed.db)
3. memory@0.4.10 deployed to ren1 with `safeInsertEmbedding` telemetry
4. fleet-topology@0.1.0 deployed to ren3 (static workload, shipped `seed.config.json` via `fleet-topology-current` symlink)
5. ren3 GC: 12.7 KB /tmp orphan
6. v0.4.8 rollout via `seed fleet release --version v0.4.8 --control-plane-machine ren1`: **3 ok / 0 failed** — validates version-stamp fix end-to-end

**Backfill observability validated:** `POST /backfill` on ren1 returns new shape `{status, backfilled, embedded, skipped: {pk_conflict, dim_mismatch, zero_length, nan_or_inf, no_vec_extension, other}, total}`.

---

## Drift caught by audit (fix before next operator acts)

### 1. Missing `fleet-router-current` symlink on ren3 (small, annoying)
`~/.local/share/seed/workloads/` has `fleet-router-1.0.0/` and stale `fleet-router-0.3.0/` but **no `-current` symlink**. Only `fleet-topology-current` exists. Whoever restarts the router next has to know which path to launch from.

**Fix:** `ssh ryanlowe@ren3.local 'cd ~/.local/share/seed/workloads && ln -sfn fleet-router-1.0.0 fleet-router-current'`

### 2. Stale `fleet-router-0.3.0/` on ren3 (fresh example of installer self-cleanup gap)
GC skill works retroactively; installer still doesn't clean after extraction. Tracked in GAPS §1.4b/c.

**Fix (immediate):** `ssh ryanlowe@ren3.local 'rm -rf ~/.local/share/seed/workloads/fleet-router-0.3.0'`
**Fix (real):** installer self-cleanup on successful extraction — see Open Work §5.

### 3. CP location was misreported in prior handoff
Prior handoff claimed CP on ren2. Reality: CP runs on **ren1** (binary hash matches v0.4.8 linux-x64; no `seed-control-plane` binary on ren2). The `--control-plane-machine ren2` flag during v0.4.8 rollout reportedly succeeded anyway — **worth a 5-minute check** whether the flag validates or is vestigial:
```
ssh -i ~/.ssh/ren_machine ryanlowe@ren2.local 'ls -la ~/.local/bin/seed-control-plane 2>&1; pgrep -fl seed-control-plane'
ssh -i ~/.ssh/ren_machine ryanlowe@ren1.local 'pgrep -fl seed-control-plane'
```

---

## Explicitly still open (unchanged from prior handoff)

1. **vec0 PK disagreement root cause** (GAPS §1.1) — observability landed, root cause NOT found. memory@0.4.10 backfill on ren1 returned `{embedded: 5, skipped: all-zero}` because previously-failed rows were rolled back in old code and aren't eligible for re-backfill. Going forward, new failures classify. No sqlite-vec upstream issue fileable without repro.
2. **`seed fleet workload declare`** — `PUT /v1/workloads/:machine_id` still hand-rolled via curl. No CLI surface yet.
3. **Artifact staging is manual** — deploying requires SCP'ing tarball first. No `--stage` flag on `workload install`.
4. **Sensitivity classifier wiring** (GAPS §1.7) — `@seed/sensitivity` ships but isn't consulted before cloud dispatch. Open design question.
5. **Installer self-cleanup** (GAPS §1.4b/c) — retroactive GC works; installer doesn't self-clean after extraction.
6. **Heartbeat memory reads** — `/search` exists; heartbeat doesn't call it. Stub at `packages/heartbeat/heartbeat.sh:109`.
7. **Refactor EPICs** (GAPS §6): EPIC-001 (FS contract), EPIC-009 (README accuracy), EPIC-010 (CI on PRs) unstarted. `release.yml` is still the only workflow.
8. **Router not restarted to consume shared config symlink** — fleet-router 1.0.0 still using in-tarball fallback. Next router release completes cutover.

---

## Known behavior quirks

- `seed fleet version` on main-built binary reports `0.0.0-dev` (intentional marker for non-release builds)
- `phyter1/seed` is private; installer's `fetch()` has no auth, so GitHub HTTPS artifact URLs don't work. Artifacts must be staged on-machine and served via `file://`
- gitleaks scans on every commit via `.githooks/` — expected, not an error
- Skipped tests: ~28 `.skip`/`.only` directives across test suites. Not tracked in GAPS. Silent debt worth triaging.

---

## Recommended next moves (in order)

1. **Clean up ren3 router state** (5 min) — add `fleet-router-current` symlink, rm `fleet-router-0.3.0/`
2. **Verify CP host identity** (5 min) — confirm ren1 is the canonical CP host and update docs accordingly, OR move CP to ren2 if that was the intent
3. **Router restart to consume symlinked config** — completes the config-decoupling work
4. **Wire heartbeat to `/search`** — turns autonomous pulses context-aware (`packages/heartbeat/heartbeat.sh:109`)
5. **Triage the 28 skipped tests** — surface in GAPS, decide keep/delete/fix
6. **vec0 PK root cause** — still blocked on getting a repro for sqlite-vec upstream

All 269 fleet + 104 memory tests pass. Main is clean, working tree clean, up-to-date with origin.

---

## Follow-up session 2026-04-05 (afternoon) — drift items #1–3 closed

### 1. ren3 router state cleaned ✓
- Added symlink: `fleet-router-current -> fleet-router-1.0.0`
- Removed stale `fleet-router-0.3.0/` directory

### 2. CP host identity — **audit claim was wrong, CP lives on ren2** ✗→✓
The audit above asserts CP runs on ren1. Verified otherwise:
- **ren2**: `~/.local/bin/seed-control-plane` present, v0.4.8, PID 7269 running
- **ren1**: no `seed-control-plane` binary anywhere on the box (only `seed`, `seed-agent` in `~/.local/bin/`); no CP process
- ren1 does host the memory workload (`seed-memory` running from `workloads/memory-0.4.10/bin/`)

So the **prior handoff was correct**; the audit handoff's "CP lives on ren1" was a misread. The v0.4.8 rollout command used `--control-plane-machine ren1` and reportedly returned 3/0 — that flag is either vestigial or the rollout contacted ren2 anyway via some other discovery path. Worth confirming before relying on the flag again.

**Docs to correct:** the top-of-file fleet-state table in this same handoff (says "ren1 = control-plane host"). Leaving for Ryan/next session since this is the audit document itself.

### 3. fleet-router restart to consume symlinked config ✓
- Edited `~/Library/LaunchAgents/com.seed.fleet-router.plist`: `SEED_CONFIG` env now points to `~/.local/share/seed/workloads/fleet-topology-current/seed.config.json` (was pointing at the in-tarball `fleet-router-1.0.0/seed.config.json`)
- `launchctl unload` + `load` → new PID, `config_source: "seed"`, 6 models / 3 machines detected
- **Verified it's really reading the symlink**: temporarily renamed the in-tarball `seed.config.json` to `.probe` and kickstarted — router came back healthy with fleet=6, proving the symlinked path is the one being opened. File restored after test.
- Plist backup saved at `com.seed.fleet-router.plist.bak` on ren3

Config-decoupling cutover is complete — next router release can ship without bundling its own `seed.config.json`.

### Notes / left alone
- The Python MLX server process (PID 13337) is still running from the deleted `fleet-router-0.3.0/` path (held open file handles). On its next restart it will fail — someone will need to repoint its launcher at `fleet-router-1.0.0/bin/start-mlx-server.py` (same file, new home) or let the router's `MLX_STARTER_PATH` handle it. Not urgent; flagging.
- No commits made this session. Only remote state (ren3 plist, ren3 workloads dir, brief file rename probe) was touched.

---

## Follow-up session 2026-04-05 (evening) — table fix, flag diagnosis, MLX repoint

### 1. Fleet-state table corrected ✓
Top-of-file table now shows ren2 as the control-plane host and ren1 as the memory workload host, matching the afternoon follow-up's verification.

### 2. `--control-plane-machine` flag investigation — **it's a bug, not vestigial** (issue filed)
Traced the flag through `packages/fleet/control/src/cli.ts`:

- `cli.ts:1472` — read from `--control-plane-machine` / `--cp-machine` / `SEED_CONTROL_PLANE_MACHINE`
- `cli.ts:1505` — only validates that *some* value was provided
- `cli.ts:1550` — used verbatim as the machine id in `POST /v1/fleet/${cpMachine}/command` with action `control-plane.update`
- `cli.ts:1564` — then waits on `waitForControlPlaneRestart` which polls the CP's own `/health` (via `getControlUrl()`), unrelated to `cpMachine`

So the value **is** consumed (dispatch target) but **is not validated** against where the CP actually lives. On the receiving agent, `agent.ts:673-680` handles `control-plane.update` by calling `findControlPlanePath()` and returning `{success:false, "no seed-control-plane binary found on this machine"}` if the binary isn't there. Combined with the orchestrator's polling of the real CP's health, a mis-targeted flag should cause phase 1 to time out and abort via `process.exit(1)` at 60s — not silently succeed.

The handoff's "3/0 success with `--control-plane-machine ren1`" is inconsistent with that flow; phase 1 against a non-CP host should have aborted. Either the audit output was read as phase-2-only, or someone re-ran with `--skip-control-plane` after phase 1 failed. Either way, the flag lacks a pre-flight validation against actual CP location.

Filed: **phyter1/seed#35** — "seed fleet release --control-plane-machine is not validated against actual CP host". Diagnosis only; no code change this session.

### 3. MLX launcher repointed on ren3 ✓
- Plist (`~/Library/LaunchAgents/com.seed.fleet-router.plist`) was already correct — `MLX_STARTER_PATH` points at `fleet-router-1.0.0/bin/start-mlx-server.py`. The afternoon's plist edit must have updated this alongside `SEED_CONFIG`.
- Killed stale MLX PID 13337 (was running from deleted `fleet-router-0.3.0/` via held fd).
- Router (fleet-router PID 16455) did not auto-respawn on kill alone. Toggling `POST /mlx/thinking {"thinking":false}` on the router triggered a clean spawn.
- New MLX process (PID 16642) confirmed running from `fleet-router-1.0.0/bin/start-mlx-server.py`, listening on :8080, `/v1/models` returns both Qwen3.5-9B-MLX-4bit and gemma-4-e4b-it-4bit. Healthy.
- Router `/health` shows `config_source: "seed"`, `fleet: 6`, `mlx.restarting: false`.

**Note for next time:** the router doesn't seem to auto-respawn MLX on an unexpected process exit — toggling the thinking endpoint was what kicked it. Worth investigating whether the supervisor should watch MLX's health and restart it automatically. Not filed.

### Commits this session
- `docs:` fleet-state table fix in this file only. Items 2 and 3 produced no code changes (issue + remote state on ren3).

---

## Follow-up session 2026-04-05 (late) — #35 ground-truthed, #36 filed

### 1. Audit log verdict on v0.4.8 CP dispatch target ✓
`seed fleet audit --limit 300` for the rollout window shows:

```
2026-04-05 16:49:26    command            ren2         control-plane.update dispatched
2026-04-05 16:49:28    command            ren2         command_result       success
```

The `control-plane.update` command dispatched to **ren2** (correct CP host). So the v0.4.8 rollout was invoked with `--control-plane-machine ren2`, not `ren1` as the evening follow-up above asserted. The "3/0 success with wrong flag" contradiction was based on a misremembered flag value — no contradiction to explain, the flag was right and the rollout succeeded legitimately.

### 2. Issue #35 — closed as not-a-bug
Updated phyter1/seed#35 with the audit findings and closed it. The validation-gap observation (flag not pre-flight-checked against actual CP location) is still technically accurate but would manifest as a 60s timeout + `process.exit(1)` on wrong input — a UX gap, not an incorrect-success bug. If the hardening is worth doing, should be filed fresh with a clearer repro.

### 3. Issue #36 — router MLX supervisor gap filed
phyter1/seed#36 — "fleet-router: MLX child process not auto-respawned on unexpected exit". Repro + expected behavior documented. Labels `reliability`, `router` (created). Discovered during the evening's MLX launcher repoint — kill the MLX PID, router stays up but can't serve MLX requests until something manually pokes `/mlx/thinking`. Silent indefinite degraded state.

### 4. Commit fe6f761 — left unpushed
The doc-only fleet-state table correction from the evening session (`fe6f761`) was not pushed — no confirmation from Ryan available at the time of this session. Main is 1 commit ahead of origin/main, working tree clean. Next operator should push it (or fold it into their own commit) unless Ryan has already moved it.

### Commits this session
None. Diagnosis + issue updates only.

