# Handoff — Router Jury Port + Chunk Backfill Shipped

**Date:** 2026-04-05 (mid-morning, ryan-air)
**From:** Claude session (ryan-air with Ryan)
**Previous handoff:** `docs/HANDOFF-fleet-backfill-and-phase2-arcs-2026-04-05.md`

---

## What shipped this session

### 1. Merged the Phase 2 stack (A → C → B)
- **#11** `@seed/jury` primitive — merged.
- **#12** Cloud adapter runtime (cerebras, groq, + real anthropic/openai/gemini/openrouter) — merged.
- **#13** Challenge round with tiered escalation — rebased onto main (dropped the A+C merge commits, cherry-picked just the challenge commit), then merged.

### 2. Router jury port onto `@seed/jury` (**phyter1/seed#14**, merged)
- Branch: `router-jury-port`.
- Replaced the router's inline jury (~300 lines: `runJury`, `runJuryStreaming`, `aggregateJury`, `calculateAgreement`) with calls into `@seed/jury`.
- The router keeps fleet-specific concerns (machine queue, telemetry, SSE stream shape); the primitive owns fan-out + aggregation mechanics.
- **Production synthesis prompt kept byte-identical** via a local `makeRouterAggregator` (not `makeDefaultAggregator`) — no behaviour drift. Callers that want the quality-review-aware prompt from `@seed/jury` can switch later.
- Telemetry events (`jury_juror`, `jury_aggregate`) and SSE ordering (`jury.start` → `juror.done(s)` → `jury.deliberation_complete` → `aggregation.start` → `aggregation.done` → `done`) preserved. A write-chain drains in-flight juror writes before `jury.deliberation_complete` to keep ordering correct (since the primitive fires `onJurorComplete` without awaiting).
- All-jurors-failed path preserved: emits `jury_aggregate` error telemetry with `error='all_jurors_failed'`, writes `jury.error` + `done`, closes the writer. Uses a `JuryAllFailedSentinel` throw to bail out of the primitive without calling the MLX aggregator.
- Typecheck clean, 16 existing router telemetry tests pass.
- **Live fleet smoke test against the deployed router (on ren3) is still pending.** Should be a manual `/v1/jury` call verifying end-to-end behaviour matches.

### 3. Memory backfill extended to stranded chunks (**phyter1/seed#15**, merged, deployed)
- Branch: `memory-backfill-chunks`. `@seed/memory` → **0.4.8** (0.4.3–0.4.7 were iteration — see post-mortem below).
- **New** `MemoryDB.chunksMissingEmbeddings()` returns chunk rows (`parent_id IS NOT NULL`) with no `vec_memories` entry.
- **`MemoryService.backfillEmbeddings()`** now iterates those chunks after the parents loop and embeds each via the single-chunk text pattern (`${summary}\n${raw_text.slice(0, 500)}`).
- **All three `vec_memories` insert sites wrapped in per-row `try/catch`**: parent single-chunk path, parent multi-chunk `storeMemory` path, new chunk loop. Swallows UNIQUE violations per-row so one stale entry doesn't crash the whole run.
- Tests: 87 pass (+2 new covering the chunk-embed path). Typecheck clean.

### 4. Deployed memory@0.4.8 to ren1
- Artifact: `file:///Users/ryanlowe/.local/share/seed/workload-artifacts/memory-0.4.8-darwin-x64.tar.gz`
- sha256: `a9636544bbfa354e9e01fc9cb6c657243be62303b5e28e686a903272a28078da`
- Control-plane `config_version` on ren2: v4 → v10 (one PUT per deploy iteration, 0.4.3 → 0.4.8).
- **Embedding coverage on ren1: 788 → 1619.** That is 100% of the theoretical max (`1832 total − 213 parents-with-children = 1619 embeddable rows`). Parents with chunks are represented by their children's embeddings by design.
- Single `/backfill` call now returns `{backfilled: 0}` in <1s (converged, idempotent).

---

## The vec0 quirk (important, documented here for future agents)

`sqlite-vec`'s `vec_memories` virtual table has behaviour that surprised me. For a given `memory_id = X`:

| Read path | Result |
|---|---|
| `SELECT 1 FROM vec_memories WHERE memory_id = X` | returns nothing |
| `LEFT JOIN vec_memories v ON m.id = v.memory_id ... WHERE v.memory_id IS NULL` | returns the row as missing |
| `INSERT INTO vec_memories (memory_id, embedding) VALUES (X, ...)` | **UNIQUE violation on primary key** |

Both read paths report the row absent. The write path says it's already there. I never root-caused *why* (might be `vec_memories_rowids` bookkeeping that doesn't round-trip through normal SELECT on vec0 virtual tables — worth a future investigation). The mitigation in 0.4.8 is per-row try/catch at every `INSERT INTO vec_memories` call site. It works but it's papering over a symptom, not fixing the cause.

**If someone digs into this later:** the vec0 virtual table's rowid-to-memory_id mapping lives in `vec_memories_rowids` (regular table, queryable from plain sqlite3 CLI). The `id` column in that table was NULL for all 788 rows I checked, but the `rowid` column did correspond to `memories.id` for the rows I sampled. There may be stale entries there without matching `memories` rows, or the vec0 virtual table may materialise PK existence differently for SELECT vs INSERT.

---

## Fleet state

- **ren1** (Intel i9 macOS) — running `memory@0.4.8` healthy on :19888. 1832 memories / 1619 embedded / 6399 entities / 5173 relationships. Heartbeat host, ingesting new memories in the background.
- **ren2** (Intel i9 macOS) — control plane at :4310 (`config_version: 10`). Jury member via Ollama `gemma4:e4b` on :11434.
- **ren3** (M1 Pro) — fleet router on :3000, MLX server on :8080, Qwen3.5-9B loaded. Deployed fleet-router still runs its own compiled build; the #14 port lives in main but has NOT been rebuilt/redeployed on ren3 yet.

**Operator token on ren2:**
```
ssh ryanlowe@ren2.local 'plutil -extract EnvironmentVariables.OPERATOR_TOKEN raw ~/Library/LaunchAgents/com.seed.control-plane.plist'
```
Length 64, unchanged from last session.

---

## Post-mortem on the 0.4.3 → 0.4.8 thrash

I iterated six deploys finding the right try/catch placement when one deploy would have done it if I'd audited all three `insertEmbedding` call sites upfront. The sequence:

| Ver | What I added | Why it wasn't enough |
|---|---|---|
| 0.4.3 | Chunk-embed loop | UNIQUE crash → loop aborts → batch lost |
| 0.4.4 | `hasEmbedding()` guard before INSERT | Guard returned false for rows that then violated PK (vec0 quirk) |
| 0.4.5 | try/catch with regex filter `/unique constraint|already exists/i` | Wrong call site still throwing |
| 0.4.6 | Bare try/catch on chunk loop | Still throwing — different call site |
| 0.4.7 | Added try/catch to parent single-chunk path | Still throwing — `storeMemory` call site uncaught |
| 0.4.8 | Added try/catch to parent multi-chunk `storeMemory` path | Converged. |

**Lesson:** when patching around a symptom, enumerate *every* call site of the problematic operation in one pass instead of whack-a-moling. Saved in auto-memory.

---

## Follow-ups, prioritized

### Immediate
1. **Wire `sensitivityProfile` / `identityProfile` into router pre-dispatch** (follow-up #3 from the previous handoff). Cloud providers now exist in `@seed/providers` (#12) and the challenge round in `@seed/jury` already honours `sensitivityLock` + `sensitivity:'SENSITIVE'` capping challenger to `local` tier. The router still dispatches without consulting a profile. Design conversation needed: on SENSITIVE requests that would route to cloud, do we **fail hard** or **downgrade to local**?
2. **Live smoke test the router port on ren3.** Build `@seed/router` from main, deploy to ren3, fire `/v1/jury` (streaming + non-streaming) against the fleet, verify telemetry + SSE output match the old implementation. Should take 10 minutes.
3. **Rebuild the fleet-router running on ren3** if the smoke test passes — ren3 is still on a pre-#14 build.

### Nice to have / paper cuts
4. **Root-cause the vec0 PK disagreement** so we can remove the defensive try/catches. Likely requires reading sqlite-vec's vec0 internals or opening an upstream issue with a repro.
5. **Cross-platform sqlite-vec install** still not documented in `packages/memory/scripts/build-binaries.sh` — handoff from previous session noted this. Still stands.
6. **Per-model tier overrides** for cloud providers (OpenRouter in particular routes to both Haiku-class and Opus-class models at the same provider-level tier).

### Phase 2 items still unscoped
From `~/code/existential/handoff/lexbox-to-seed-extraction.md`:
- Authoritative source fetcher with freshness (`packages/memory/sources.ts`)
- Grading primitive (`packages/skills/grade/`)
- Continuous improvement daemon (`packages/heartbeat/maintenance/`)

---

## Locked decisions (do not re-litigate)

Unchanged from the previous handoff:
- Jury package lives at `packages/inference/jury`, stays provider-agnostic
- `ProviderTier = 'local' | 'midtier' | 'frontier'` required on `ProviderDefinition`
- Challenge round uses pass-through (advisory) semantics by default
- `Sensitivity:'SENSITIVE'` + `sensitivityLock` caps challenger to local tier
- `@seed/jury` depends on `@seed/inference-utils` via `file:../utils`
- gitleaks hooks active; bypass only with `--no-verify` when certain
- No mention of generation or Claude in git commits or PRs

New this session:
- **Router aggregator prompt stays byte-identical to the pre-port inline version** (local `makeRouterAggregator` in `packages/inference/router/src/router.ts`). Don't switch to `makeDefaultAggregator` without validating production synthesis output.
- **`vec_memories` INSERT is not trusted alone** — always wrap in try/catch if you're iterating. The vec0 virtual table can claim absence on read and existence on write.

---

## Worktrees left intact

None — the two merged this session (`router-jury-port`, `memory-backfill-chunks`) were cleaned up. Only the 7 pre-existing worktrees from prior sessions remain. **Do not touch those.**

---

## Suggested first action for next session

Wire sensitivity into router pre-dispatch (follow-up #1). Needs a short design conversation with Ryan first: fail-hard vs. downgrade-to-local on SENSITIVE requests that would otherwise cloud-dispatch. Then plumb `@seed/providers`'s `listProviderAdaptersByTier('local')` into the router's routing rules and gate cloud tiers behind the sensitivity check.

Keep the router-port smoke test (follow-up #2) on deck — it's quick and de-risks the deployed router before the sensitivity work lands on top.
