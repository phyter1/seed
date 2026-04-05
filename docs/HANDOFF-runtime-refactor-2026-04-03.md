# Handoff — Runtime Refactor

**Date:** 2026-04-03
**Repo:** `/Users/ryanlowe/code/seed`
**Branch:** `main`
**Status:** Clean working tree at handoff time

## Objective

Refactor Seed from a Claude-native continuity system into a runtime host-agnostic and provider/model-agnostic system.

The target split is:

- **Boot/continuity core** — host-neutral
- **Host adapters** — Claude Code, Codex CLI, Gemini CLI
- **Provider adapters** — Anthropic, OpenAI, Gemini API, OpenRouter, Ollama, MLX/openai-compatible, generic openai-compatible
- **Runtime config** — host choice independent from provider/model inventory

## Completed Work

### 1. Canonical root runtime contract

Seed now has a real root-level runtime layout:

- `journal/entries/`
- `journal/summaries/`
- `journal/summaries/index.md`
- `notes/inbox/`
- `notes/archive/`

Identity files remain root-level in the contract, but are intentionally created locally by the first conversation rather than committed into the public repo.

### 2. Host-neutral boot contract

Added:

- [`packages/core/boot/BOOT.md`](../packages/core/boot/BOOT.md)

`CLAUDE.md` is now positioned as a Claude adapter to the host-neutral boot contract, not the source of truth.

### 3. Planning corpus

Added:

- [`plan/README.md`](../plan/README.md)
- [`plan/backlog.md`](../plan/backlog.md)
- [`plan/epics/`](../plan/epics)

These track the ongoing refactor epics.

### 4. Host adapter layer

Added:

- [`packages/hosts/`](../packages/hosts)

Key files:

- [`packages/hosts/src/types.ts`](../packages/hosts/src/types.ts)
- [`packages/hosts/src/index.ts`](../packages/hosts/src/index.ts)
- [`packages/hosts/src/adapters/claude.ts`](../packages/hosts/src/adapters/claude.ts)
- [`packages/hosts/src/adapters/codex.ts`](../packages/hosts/src/adapters/codex.ts)
- [`packages/hosts/src/adapters/gemini.ts`](../packages/hosts/src/adapters/gemini.ts)
- [`packages/hosts/src/discover.ts`](../packages/hosts/src/discover.ts)
- [`packages/hosts/src/run-headless.ts`](../packages/hosts/src/run-headless.ts)
- [`packages/hosts/src/config.ts`](../packages/hosts/src/config.ts)

What exists:

- typed host adapter contract
- discovery script
- headless dispatch path
- heartbeat config resolution for host/model

### 5. Heartbeat host dispatch

Updated:

- [`packages/heartbeat/heartbeat.sh`](../packages/heartbeat/heartbeat.sh)

Heartbeat no longer directly shells into `claude -p`. It now routes through:

- [`packages/hosts/src/run-headless.ts`](../packages/hosts/src/run-headless.ts)

Resolution order:

1. `HEARTBEAT_HOST` / `HEARTBEAT_MODEL`
2. `seed.config.json` heartbeat config
3. `seed.config.json` host defaults
4. fallback `claude`

### 6. Host-aware setup

Updated:

- [`setup/detect.sh`](../setup/detect.sh)
- [`setup/install.sh`](../setup/install.sh)

Setup now treats Claude/Codex/Gemini as peer host runtimes rather than assuming Claude is the only valid path.

### 7. Provider adapter layer

Added:

- [`packages/providers/`](../packages/providers)

Key files:

- [`packages/providers/src/types.ts`](../packages/providers/src/types.ts)
- [`packages/providers/src/base.ts`](../packages/providers/src/base.ts)
- [`packages/providers/src/index.ts`](../packages/providers/src/index.ts)
- [`packages/providers/src/list.ts`](../packages/providers/src/list.ts)
- individual adapters under [`packages/providers/src/adapters/`](../packages/providers/src/adapters)

This is scaffold-level, not fully implemented invocation logic, but the boundary is now explicit.

### 8. Canonical config example

Added:

- [`seed.config.example.json`](../seed.config.example.json)

This separates:

- host runtime selection
- heartbeat host/model
- provider registry
- model inventory
- routing policy

### 9. Router integration

Added:

- [`packages/inference/router/src/config.ts`](../packages/inference/router/src/config.ts)

Updated:

- [`packages/inference/router/src/router.ts`](../packages/inference/router/src/router.ts)

The router now:

- prefers `seed.config.json`
- falls back to legacy `fleet.config.json`
- derives router-compatible fleet entries from `openai_compatible`, `mlx_openai_compatible`, and `ollama`
- skips unsupported providers rather than pretending they are routable

### 10. Queue worker integration

Added:

- [`packages/inference/queue/src/config.ts`](../packages/inference/queue/src/config.ts)

Updated:

- [`packages/inference/queue/src/worker.ts`](../packages/inference/queue/src/worker.ts)

Workers can now resolve:

- `INFERENCE_URL`
- `DEFAULT_MODEL`
- `LOCALITY`
- `PROVIDER_ID`

from `seed.config.json`, while preserving env overrides.

## Commits

Applied in this order:

1. `0688b24` `refactor: establish root runtime layout and boot contract`
2. `ca31683` `feat: add host adapter layer for claude codex and gemini`
3. `afc712e` `feat: route heartbeat through host adapters`
4. `40e5a4d` `refactor: make setup host-aware for claude codex and gemini`
5. `cb6c9b9` `feat: add provider adapter layer and canonical config example`
6. `916089f` `feat: let router load fleet from seed config`
7. `d97c94e` `feat: let queue workers resolve provider config from seed config`

## Validation Performed

### Hosts

Verified:

- `bun run packages/hosts/src/discover.ts`

Observed earlier in this session:

- Claude detected on PATH
- Codex detected on PATH
- Gemini was reported missing by current detection path

User correction:

- Gemini CLI is actually installed and signed in on this machine
- Claude Code is installed, but current subscription/quota is exhausted, so it is functionally unavailable right now

Implication:

Host detection should move from binary `installed` to at least:

- installed and ready
- installed but unavailable
- not installed

### Host dispatch

Validated structurally:

- Claude dispatch path launches but this machine was not usable for Claude headless work at test time
- Codex dispatch path launches and reaches backend initialization

Codex headless test failed under sandbox/network constraints, but the adapter path itself is wired.

### Providers

Verified:

- `bun run packages/providers/src/list.ts`

This listed the provider registry and capability metadata correctly.

### Router config

Verified:

- loading router config directly with `SEED_CONFIG=/Users/ryanlowe/code/seed/seed.config.example.json`

This produced:

- router model from seed config
- openai-compatible routing host
- router-compatible fleet entries derived from model/provider inventory

### Queue worker config

Verified:

- worker config resolver with `PROVIDER_ID=mlx_local`
- worker config resolver with `PROVIDER_ID=openrouter`

This correctly derived inference URL, default model when available, and locality from config.

## Important Current Gaps

### 1. Host readiness vs host presence

Current detection treats CLI presence as enough. That is now known to be insufficient.

Required next step:

- add readiness checks or state notes for Claude/Codex/Gemini
- distinguish:
  - installed and ready
  - installed but blocked
  - not installed

Specific to this machine:

- Gemini should likely resolve to ready
- Claude should likely resolve to installed but unavailable due to usage exhaustion

### 2. Setup detection still has fleet scan drag

`setup/detect.sh` still does network scanning for fleet discovery and can linger there.

This is not the main host/provider abstraction problem, but it affects usability and verifying `seed.config.json` generation end-to-end.

### 3. Queue scripts still duplicate env configuration

The worker launcher scripts under:

- [`packages/inference/queue/scripts/`](../packages/inference/queue/scripts)

still hardcode endpoints and models instead of leaning into `PROVIDER_ID` + `seed.config.json`.

That is the most obvious next runtime integration task.

### 4. Worker/server schema does not yet expose provider metadata

Worker registration stores:

- id
- capability
- locality
- hostname
- endpoint
- rate limits

It does not yet persist `provider_id` or provider/model metadata in the DB. Runtime bootstrap is improved, but queue observability is not yet aligned.

### 5. Docs are improved but not complete

README and architecture docs now describe the host/provider split, but not every script or operational path has been realigned yet.

## Recommended Next Steps

Priority order:

1. Tighten host detection and readiness semantics
2. Update queue worker launcher scripts to prefer `PROVIDER_ID` + `seed.config.json`
3. Extend queue worker registration and DB schema to store provider metadata
4. Align queue scripts and docs with the canonical config path
5. Consider generating host-specific wrappers beyond `CLAUDE.md` when ready

## Suggested Immediate Task

The best next slice is:

- make queue worker scripts config-first
- reduce duplicated endpoint/model values in shell scripts
- optionally add provider metadata to queue registration if the schema change is small and clean

## Notes For The Next Agent

- Do not undo the host/provider split. It is the right architectural boundary.
- Keep compatibility where easy:
  - env overrides should still work
  - legacy fleet config should still work for router until fully replaced
- Prefer small clean commits per integration slice.
- The repo was clean at handoff time.
