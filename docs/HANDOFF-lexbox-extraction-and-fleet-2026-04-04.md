# Handoff — LexBox→Seed Extraction Phase 1 + Fleet Telemetry Migration

**Date:** 2026-04-04 (late-night session, ryan-air)
**From:** Claude session (ryan-air with Ryan)
**Previous handoffs:**
- `docs/HANDOFF-fleet-telemetry-hooks-2026-04-04.md` — telemetry hooks migration spec (shipped this session, see below)
- `docs/HANDOFF-workloads-phase1-2026-04-04.md` — prior session context (memory@0.2.0 on ren1, fleet-router@0.3.0 on ren3)
- `~/code/existential/handoff/lexbox-to-seed-extraction.md` — LexBox→Seed extraction plan (8 items, Phase 1 = provenance + sensitivity + extract_json)

**Fleet state at handoff:** unchanged — ren1 + ren2 + ren3 on seed v0.4.2, memory@0.2.0 on ren1, fleet-router@0.3.0 on ren3.

---

## What shipped this session

### 1. PR phyter1/seed#2 — memory provenance columns (Phase 1 of LexBox extraction)

**Branch:** `memory-provenance` (worktree at `.claude/worktrees/memory-provenance/`)
**Status:** open, awaiting review
**Commits:**
- `ff1fe62` schema + db layer (types.ts, db.ts migrations + storeMemory + rowToMemory) + db-level tests
- `58cc6a3` service + server threading (memory.ts, server.ts) + integration tests
- `400cdaa` version bump to memory@0.3.0

**What it adds:** four nullable columns on the `memories` table — `source_url`, `fetched_at`, `refresh_policy`, `content_hash` — plumbed through `MemoryService.ingest` and the `POST /ingest` endpoint. `RefreshPolicy` is a closed union (`static | daily | weekly | monthly | on-demand`), server-validated. Chunk children inherit provenance from parent on both ingest and backfill paths. 50 tests passing (was 36), typecheck clean.

**Deliberately not in this PR:**
- `origin` column + enforcement of "reject ingest without provenance when origin=external"
- Backfill script for the 1722 existing ren1 memories (depends on `origin`)
- Content-hash-based exact-dup lookup (column stored, not queried)
- `sensitivity/` package (Phase 1 PR #3)
- `extract_json` port (Phase 1 PR #2)

### 2. Fleet telemetry hooks migrated to proxy path

Applied the handoff in `docs/HANDOFF-fleet-telemetry-hooks-2026-04-04.md` with one architectural change from what it literally specified: hooks go to the **local seed-agent proxy on `:4312`** (not directly to the control plane on `:4310`). Ryan chose this after I flagged that the handoff's "port 4173→4310" can't work for ren1/ren3 (no local control plane there).

**Per-machine results:**

| Machine | Result | 4173→4312 swaps | Proxy forwarder at end |
|---|---|---|---|
| ren2 | ✓ done | 12 (1 OTEL + 11 hooks) | `forwarded: 1, dropped: 0` |
| ren1 | ✓ done | 26 (1 OTEL + 25 hooks) | `forwarded: 2, dropped: 0` |
| ren3 | skipped | — | Claude Code not installed |

**URL rewrites applied:**
- `http://localhost:4173/api/v1/hooks?machine_id=<id>` → `http://localhost:4312/hooks` (query param dropped; proxy auto-stamps machine_id)
- `http://localhost:4173/otlp` → `http://localhost:4312/otlp`
- `OTEL_RESOURCE_ATTRIBUTES` value left alone (still references `agent_observatory.machine_id=<id>` — low-value rename)

**Backups:** `~/.claude/settings.json.bak-2026-04-04` on ren1 + ren2. Rollback is a single `mv`.

**ren3 state:** no `~/.claude/` directory, `claude` not in PATH. Existential CLAUDE.md claims "All machines have Claude Code" but that's stale/aspirational for ren3.

---

## Decisions locked in this session

Ryan answered the open questions from the Phase 1 analysis:

| # | Question | Answer | Affects |
|---|---|---|---|
| 1 | Sensitivity profile: env-configurable or compiled-in? | **Compiled in** | Phase 1 PR #3 |
| 2 | Enforcement point: router / queue / caller? | **Router pre-dispatch** | Phase 1 PR #3 |
| 3 | Is `on-demand` distinct from `static` in `refresh_policy`? | **Yes, keep both** | Locked in PR #2 |
| 4 | `extract_json` home: router / memory / new utils? | **All of the above** → interpret as new shared utils package | Phase 1 PR #2 |
| 5 | Backfill 1722 ren1 memories, or leave nullable? | **Backfill with `source='journal', origin='internal'`** | Follow-up after `origin` column lands |
| 6 | Is LexBox actually committed to importing from Seed? | **Yes** | Validates whole effort |

### Design decisions inside PR #2 (phyter1/seed#2)

- **All 4 provenance fields nullable** — keeps PR additive, no enforcement, backward-compat with existing 1722 rows.
- **`content_hash` is caller-supplied, not auto-computed.** Callers know the canonical pre-trim/pre-chunk shape better than the service.
- **Chunk children share parent's provenance** on both ingest and backfill paths. Fixed an existing silent regression in `memoriesMissingEmbeddings` (SELECT didn't include provenance → backfill-created chunks would have dropped it).
- **No enforcement yet.** "Reject external without provenance" waits for the `origin` column.

---

## Follow-ups, prioritized

### Phase 1 of LexBox extraction (in order)

1. **Merge phyter1/seed#2** after review. Tag + roll if desired (`memory@0.3.0` is a minor bump; artifact rebuild + redeploy to ren1 would follow the normal workload path).
2. **Phase 1 PR #2 — `extract_json` port.** Source: `~/code/existential/engine/lexbox/utils.py:5`. Home: new shared utils package, importable by both `packages/memory` and `packages/inference/router`. Port 21 tests from the Python version. Trivial if location is decided.
3. **Phase 1 PR #3 — `packages/inference/sensitivity/`.** Port core interface + pattern-detection primitives from `~/code/existential/engine/lexbox/sensitivity.py` (439 lines total, not 260 as the extraction doc claims). Compiled-in default profile for an identity repo: path refs to `ryan/`, credentials, PII, PRIVATE/CONFIDENTIAL markers. Leave legal/accounting/medical profiles in LexBox. Wire into `packages/inference/router/src/router.ts` pre-dispatch. Not-yet-wired interface can ship in its own PR; router wiring follows.

### Provenance follow-ups (not Phase 1, blocked by Phase 1 PR #2 merge)

4. **Add `origin` column to memory** (`'internal' | 'external'`) + enforcement: `origin='external'` requires at least `source_url` + `fetched_at`. Ships as `memory@0.4.0` (minor). Additive, nullable first, then enforcement.
5. **Backfill script** for existing 1722 ren1 memories: `source='journal', origin='internal'`. Ships as an admin endpoint or a one-shot script. Must run after origin-column release deploys to ren1.
6. **Content-hash-based exact-dup lookup** at ingest time (cheaper than vector cosine for identical content).

### Phase 2+ extractions from LexBox (deferred, not yet scoped)

- Provenance-first memory proper (source fetchers with freshness)
- Jury challenge round
- Grading / savings telemetry
- Continuous improvement daemon

See `~/code/existential/handoff/lexbox-to-seed-extraction.md` for the full list of 8 items.

### Fleet-audit findings (tracked but not addressed)

From `docs/HANDOFF-fleet-telemetry-hooks-2026-04-04.md`:
1. ren1 memory service embedding-dimension mismatch — already fixed in v0.4.2 (backfill was running at close of prior session)
2. ~~ren3 SSH unreachable~~ — **now reachable** (verified this session)
3. CLI version skew (CLI v0.2.1, agents v0.4.1). Run `seed self-update` on Ryan's laptop.
4. Stale `com.existential.heartbeat` + `com.existential.fleet-sync` launchd services on ren1 — unload once Seed heartbeat dispatch lands.
5. Two ollama models loaded on ren2 (gemma4:e2b + gemma4:e4b, ~17GB). Probably intentional for jury pattern but contradicts "one model per Intel machine" policy.
6. Stale install session `ren3-20260404T180312-5529` stuck at `in_progress`.

New findings this session:
7. **ren3 has no Claude Code installed.** `~/.claude/` missing, `claude` not in PATH. Either install it or update the existential CLAUDE.md to reflect reality.

---

## Files/commits the next agent should know

**This session:**
- PR: `https://github.com/phyter1/seed/pull/2`
- Branch: `memory-provenance` (worktree at `.claude/worktrees/memory-provenance/`)
- Diff: 6 files, 371 insertions (4 touching `packages/memory/src/`: types.ts, db.ts, memory.ts, server.ts + 2 tests)

**Cross-repo references:**
- `~/code/existential/handoff/lexbox-to-seed-extraction.md` — the 8-item extraction plan
- `~/code/existential/engine/lexbox/sensitivity.py` — source for Phase 1 PR #3
- `~/code/existential/engine/lexbox/utils.py:5` — source for Phase 1 PR #2 (`extract_json`)
- LexBox code lives in existential under `engine/lexbox/`

**Seed conventions in play (from CLAUDE.md):**
- Work in a worktree at `.claude/worktrees/<branch>`
- Commit each logical step separately
- Tests + typecheck must pass
- Bump `SEED_VERSION` only when tagging a fleet release (`memory/package.json` version is independent)
- Additive migrations only

---

## Suggested first action for next session

**Option A (low-risk, finish Phase 1):** review/merge PR#2, then start PR#2 (extract_json port) — trivial, 21 tests, location is decided (new shared utils package).

**Option B (higher-value, longer):** start PR#3 (sensitivity), which has more shape to work out — interface design, default profile, wiring plan for router pre-dispatch. Could ship the interface + profile in one PR and wiring in a follow-up.

Don't pick both simultaneously unless you're confident on both. Check in with Ryan before starting PR#3 — the interface design benefits from his input.
