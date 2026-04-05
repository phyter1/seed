# Handoff — @seed/memory /search + /recall skill shipped

**Date:** 2026-04-05 (afternoon, ryan-air)
**From:** Claude session (ryan-air with Ryan)
**Previous handoff:** `docs/HANDOFF-router-1.0-deployed-and-memory-integration-2026-04-05.md`

---

## TL;DR

Memory follow-up #1 is done. `@seed/memory@0.4.9` is deployed to ren1 with a new `GET /search` endpoint that returns raw top-k scored chunks (no LLM synthesis). A `/recall` skill at `.claude/skills/recall/` hits it with auto project scoping. Merged to main via phyter1/seed#16 (squash `6fd04b0`).

`@seed/memory` is no longer a pure data sink — it now has a read path wired into skills.

---

## What shipped this session

### @seed/memory@0.4.9 — GET /search endpoint (phyter1/seed#16, squash `6fd04b0`)

- **Route:** `GET /search?q=&k=&project=` on `packages/memory/src/server.ts:44`
- **Semantics:** raw top-k vector retrieval, no LLM call. Filled the gap between `/query` (synthesizes) and `/memories` (lists all).
- **Params:** `q` required; `k` defaults to 5, validated 1–50; `project` optional scope.
- **Response shape:** `{query, k, count, results[{memory_id, score, distance, similarity, summary, source, project, importance, entities, topics, created_at, source_url, origin}]}`. Results sorted by blended `score` (importance × access × distance × age), not raw similarity.
- **`searchMemories()` now takes an optional `limit` arg** with 3× overfetch from KNN so project/exclude filtering doesn't starve results below the caller's k. Default behavior unchanged for existing callers (`query`/`deepQuery`).
- **Tests:** 6 new server tests (happy-path, k bound, default k=5, missing q, invalid k, empty store). 93 total pass in the package.

### Deployed @seed/memory@0.4.9 to ren1

- Artifact: `file:///Users/ryanlowe/.local/share/seed/workload-artifacts/memory-0.4.9-darwin-x64.tar.gz`
- SHA256 (darwin-x64): `31f1fea2df5da584b8a1d9c65ed93c21856a50940899c6d7100c5b47da4e298a`
- Control-plane `config_version`: v10 → v11.
- Install dir: `~/.local/share/seed/workloads/memory-0.4.9/` on ren1.
- launchd label: `com.seed.memory`.
- Old `memory-0.4.x/` install dirs (0.1.0, 0.2.0, 0.4.2–0.4.8) still present on ren1 (known Phase 1 GC gap).

**All three platform artifacts built** (darwin-arm64, darwin-x64, linux-x64). Required `npm install --no-save sqlite-vec-darwin-x64 sqlite-vec-linux-x64 --force` locally since bun on darwin-arm64 skips foreign-platform native packages. This is the same pain point tracked as memory follow-up #6 (cross-platform sqlite-vec install docs).

**Post-deploy smoke test (against `ren1:19888`):**
- `/status` → 1834 memories, 1619 embedded, vector_search: true ✓
- `/search?q=router&k=3` → 3 scored results, full shape as specified ✓

### /recall skill (`.claude/skills/recall/SKILL.md`)

Mirrors the ergonomics of the existential/`rusty-memory-haiku` `/recall`, but points at `/search` instead of `/query` — returns raw chunks, not synthesis.

- **Auto-scopes to project** from `basename ${CLAUDE_PROJECT_DIR:-$(pwd)}`.
- **Flags:** `--k <n>`, `--project <name>`, `--no-project`.
- **Tools allowed:** `Bash(curl *)`, `Bash(jq *)`.

---

## Known quirks surfaced this session

1. **Workload installer doesn't re-bootstrap launchd after staging.** When the agent installed 0.4.9, the install dir was created and `~/Library/LaunchAgents/com.seed.memory.plist` was rewritten to point at 0.4.9, but the existing `com.seed.memory` service wasn't unloaded/reloaded — service was down after install until `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.seed.memory.plist` was run manually. Possibly the installer unloaded pre-install but failed to re-bootstrap, or it overwrote the plist without touching launchd at all. Either way it's a second Phase 1 installer gap alongside the GC one. Add to Phase 1 installer backlog.

2. **bun install skips foreign-platform native packages on macOS-arm64.** `packages/memory/scripts/build-binaries.sh` produces darwin-arm64 cleanly but silently skips darwin-x64 and linux-x64 sqlite-vec extensions unless you pre-install them via npm with `--force`. This is exactly memory follow-up #6 from the prior handoff ("Cross-platform sqlite-vec install docs") — now with a known workaround: `npm install --no-save sqlite-vec-darwin-x64@0.1.9 sqlite-vec-linux-x64@0.1.9 --force` before running build-binaries.sh. Worth encoding into the build script or README.

---

## Memory system backlog (carried forward + updated)

From previous handoff. **#1 is done.** Remaining:

2. **Heartbeat memory reads** — on boot, heartbeat should recall memories related to recent journal context before acting. Now that `/search` exists with a clean shape, this is the next obvious bite. Complement the commented-out ingest stub at `packages/heartbeat/heartbeat.sh:109`.

3. **Router pre-dispatch memory hints** — surface related entities/relationships as routing signals. Speculative; design needed.

4. **Jury challenger seeding** — let the challenge round in `@seed/jury` optionally receive conflicting past memories as priming. Speculative.

5. **Root-cause the vec0 PK disagreement** — memory@0.4.x papers over with per-row try/catch at every `INSERT INTO vec_memories` call site. Likely requires reading `sqlite-vec` internals (`vec_memories_rowids` table) or filing an upstream issue with a repro. **Load-bearing.**

6. **Cross-platform sqlite-vec install docs** — now with a known workaround (see quirk #2). Low-effort: bake `npm install --no-save sqlite-vec-darwin-x64 sqlite-vec-linux-x64 --force` into `build-binaries.sh` or add a README section.

7. **Standalone seed.config.json workload** — decouple fleet topology from router releases. **Load-bearing.**

8. **Pre-dispatch sensitivity wiring into router** — design conversation, not a directed task. Fail-hard vs. downgrade-to-local semantics on SENSITIVE requests that would cloud-dispatch.

New:

9. **Phase 1 workload installer — re-bootstrap launchd after plist rewrite** — see quirk #1.

---

## Locked decisions (unchanged)

All prior locks still apply. Unchanged from previous handoff:

- Jury package at `packages/inference/jury`, provider-agnostic.
- `ProviderTier = 'local' | 'midtier' | 'frontier'` required on `ProviderDefinition`.
- Challenge round uses pass-through (advisory) semantics by default.
- `Sensitivity:'SENSITIVE'` + `sensitivityLock` caps challenger to local tier.
- `@seed/jury` depends on `@seed/inference-utils` via `file:../utils`.
- Router aggregator prompt stays byte-identical via `makeRouterAggregator` — **do NOT swap in `makeDefaultAggregator` without validation**.
- `vec_memories` INSERTs wrapped in try/catch when iterating (vec0 PK disagreement quirk).
- Router workload build uses `bun build --compile`; absolute paths via env, not `import.meta.dir`.
- seed.config.json shipped as sidecar inside router artifact (interim; to be replaced by standalone workload — item #7).
- gitleaks hooks active; bypass only with `--no-verify` when certain.
- No mention of generation or Claude in git commits or PRs.

New:

- **`searchMemories()` overfetches 3×** from KNN to survive project/exclude filtering. Callers who pass a `limit` get back at most `limit` scored results, sorted by blended score.
- **`/search` is the read surface for prompt injection;** `/query` remains the read surface for synthesized answers. Don't collapse them.

---

## Don't touch

- Fleet machines without explicit ask.
- The 7 pre-existing worktrees under `.claude/worktrees/` from prior sessions.
- Prior session `docs/HANDOFF-*.md` files — reference, don't modify.

---

## Suggested first action for next session

**Wire /search into the heartbeat boot path** (memory follow-up #2). Highest-leverage next bite — turns the heartbeat from a blind pulse into one that recalls relevant past context before deciding what to ship. Use the `/recall` skill's curl shape as the reference implementation.

After that, the load-bearing follow-ups are:
- **#5** (vec0 PK root-cause) — the try/catch papering is accumulating call sites.
- **#7** (standalone seed.config.json workload) — drops a sidecar from every router release.
- **#9** (installer re-bootstrap) — small installer fix, would have saved 10 min this session.

#3, #4, #8 remain speculative/design-conversations. Flag when you have context; wait for a clear ask.
