# Handoff — CLI architecture hardening + release orchestration

**Date:** 2026-04-05 (afternoon, ryan-air)
**From:** Claude session (ryan-air with Ryan)
**Previous handoff:** `docs/HANDOFF-memory-search-and-recall-skill-2026-04-05.md`

---

## TL;DR

Closed the full pull-from-GitHub self-update architecture. All three seed binaries (agent, cli, control-plane) now update via the control plane — no SSH anywhere in the product contract. Added `seed fleet release` as the single-command orchestration. Nine PRs landed (#17–#25). Three releases cut (v0.4.3, v0.4.4, v0.4.5). Fleet fully upgraded to 0.4.5.

Along the way: audited the repo against its 10 refactor EPICs, wrote the first full gaps doc, fixed the CLI bootstrap, migrated skill surface, and ran an audit that uncovered ~838MB of dead workload state on ren1.

---

## What shipped this session

### phyter1/seed#17 — `seed fleet configure` + auth hints
- New subcommand writes `~/.config/seed-fleet/cli.json` (0600, atomic rename, merge semantics)
- Token resolution: env var (`SEED_OPERATOR_TOKEN`) → `cli.json` → unset
- Connection-refused / 401 / 403 errors print actionable hints (URL tried, next steps)
- `SEED_CLI_CONFIG` env var for test/path overrides
- Fixes the bug where `seed fleet status` from ren1/ren3 returned "Fatal: Unable to connect" because the CLI defaulted to `localhost:4310` (CP runs on ren2)

### phyter1/seed#18 — Docs commit
- GAPS-2026-04-05.md (the inventory of load-bearing gaps, architectural drift, documentation drift)
- 4 carried-forward HANDOFF docs that were sitting uncommitted on main

### phyter1/seed#19 — `cli.update` command
- Added `cli.update` to `ACTION_WHITELIST`
- Agent handler calls `runSelfUpdate({binary: "seed-cli"})` against the CLI binary on the same machine
- Extended `seed fleet upgrade` to dispatch `cli.update` after each agent reconnects
- `findCliPath()` scans canonical paths: `~/.local/bin/seed`, `~/.local/bin/seed-cli`, `/usr/local/bin/seed`, `/opt/homebrew/bin/seed`
- `getCliVersion()` reads version by execing the binary with `version`
- Fleet upgrade now propagates both agent + CLI binaries via pull-from-GitHub

### phyter1/seed#20 — `/seed` skill
- `.claude/skills/seed/SKILL.md` wraps the `seed fleet` CLI for Claude sessions
- `allowed-tools: Bash(seed *)` only
- Documents cli.json prerequisite, argument dispatch, and common workflows
- Closes GAPS §1.6 — no more SSH-based fleet-status skill for normal operations

### phyter1/seed#21 — Two-phase upgrade
- Fixed a bug introduced in #19: `seed fleet upgrade` filtered out machines whose agent was already at target, which also skipped `cli.update` for those machines
- Adds a Phase 2 that runs `cli.update` alone on agent-current machines
- Plan output distinguishes `[upgrade]` vs `[cli-only]`
- Observed live when ren1's CLI drifted to 0.4.3 while ren2/ren3 moved to 0.4.4

### phyter1/seed#22 — Workload install-dir GC
- After successful `workload.install`, prune prior install dirs
- `keepPrior` option in `InstallerOptions` (default 1, -1 disables)
- `compareSemver` handles multi-digit versions (0.4.10 > 0.4.9 > 0.4.2)
- Closes GAPS §1.4(a). Does NOT address §1.4(b) (artifact staging purge) or §1.4(c) (/tmp orphans) — those are the operator's input, not the installer's to delete

### phyter1/seed#23 — GAPS §1.4 expanded
- Full audit findings from live inspection of ren1/ren2/ren3
- ~838MB dead state on ren1, three distinct cleanup gaps enumerated
- Notes that binary self-update is verified clean (atomic rename works)

### phyter1/seed#24 — `control-plane.update` + `upgrade-cp`
- Third tier of self-update: the control plane can now update itself
- Agent on the control-plane host pulls seed-control-plane binary, then after a 1s delay runs `launchctl kickstart -k gui/<uid>/<label>` (delay lets the command_result flush over the WebSocket first)
- `seed fleet upgrade-cp --machine <id> [--version <tag>] [--label <label>] [--force]`
- 45s result timeout to cover the WebSocket reconnect window
- Closes GAPS §1.6a item 2

### phyter1/seed#25 — `seed fleet release`
- Single-command orchestration: control plane → agents → CLIs
- Phase 1: control-plane.update, waits for *actual restart* (uptime decrease signal + connection loss, not just "is it responding"), then waits for reconnects
- Phase 2: standard two-pass fleet upgrade
- `SEED_CONTROL_PLANE_MACHINE` env var for defaulting `--control-plane-machine`
- Live-tested: fresh 1.3s uptime after restart, 3 agents reconnect, Phase 2 runs cleanly

---

## Architecture locked

Two principles established and encoded in GAPS §1.6 and §1.6a:

1. **Fleet operations flow through CLI → control plane HTTP API, never SSH.**
   SSH between fleet machines is Ryan's local convenience, not part of Seed's product contract. A Seed deployment on cloud VMs or a mixed-OS fleet cannot assume SSH mesh.

2. **Binary distribution is pull-from-GitHub, never push-via-scp.**
   All three binaries update themselves by downloading platform-matched artifacts from GitHub releases, verifying SHA-256 against `checksums.txt`, and atomic-renaming over the running file. The control plane broadcasts update commands; agents pull.

---

## Fleet state at handoff

| Machine | Role | Agent | CLI | Status |
|---|---|---|---|---|
| ryan-air | operator | n/a | 0.4.5 | — |
| ren1 | fleet (memory workload) | 0.4.5 | 0.4.5 | connected |
| ren2 | fleet + control plane | 0.4.5 | 0.4.5 | connected, CP at 0.4.5 |
| ren3 | fleet (fleet-router workload) | 0.4.5 | 0.4.5 | connected |

Control plane on ren2: `com.seed.control-plane` launchd service, `http://ren2.local:4310`, operator token rotated 2026-04-05.

---

## Known quirks surfaced

### CP whitelist chicken-and-egg on architecture bumps
When a release adds a new action to `ACTION_WHITELIST`, the running control plane rejects the new action until it's upgraded itself. Hit twice this session (cli.update → needed CP at 0.4.4 first; control-plane.update → needed CP at 0.4.5 first). Bootstrap path: download CP binary from GitHub, launchctl restart. One-time cost per whitelist change. Tolerable.

### Control plane restart detection is subtle
Initial draft of `waitForControlPlaneHealth` returned "ok" against the pre-restart CP because the 1s agent-delay + launchctl kickstart hadn't fired yet when the first health poll hit. Fixed to watch for uptime decrease OR connection loss before declaring the restart complete. See `waitForControlPlaneRestart` in cli.ts.

### Workload-artifacts + /tmp aren't the installer's
Workload install-dir GC landed (§1.4a). The remaining two cleanup gaps are:
- `~/.local/share/seed/workload-artifacts/*.tar.gz` — pre-staged tarballs (operator input via file:// URL), not installer's to delete
- `/tmp/memory-0.{1,2}.0-*.tar.gz` + `/tmp/seed-memory-seed.db` on ren1 — pre-v0.4 bootstrap debris, ~57MB

Both would be good candidates for a `seed fleet workload gc` operator subcommand or one-shot cleanup.

---

## Locked decisions

- Self-update uses `runSelfUpdate()` from `packages/fleet/control/src/self-update.ts` — shared by all three binaries, downloads from GitHub releases, SHA-256 verified, atomic rename
- Per-release artifacts: 9 binaries (3 programs × 3 platforms) + `checksums.txt` + vec0 extensions + memory workload tarballs = 19 assets, published via `.github/workflows/release.yml` on v*.*.* tag push
- `cli.json` at `~/.config/seed-fleet/cli.json` is the canonical CLI config location (0600 perms, atomic rename via .tmp + rename)
- Operator token is read from `SEED_OPERATOR_TOKEN` env var (wins) OR `cli.json.operator_token` (fallback)
- Control plane hostname for `upgrade-cp` / `release` defaults to `SEED_CONTROL_PLANE_MACHINE` env var if set
- `keepPrior: 1` is the default workload install-dir retention (current + 1 rollback target)
- Skills shipping from `packages/skills/` are CLI-wrappers only; `.claude/skills/fleet-*` SSH-based skills are legacy, should not ship as part of Seed's public contract

---

## Follow-ups, prioritized

### Immediate (bleeding now, not deferrable much longer)

1. **One-shot cleanup of ren1's dead workload state.** ~500MB install dirs + ~192MB artifacts + ~57MB /tmp orphans = ~750MB reclaimable. PR #22 prevents future accumulation but doesn't retro-clean. Could be a manual ssh+rm OR a `seed fleet workload gc --machine ren1 --dry-run` subcommand.

2. **vec0 PK disagreement in @seed/memory.** Papered over with try/catch at every `INSERT INTO vec_memories` call site. Load-bearing. Requires reading `sqlite-vec` internals or filing upstream issue.

3. **Standalone `seed.config.json` workload.** Fleet topology currently ships as a sidecar inside the router tarball, coupling topology changes to router releases.

### Near-term architectural

4. **Artifact staging purge + /tmp sweep** — companions to PR #22 closing GAPS §1.4(b) and §1.4(c)
5. **Sensitivity classifier wiring** — `@seed/sensitivity` exists but isn't consulted before cloud-dispatch in the router. Open design question: fail-hard vs downgrade-to-local on SENSITIVE
6. **Heartbeat memory reads** — `/search` exists; heartbeat should recall relevant past context before acting (companion to the commented-out ingest stub at `packages/heartbeat/heartbeat.sh:109`)

### Refactor EPICs (see GAPS §6)

- EPIC-001 (canonical FS contract) — not started, blocks 002/006/009
- EPIC-002 (host-neutral boot spec) — partial, CLAUDE.md still canonical
- EPIC-007 (host-neutral skills) — 9/42 skills migrated; dark-factory pipeline still Claude-locked
- EPIC-009 (docs realignment) — not started, README describes root files that don't exist
- EPIC-010 (CI validation) — `.github/workflows/release.yml` is the only workflow; no PR-time tests

---

## Don't touch

- The 5 orphaned workload install dirs on ren1 (`memory-0.1.0`, `memory-0.2.0`, `memory-0.4.2` through `memory-0.4.8`) — leave for the cleanup subcommand
- Fleet machines' control plane auth — operator token is where it needs to be, rotated cleanly
- `packages/skills/` CLI wrappers that exist — those are canonical now
- Legacy `.claude/skills/fleet-ssh`, `fleet-status`, `fleet-inference` — slated for removal per GAPS §1.6 but not this session

---

## Suggested first action for next session

**Cut the one-shot cleanup for ren1.** The installer now has `pruneOldInstalls` but nothing applies it retroactively. Two options:

- **A (fast):** one-off `seed fleet workload gc --machine <id> [--workload <id>] [--keep-prior N] [--dry-run]` subcommand that dispatches a new `workload.gc` action to the target agent. Mirrors the pattern from #22.
- **B (faster):** direct SSH+rm on ren1 as a one-time exception, documented in GAPS §1.4 as the bootstrap path for pre-GC-era fleets.

(A) is the right architectural answer; (B) is the pragmatic one. Pick based on appetite.

After that, **(2) vec0 PK root-cause** is the highest-value open debt. It's papering over mystery errors across every ingest call site.

---

## Verification one-liners for handoff

```bash
# Current fleet state
seed fleet status

# Control plane version
curl -s http://ren2.local:4310/health | jq

# Latest release
gh release view v0.4.5 --json tagName,publishedAt,assets | jq '{tag:.tagName,n:(.assets|length)}'

# CLI config
cat ~/.config/seed-fleet/cli.json

# Test a (no-op) release orchestration
seed fleet release --version v0.4.5 --control-plane-machine ren2 --cp-force --dry-run
```

---

## Stats

- Commits on main this session: 9 (all squash-merged via PR)
- Tests added: ~30 (246 total, up from 225)
- LOC delta: +1,000/-120 net (new commands, refactor, tests, docs)
- Time from empty repo audit → working `seed fleet release`: one sitting
