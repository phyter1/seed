# Handoff — Fleet Backfill Complete + Phase 2 Arcs (jury, cloud adapters, challenge round)

**Date:** 2026-04-05 (early morning, ryan-air)
**From:** Claude session (ryan-air with Ryan)
**Previous handoff:** `docs/HANDOFF-phase1-complete-2026-04-05.md`

---

## What shipped this session

### 1. Fleet backfill (production)
- **memory@0.4.2 deployed to ren1.** Workload declaration updated via `PUT /v1/workloads/ren1` (config v2→v3→v4). Agent reconciled through v0.2.0 → v0.4.2.
  - Artifact: `file:///Users/ryanlowe/.local/share/seed/workload-artifacts/memory-0.4.2-darwin-x64.tar.gz`
  - sha256: `de7e8521880aede2214bbc24626c1b626dad79186d83fa485de3dd4b7687ddad`
  - Service healthy on `:19888`, 1732 memories intact.
- **`POST /backfill-origin {origin:"internal", default_source:"journal"}`** → `updated: 1732`. Second call → `updated: 0` (idempotent). Direct SQL confirms zero NULL-origin rows.
- **Provenance enforcement smoke-tested in prod:**
  - `origin=external` without provenance → `400 {"error":"origin='external' requires: source_url, fetched_at"}`
  - `origin=external` with `source_url` + `fetched_at` → `200` ingested
  - Test rows cleaned up.

### 2. Phase 2, Arc A — `@seed/jury` primitive (**phyter1/seed#11**)
Branch: `jury-package`. New package `packages/inference/jury/`.
- `runJury()` fans out to `JurorAssignment`s concurrently; caller-supplied `AggregatorFn` synthesizes consensus.
- Provider-agnostic: callers bind `invoke(messages, options)` to any backend.
- `makeDefaultAggregator()` wraps an invoke fn in the fleet-router synthesis prompt; short-circuits when only one juror produced content.
- `calculateAgreement()` lexical Jaccard overlap.
- Telemetry hooks (`onJurorComplete`, `onAggregateComplete`, `onChallengeComplete`) + optional per-juror `queue` hook.
- Default temperature cycle `[0.3, 0.5, 0.7, 0.9]` matches battle-tested fleet-router jury.
- **Does not touch** `packages/inference/router/src/router.ts` — the deployed fleet-router keeps its inline jury; port is a future follow-up.

### 3. Phase 2, Arc C — Cloud adapter runtime (**phyter1/seed#12**)
Branch: `cloud-adapters`. `@seed/providers` → 0.2.0.
- Real `invoke()` / `listModels()` / `healthCheck()` for all cloud providers (previously scaffolds that threw "not implemented yet").
- New: **cerebras** + **groq** adapters registered.
- Shared `openai-compatible-client.ts` (used by openai, openrouter, cerebras, groq).
- `env-keys.ts` resolves API keys via `SEED_<VENDOR>_API_KEY` with vendor-canonical fallback chain; throws a helpful error listing accepted names when nothing set.
- Per-call `apiKey` + `baseUrl` overrides on `ProviderInvocationOptions`.
- **New required field `tier: 'local' | 'midtier' | 'frontier'`** on `ProviderDefinition`.
- Bespoke transports for non-OpenAI wire formats:
  - **anthropic:** `/v1/messages`, `x-api-key`, `anthropic-version` header, top-level `system` extracted from messages, `max_tokens` required (default 1024)
  - **gemini:** `/models/{model}:generateContent`, `x-goog-api-key`, role=`model`, `systemInstruction`, `generationConfig.maxOutputTokens`
- `listProviderAdaptersByTier(tier)` helper.
- tsconfig switched `NodeNext` → `bundler` moduleResolution to match sibling packages.

**Tier mapping:**

| Tier | Providers |
|------|-----------|
| local | `ollama`, `mlx_openai_compatible`, `openai_compatible` |
| midtier | `cerebras`, `groq`, `gemini`, `openrouter` |
| frontier | `anthropic`, `openai` |

### 4. Phase 2, Arc B — Challenge round with tiered escalation (**phyter1/seed#13**)
Branch: `jury-challenge`. `@seed/jury` → 0.2.0.
- After jurors return, an optional challenger model inspects their outputs and emits structured findings: `{contradictions[], errors[], gaps[], confidence, escalation_requested}`.
- Findings **pass through** to the default aggregator's synthesis prompt (advisory semantics).
- **Escalation:** `escalate:true` retries at the next tier when the challenger returns low confidence (< threshold), `escalation_requested:true`, or a parse failure. `maxTier` caps the ceiling.
- **Sensitivity lock:** `sensitivityLock:true` + `sensitivity:'SENSITIVE'` on the jury request caps `maxTier` to `local` — SENSITIVE content stays on the fleet.
- **Strictness:** `advisory` (default) never blocks; `strict` surfaces `escalationExhausted:true` on the result when confidence stays below threshold after escalation.
- Default aggregator weaves findings into a `--- Quality review ---` block above the closing instruction. Block omitted when findings are empty.
- Challenger output parsed via `@seed/inference-utils` (`extract_json`) → tolerates `<think>` tags, markdown fences, prose surrounds.
- Confidence clamped to `[0, 1]`.

---

## Merge order recommendation

PRs #11, #12, #13 all branch from main and are individually mergeable, but #13 includes A and C as merge commits. Cleanest order:

1. Merge **#11** (jury primitive) first
2. Merge **#12** (cloud adapters) second
3. Merge **#13** (challenge round) — will auto-narrow once A+C are in main

All three have gitleaks clean, tests pass, typecheck clean.

---

## Follow-ups, prioritized

### Immediate
1. **Re-embed job on ren1 is incomplete.** 712/1732 rows have embeddings; 1020 rows do not. Tangential to this session's provenance arc. Kick the embed backfill if vector search quality matters.
2. **Port router.ts onto `@seed/jury`.** The fleet-router at `packages/inference/router/src/router.ts` has its own inline jury implementation (~100 lines, `runJury` + `aggregateJury`). Now that `@seed/jury` exists, the router can import from it. Behavior-equivalent refactor; keep telemetry hooks as passthroughs.
3. **Wire `identityProfile` into router pre-dispatch.** Was flagged in phase 1 handoff as blocked on cloud providers landing in the router. Cloud providers now exist in `@seed/providers`. Plumbing the router to use them + sensitivity-gate cloud dispatch is the next concrete step.

### Process / infra
4. **Document cross-platform sqlite-vec install in `packages/memory/scripts/build-binaries.sh`.** Bun does not install optional platform packages matching non-current OS/arch. I had to manually fetch `sqlite-vec-darwin-x64` and `sqlite-vec-linux-x64` tarballs from npm into `packages/memory/node_modules/` before the cross-target binary build would include the vec extension. Currently the build script silently continues with an empty `sidecars` array if the platform package is missing — should at minimum warn, ideally auto-fetch.
5. **Cloud provider adapters need live smoke tests.** Unit tests mock `fetch`. At least one smoke test per provider against live APIs (with real keys from env) would verify the wire-format assumptions in anthropic.ts and gemini.ts didn't drift from docs.
6. **`tier` is provider-level; some models cross tiers.** OpenRouter in particular routes to everything from Haiku-class to Opus-class. Per-model tier overrides will matter once the challenge round actually escalates in production.

### Phase 2 items still unscoped
From `~/code/existential/handoff/lexbox-to-seed-extraction.md`:
- Authoritative source fetcher with freshness (`packages/memory/sources.ts`)
- Grading primitive (`packages/skills/grade/`)
- Continuous improvement daemon (`packages/heartbeat/maintenance/`)

---

## Files/commits the next agent should know

**New packages this session:**
- `packages/inference/jury/` — `@seed/jury@0.2.0`
  - `src/jury.ts`, `src/types.ts`, `src/agreement.ts`, `src/default-aggregator.ts`, `src/challenge.ts`, `src/tiers.ts`, `src/index.ts`
- Depends on `@seed/inference-utils` via `file:../utils`

**Changed in providers:**
- `packages/providers/package.json` → `0.2.0` + `@types/bun` devDep
- `packages/providers/src/types.ts` → added `ProviderTier` (required field on `ProviderDefinition`), `apiKey` + `baseUrl` on `ProviderInvocationOptions`
- `packages/providers/src/base.ts` → `tier` wired through constructor
- `packages/providers/src/index.ts` → cerebras + groq registered, `listProviderAdaptersByTier` + `resolveApiKey` exports
- `packages/providers/src/openai-compatible-client.ts` (new)
- `packages/providers/src/env-keys.ts` (new)
- `packages/providers/src/test-helpers.ts` (new, shared fetch mock)
- `packages/providers/src/adapters/{anthropic,openai,gemini,openrouter,cerebras,groq}.ts` → real implementations
- `packages/providers/src/adapters/{ollama,mlx,openai-compatible}.ts` → added `tier: "local"`
- `packages/providers/tsconfig.json` → `bundler` moduleResolution

**Fleet state changes (ren1):**
- `memory@0.2.0` → `memory@0.4.2` deployed
- `config_version` on ren2 control plane: 1 → 4
- 1732 memory rows backfilled to `origin='internal'`, `source='journal'`

**Environment:** API keys for the new cloud adapters (not set by default):
```
SEED_ANTHROPIC_API_KEY    (or ANTHROPIC_API_KEY)
SEED_OPENAI_API_KEY       (or OPENAI_API_KEY)
SEED_GEMINI_API_KEY       (or GEMINI_API_KEY / GOOGLE_API_KEY)
SEED_OPENROUTER_API_KEY   (or OPENROUTER_API_KEY)
SEED_CEREBRAS_API_KEY     (or CEREBRAS_API_KEY)
SEED_GROQ_API_KEY         (or GROQ_API_KEY)
```
Plus optional OpenRouter attribution: `SEED_OPENROUTER_REFERER`, `SEED_OPENROUTER_TITLE`.

**Operator token (ren2 control plane):** rotated in prior session, still current. Readable via `ssh ryanlowe@ren2.local 'plutil -extract EnvironmentVariables.OPERATOR_TOKEN raw ~/Library/LaunchAgents/com.seed.control-plane.plist'`.

---

## Worktrees left intact

```
.claude/worktrees/jury-package        → branch jury-package        → phyter1/seed#11
.claude/worktrees/cloud-adapters      → branch cloud-adapters      → phyter1/seed#12
.claude/worktrees/jury-challenge      → branch jury-challenge      → phyter1/seed#13
```

Plus 7 pre-existing worktrees from prior sessions (do not touch).

---

## Seed conventions in play (unchanged)

- Work in worktrees under `.claude/worktrees/<branch>`
- Commit each logical step separately
- Tests + typecheck must pass
- `SEED_VERSION` bumps only for fleet releases; package versions independent
- Additive migrations only
- gitleaks pre-push hooks active — read findings rather than `--no-verify`
- No mention of generation or Claude in git commits or PRs

---

## Suggested first action for next session

**If the operator wants to close loops:** port `router.ts` onto `@seed/jury` (follow-up #2). Modest, behavior-preserving refactor. Unblocks the router from carrying two jury implementations.

**If the operator wants to push capability forward:** wire `identityProfile` into router pre-dispatch (follow-up #3). Needs design conversation about cloud dispatch rejection semantics — whether to fail hard or downgrade to local when `classification.local_only === true`.

**If the operator wants to finish the re-embed:** kick the embed backfill on ren1 (follow-up #1). Mechanical.
