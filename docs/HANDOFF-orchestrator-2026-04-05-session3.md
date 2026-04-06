# Orchestrator Handoff — Seed Fleet (Session 3)

**Date:** 2026-04-05 (evening session)
**From:** Orchestration cycle — 1 PR merged, 1 release shipped, 1 production deploy completed, 2 issues filed, 1 doc fix, 1 planned feature cancelled after investigation
**Prior orchestrator handoff:** `docs/HANDOFF-orchestrator-2026-04-05-session2.md`
**Active working handoff:** `docs/HANDOFF-v0.4.8-deployed-audit-complete-2026-04-05.md`

This is for the next **orchestrator** (not a worker). Audit state, plan scope, write worker prompts, review worker output. Workers execute against written prompts.

---

## Current fleet state (verified 2026-04-05 post-deploy)

| Machine | Agent | CP | Workloads |
|---|---|---|---|
| ren1 | 0.4.9 | — | memory@0.4.10 (loaded) |
| ren2 | 0.4.9 | 0.4.9 | — |
| ren3 | 0.4.9 | — | fleet-router@1.3.0 (loaded, mlx-vlm runtime), fleet-topology@0.1.0 (static) |

Main at `46bb82d`, in sync with origin, working tree clean. CI gate active on 3 packages. All tests passing. Gitleaks hooks active.

**ren2 is macOS** (Intel Mac, not Linux). Prior handoffs labeled it `linux-x64` — that's the binary target name, not the OS. Evidence: XPC_SERVICE_NAME, launchd auth socket, /opt/homebrew in PATH. launchctl is the correct supervisor on all three machines.

**ren3 MLX runtime:** `mlx-vlm` — one process serves Qwen3.5-9B-MLX-4bit, gemma-4-e2b-it-4bit, gemma-4-e4b-it-4bit. Thinking-mode controlled per-request via `enable_thinking` body field; default OFF.

---

## What this session accomplished

### PR merged (1)

- **#47** — `refactor(telemetry): rename OTLP keys tokens_prompt/completion → input/output (#46)` (`5aa2397`). Cross-package atomic rename: router emitters + control-plane normalizer + tests in both packages + 1 doc. Router bumped 1.2.0 → 1.3.0 (wire contract change). Closes #46.

### Release shipped (1)

- **v0.4.9** — tagged at `c1bc947`, release CI green, all binaries published to GitHub Releases. Contains the OTLP rename + the doc fix below.

### Production deploy (1)

- **Full-tier roll to v0.4.9** via `seed fleet release --version v0.4.9 --control-plane-machine ren2`. CP + all 3 agents + CLIs updated. No SSH.
- **fleet-router@1.3.0** deployed to ren3 via HTTP-served artifact from operator laptop + `seed fleet workload install`. Router artifact served over `python3 -m http.server 8765` on ryan-air's LAN IP — the `fetchArtifact()` function in `workload-installer.ts` supports `http://` URLs despite the comment header claiming "file:// only."

### Zombie runtime — #45 reproduced live

The router 1.2→1.3 upgrade triggered the exact failure class from #45. The old 1.2 process was a detached child not owned by the launchd label. `workload install` completed clean (artifact fetched, plist updated, label loaded) but 1.3 never started — old process held port 3000. `workload reload` also failed (bootout/bootstrap cycled the label but had no handle on the zombie). Required manual SSH kill: `lsof -ti :3000 | xargs kill`. After kill, launchd auto-started 1.3 via KeepAlive.

### Issues filed (2)

- **#48** — `fleet: installer should fence port before supervisor swap during workload upgrade`. Pre-bootstrap port check: extract port from workload env, `lsof -ti :<port>`, kill if held by non-incoming process, fail loudly if still held after timeout. Prevents the zombie class.
- **#49** — `fleet: add process.kill-by-port agent action for zombie cleanup`. Port-scoped kill action in ACTION_WHITELIST — in-band remediation when #48's prevention fails. Lower priority than #48.

### Doc fix (1)

- **`87a4fad`** — replaced two stale SSH CP-upgrade instructions in CLAUDE.md with `seed fleet upgrade-cp` / `seed fleet release` commands. Also fixed a `git add -A` in the release workflow section (contradicted operator policy of staging by explicit path).

### Feature cancelled after investigation (1)

- **"CP direct-self-update REST endpoint"** — originally scoped as the main deliverable (Option B: build CLI command before deploying). Worker investigation discovered `seed fleet upgrade-cp` (PR #24) and `seed fleet release` (PR #25) already ship the agent-mediated CP upgrade. The SSH gap was a documentation problem, not a code problem. Feature cancelled, doc fix shipped instead, deploy proceeded with existing tooling.

---

## Lessons learned (for next orchestrator)

**1. Claims drift through handoffs — STILL. Verify before planning.**
This session's biggest waste was planning a feature (direct CP-self-update endpoint) that was already shipped. The stale CLAUDE.md said "SSH required for CP upgrade" — nobody grepped the CLI. Session 2's lesson #1 was literally "verify numbers before passing them forward." Same pattern, different shape.

**2. Grep the CLI surface before planning a deploy or operational runbook.**
`seed fleet --help` would have revealed `upgrade-cp`, `release`, and `workload install/reload/remove/status` — all of which exist and work. The orchestrator (me) wrote a manual SSH+curl runbook when CLI commands already existed for most of it.

**3. The env var name is asymmetric: `OPERATOR_TOKEN` (server-side) vs `SEED_OPERATOR_TOKEN` (CLI-side).**
Same value, different names depending on context. The CLI reads from `SEED_OPERATOR_TOKEN` env or `~/.config/seed-fleet/cli.json`. The CP process reads `OPERATOR_TOKEN`. Worker correctly stopped when the stated var name didn't match the running process. `seed fleet config` shows the configured token state.

**4. ren2 is macOS, not Linux.** All three machines are Macs running launchd. The `linux-x64` label in prior handoffs refers to the seed binary target (Intel Mac runs darwin-x64 or linux-x64 binaries under Rosetta or native), not the actual OS. Don't write "ren2 is Linux" in worker prompts.

**5. `fetchArtifact()` supports http:// — use it.** The code at `workload-installer.ts:58-71` handles `file://`, `http://`, and `https://` URLs. The comment header and prior docs said "file:// only (Phase 2 for HTTPS)" — the comment is wrong, the code is right. HTTP-served artifacts from the operator's LAN are a viable deploy path today, no SCP needed.

**6. Zombie runtime is a confirmed, reproducible bug class.** Not a one-off from the mlx-lm migration. #48 (port-fencing) prevents it; #49 (kill-by-port action) remediates it. Until #48 ships, any workload upgrade where the running process is a detached child will zombie.

**7. `/v1/audit` doesn't surface inference telemetry.** Can't verify wire-contract changes (like the OTLP rename) through the audit API. Monitoring gap — inference events flow somewhere else (or nowhere observable via API).

**8. SSH key `~/.ssh/ren_machine` doesn't exist on ryan-air.** SSH to fleet machines works via ssh-agent with the default `id_ed25519` key. Don't specify `-i ~/.ssh/ren_machine` in worker prompts — it warns and falls back.

---

## Open work (ordered by leverage)

**Filed issues ready for pickup:**

- **#48** (installer port-fencing) — **HIGH LEVERAGE**. Prevents the zombie class we just hit live. Scope: pre-bootstrap check in workload-installer.ts. Extract port from workload env, lsof, conditional kill, fail-loud.
- **#49** (process.kill-by-port action) — lower priority if #48 ships. In-band fallback for when prevention fails. New ACTION_WHITELIST entry + agent handler.
- **#43** (installer exit 5 false-negative) — small scope, file:line citations in place.
- **#45** (zombie runtime — original issue) — now has two concrete fix paths (#48, #49). Can be closed once both are addressed, or updated to reference them.

**Structural:**

- **Workspace deps (from #42)** — transitive `file:` resolution via pre-install hacks. Bun workspaces or root-level install.
- **EPIC-009: README accuracy** — 131 lines, unaudited vs v0.4.x state.
- **EPIC-001: Canonical filesystem contract** — unprioritized.

**Small wins:**

- **Zero-skip CI guard** — one workflow step. Locks in the zero-skipped-tests invariant.
- **Fix stale comment in `workload-installer.ts:55-56`** — says "file:// only" but code supports http:// and https://. One-line comment fix.

**Operational debt:**

- **vec0 PK disagreement** (GAPS §1.1) — still needs dedicated investigation with real ingestion traffic.
- **Installer self-cleanup** (GAPS §1.4b/c) — retroactive GC works; installer doesn't self-clean after extraction.
- **Fleet CLI bootstrap on remote machines** (GAPS §1.5) — CLI unusable from non-CP hosts.
- **Telemetry observability gap** — no API endpoint to query inference telemetry events. `/v1/audit` is command-events only. Can't verify OTLP wire changes end-to-end without log access.

**CLI surface gaps:**

- `seed fleet workload declare` — workload declarations are still hand-rolled `curl PUT /v1/workloads/:machine_id`.
- Artifact `--stage` flag on `workload install` — no built-in way to serve/stage an artifact. Today: manual HTTP server on operator LAN.

**Router follow-ups:**

- `fleet-router@1.3.0` artifact only exists locally on ryan-air + on ren3. GitHub Releases for router artifacts still deferred.
- mlx-vlm requires `torch` + `torchvision` on any machine running it. Document when a second machine runs MLX.

---

## Conventions reinforced this session

- **Worker prompts are inline**, numbered steps, explicit rules block, investigation gates where design is uncertain.
- **Investigation gate pattern works.** The CP-self-update worker stopped at gate, reported the existing `upgrade-cp`, saved a full feature PR cycle. Keep using gates.
- **Stage by explicit path, never `git add -A` / `git add .`** (from user memory — also now fixed in CLAUDE.md's release workflow section).
- **No Claude/AI mention in commits, PRs, or issues.**
- **Workers leave handoff-append uncommitted.** Orchestrator commits.
- **Verify claims before building on them.** Third session in a row where this lesson applied.
- **Deploy workers should not SSH to fleet machines.** All ops flow through `seed` CLI + REST API. SSH only as operator last-resort (zombie kill).

---

## Next session recommendations

If the next orchestrator wants **immediate leverage**: **#48 (installer port-fencing)**. This prevents the bug class that just bit us in production. Clean scope: one file (`workload-installer.ts`), one pre-bootstrap check, testable. The reproduction evidence from this deploy session is fresh context.

If they want **operational polish**: **#43 (installer exit 5)**. Still small, still scoped, citations still valid.

If they want **structural**: **workspace deps refactor** or **workload declare CLI command** (both close tooling gaps that forced manual curl during this session's deploy).

If they want **a tiny win**: fix the stale "file:// only" comment in `workload-installer.ts` + the zero-skip CI guard. Two one-line PRs.

If they want **investigation**: **telemetry observability gap** — figure out where inference OTLP events actually land and whether they're queryable. Or **vec0 PK root cause**.

Don't start without confirming direction.
