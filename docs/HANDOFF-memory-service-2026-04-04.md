# Handoff — Memory Service Port (Rusty Memory Haiku → Seed)

**Date:** 2026-04-04
**From:** Ren (interactive session on ryan-air with Ryan)
**Previous handoff:** `docs/HANDOFF-upgrade-infrastructure-2026-04-04.md` (upgrade infra — shipped)
**Current fleet:** ren1 + ren2 + ren3 all running seed-agent v0.2.2, control plane on ren2

---

## Where We Are

Seed is operational as a fleet-management plane:

- ✅ Control plane on ren2 (`http://ren2.local:4310`)
- ✅ Three agents all at v0.2.2: ren1 (Intel, 32GB), ren2 (Intel, 32GB), ren3 (M1 Pro, 16GB)
- ✅ Turnkey install working (caught 3 bugs during live testing → v0.1.0–v0.1.3 fixes)
- ✅ Runtime installation working (Ollama, MLX, Python, Homebrew)
- ✅ Upgrade infrastructure working — `seed fleet upgrade` rolls out new versions, agents self-update via `agent.update` command, operator-triggered `seed-control-plane self-update` works
- ✅ Ren1 cleaned up + reinstalled today (15 legacy launchd services removed, fresh seed-agent install, heartbeat + fleet-sync restored as external workloads)

What's missing: **no memory service**. Rusty Memory Haiku is still a standalone Python daemon that only lives on ren1. Agents on ren2/ren3/ryan-air have no clean way to query it, and it uses Haiku API for summarization when we have local models sitting idle.

**Operator token for testing:** use your local `$SEED_OPERATOR_TOKEN` env var (redacted; rotated 2026-04-05)
**Control plane URL:** `http://ren2.local:4310`
**Memory.db backup:** `~/backups/ren1-cleanup-20260404/memory.db.20260404-1836` (9.4MB) on ryan-air

---

## Why Do This

Three reasons, in order:

1. **Fleet-wide discovery.** Any CLI agent (claude, codex, gemini) on any machine should be able to ask "where's the memory service?" and get a URL. Right now that only works on ren1.

2. **$0 per-query cost.** The current agent.py calls Haiku ($1/M tokens in, $5/M out) for summarization and entity extraction on every ingest. The fleet already has gemma4 + qwen3 models sitting idle, plus a rule-based router on ren3 for picking them. No reason to pay Anthropic for this.

3. **Single point of failure.** Memory is tied to ren1's Python daemon. If ren1 is down or that one process crashes, memory is gone. Bringing it into seed's supervised-workload model gets us health monitoring, automatic restarts via launchd, and a path toward replication later.

---

## What to Build

### 1. `packages/memory/` in seed (new Bun/TypeScript package)

**Decision: port to Bun/TS, don't wrap Python.** The existing Python code is 1472 lines in one file — harvesting the logic into TS is the right call because:

- Matches seed's stack (Bun + Hono + bun:sqlite)
- `bun:sqlite` supports loading SQLite extensions, so sqlite-vec works
- Single language across all fleet packages keeps the cognitive load low
- Can reuse the existing memory.db file on disk — schema stays intact, just different code reading it

**What lives in the package:**
- `src/server.ts` — Hono HTTP server (mirrors current REST API, see §4 below)
- `src/db.ts` — sqlite + sqlite-vec wrapper, schema migrations, `bun:sqlite` binding
- `src/embed.ts` — local embedding via ollama `qwen3-embedding:0.6b` on ren1
- `src/summarize.ts` — local summarization via fleet-router on ren3
- `src/memory.ts` — core logic: store/query/dedup/consolidate
- `src/graph.ts` — entity extraction + relationships
- `src/main.ts` — entrypoint + launchd-friendly supervisor
- `src/*.test.ts` — unit tests
- `package.json` with `build:binaries` script producing `seed-memory-{darwin,linux}-{arm64,x64}` (6 binaries total, follow the pattern in `packages/fleet/control/scripts/build-binaries.sh`)

**Reuse the existing schema.** The current memory.db has 11 tables including `vec_memories` (384-dim cosine), `entities`, `relationships`, `ingest_queue`, `consolidations`. Copy the schema verbatim. 384 matches qwen3-embedding:0.6b output dim, so no re-embedding needed.

### 2. Port the core capabilities

From `/Users/ryanlowe/code/rusty-memory-haiku/agent.py`, the things worth porting (priorities):

**P0 (MVP — port first):**
- `ingest(text, source, project)` → chunk, embed, dedup, store
- `query(q, project, deep)` → embed query, vector search, return ranked results
- `read_all_memories(project)` — simple list
- `get_memory_stats()` — count, size, etc.
- `delete_memory(id)`
- `check_duplicate(embedding)` — cosine threshold dedup

**P1 (port after MVP works):**
- `consolidate()` — summarize related memories into higher-level insights
- `_relevance_score()` — importance × access_count × distance × age decay logic
- Entity extraction + graph (`upsert_entity`, `store_relationship`, `get_entity_graph`, `list_entities`)
- `backfill_embeddings()`

**P2 (defer, may not need):**
- PDF ingestion (current code uses watch_folder on `./inbox/`)
- Dashboard (port separately or just drop it)
- `watch_folder` background loop

### 3. Fleet integration

Memory runs on ren1 (data lives there, it has the most uptime, and the qwen3-embedding model is already loaded there). It is NOT replicated yet — single instance, like Rusty Memory Haiku today.

**Control-plane changes (in `packages/fleet/control/src/`):**

- Add `services` section to `MachineConfig` (look at current shape in `types.ts` — there's already a `ServiceConfig` type, extend if needed)
- New endpoint `GET /v1/services/:service_id` returns discovery info, e.g.:
  ```json
  { "service_id": "memory", "host": "ren1.local", "port": 19888, "url": "http://ren1.local:19888", "healthy": true }
  ```
- `healthy` comes from the existing health-probe mechanism already in agent.ts — memory service gets a `services` entry in ren1's MachineConfig with an HTTP probe at `/status`
- When memory service is down, endpoint returns `healthy: false` but still returns the URL (caller can decide whether to retry or fail)

**Config entry (stored via `seed fleet config set`):**
```json
{
  "services.memory": { "host": "ren1", "port": 19888, "probe": { "type": "http", "path": "/status" } }
}
```

**Launchd plist** (package ships `dist/com.seed.memory.plist.template`, installer renders it with actual paths). Runs at load, KeepAlive=true, logs to `~/Library/Logs/seed-memory.log`.

### 4. REST API (preserve compatibility with existing /remember, /recall, /memories skills)

The existing skills in `~/.claude/skills/` hit `http://localhost:8888` with this surface:

| Method | Path | Purpose |
|---|---|---|
| `GET /query?q=&project=&deep=` | semantic search |
| `POST /ingest {text, source, project}` | store memory |
| `POST /consolidate` | trigger consolidation |
| `GET /status` | stats |
| `GET /memories?project=` | list all |
| `POST /delete {memory_id}` | delete |
| `POST /clear` | clear all |
| `POST /backfill` | backfill embeddings |
| `GET /graph?entity=&project=` | entity graph |
| `GET /entities?type=&project=` | list entities |

**Keep these paths as-is** so the skills don't need updating immediately. Later, the skills can be updated to hit the seed control plane's discovery endpoint first, then proxy through — but that's Phase 2.

### 5. Local model wiring

**Embeddings** (called on every ingest + query):
```bash
curl http://localhost:11434/api/embeddings \
  -d '{"model": "qwen3-embedding:0.6b", "prompt": "text to embed"}'
```
Returns `{ "embedding": [0.1, 0.2, ...] }` — 384 floats. Call ollama directly on ren1 (it's local to the service). Keep the keep-alive model loaded.

**Summarization + entity extraction** (called on ingest, consolidation):
```bash
curl http://ren3.local:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role":"system","content":"..."},{"role":"user","content":"..."}]
  }'
```
Use the fleet router on ren3 — it picks gemma4 or MLX Qwen3.5 based on the task. Response is OpenAI-compatible.

**Prompts to port verbatim from agent.py:**
- `SUMMARIZE_PROMPT` (look for it in agent.py, around the `call_claude` usages)
- `EXTRACT_TRIPLES_PROMPT`
- `CONSOLIDATE_PROMPT`

The existing prompts were tuned against Haiku but should work with gemma4:e4b. If quality drops, tune them or upgrade to `qwen3.5-9b` on ren3 via the router's `mode: "jury"` for consensus.

### 6. Importing the existing memory.db

At first startup, if `memory.db` doesn't exist at the configured path, copy `memory.db.20260404-1836` from the backup. The backup has ~6 months of accumulated memories, project-scoped, with embeddings. Don't regenerate anything — the 384-dim qwen3 embeddings are already there.

Provide a `seed-memory import <path-to-db>` subcommand for explicit imports.

---

## Key Decisions / Trade-offs

These are intentional design decisions. Don't revisit without reason:

1. **Bun/TS port, not Python wrapper.** Consistency with seed stack. Python tests in rusty-memory-haiku (`test_core.py`, `test_http_api.py`) are reference implementations, not deliverables.

2. **No auth between agents and memory service.** Local trust — all fleet machines are on the same LAN, memory service listens on `0.0.0.0:19888` inside the trust zone. If this changes, add token auth later.

3. **Single instance on ren1, not replicated.** Simpler. Revisit when ren1 uptime becomes a problem.

4. **Keep the existing schema.** Don't "improve" it during the port. Schema changes go in a separate commit after MVP ships.

5. **Local models for everything.** No Haiku API calls. If quality isn't good enough, escalate to qwen3.5-9b via fleet-router before considering cloud.

6. **No LLM calls in fleet management** (existing seed decision #6 in `docs/design-decisions.md`). The memory service itself uses local LLMs, but the control-plane routes that discover/health-check it do NOT.

---

## Testing Plan

1. **Unit tests** — port the test files from rusty-memory-haiku:
   - `test_core.py` → `src/memory.test.ts` (store, dedup, query)
   - `test_http_api.py` → `src/server.test.ts` (Hono handlers)
   - `test_knowledge_graph.py` → `src/graph.test.ts` (entities + relationships)

2. **Schema compatibility** — open the backup memory.db in the new code, read existing memories, verify the 384-dim vec_memories table queries correctly.

3. **Local integration** — start the service on ryan-air, ingest a test memory, query it, verify embeddings came from ollama (not Haiku) via `curl http://localhost:11434/api/ps` showing model stays warm.

4. **Fleet integration** — deploy to ren1, hit `GET http://ren2.local:4310/v1/services/memory` from ryan-air, follow the URL, verify a query returns results.

5. **Live data** — import the backup memory.db, run several known queries ("calibration loss", "heartbeat", "agemo") and verify you get relevant results back. Sanity-check that summaries generated by gemma4 are comparable to the Haiku-generated ones already in the DB.

6. **Downtime handling** — stop the memory service, verify `GET /v1/services/memory` returns `healthy: false`, restart it, verify health recovers.

---

## Files to Read First

1. `/Users/ryanlowe/code/rusty-memory-haiku/agent.py` — source of truth for port (1472 lines)
2. `/Users/ryanlowe/code/rusty-memory-haiku/test_core.py` — what the core behavior should be
3. `/Users/ryanlowe/code/rusty-memory-haiku/README.md` — design context
4. `packages/fleet/control/src/server.ts` — Hono patterns, routing
5. `packages/fleet/control/src/db.ts` — bun:sqlite patterns, migrations
6. `packages/fleet/control/src/types.ts` — shared types, `ServiceConfig` / `MachineConfig`
7. `packages/fleet/control/src/agent.ts` — health probing already exists here, reuse
8. `packages/fleet/control/scripts/build-binaries.sh` — binary build pattern
9. `docs/HANDOFF-upgrade-infrastructure-2026-04-04.md` — previous handoff, same pattern of work
10. `docs/design-decisions.md` — locked decisions, do not violate

---

## Constraints / Patterns

- **Work in a git worktree.** Branch name: `memory-service`. Don't touch uncommitted changes in the main checkout.
- **Follow existing patterns** in `packages/fleet/control/src/` for Hono+SQLite+testing structure.
- **Commit each logical step separately** (schema + db layer → embeddings → core memory ops → HTTP server → control plane discovery → binary build → deploy).
- **Tests + typecheck must pass**: `bun test packages/memory/src/` and `bunx tsc --noEmit -p packages/memory`.
- **Atomic writes** for any disk operations.
- **Bump `SEED_VERSION`** in `packages/fleet/control/src/version.ts` when cutting the release that ships the memory service (probably v0.3.0 — new service, minor bump).
- **Don't push to GitHub** — commit locally, report back, Ryan handles merge + tag + release.

---

## Key Commands

```bash
# Fleet status (from ryan-air)
SEED_CONTROL_URL=http://ren2.local:4310 \
SEED_OPERATOR_TOKEN=$SEED_OPERATOR_TOKEN \
~/.local/bin/seed status

# Test ollama embeddings on ren1
ssh ryanlowe@ren1.local 'curl -s http://localhost:11434/api/embeddings \
  -d "{\"model\": \"qwen3-embedding:0.6b\", \"prompt\": \"hello world\"}" | jq ".embedding | length"'
# expect: 384

# Test fleet-router summarization (from anywhere on LAN)
curl -s http://ren3.local:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Summarize: The quick brown fox..."}]}'

# SSH
ssh ryanlowe@ren1.local   # memory host
ssh ryanlowe@ren2.local   # control plane
ssh ren3                  # Apple Silicon, MLX

# Inspect the backup DB
sqlite3 ~/backups/ren1-cleanup-20260404/memory.db.20260404-1836 \
  "SELECT COUNT(*) FROM memories; SELECT DISTINCT project FROM memories;"

# Build binaries locally
cd ~/code/seed/packages/memory && bash scripts/build-binaries.sh

# Tests
cd ~/code/seed && bun test packages/memory/src/

# Typecheck
cd ~/code/seed/packages/memory && bunx tsc --noEmit
```

---

## Current State of the Seed Repo

- Branch `main` at v0.2.2 (released 2026-04-04)
- Uncommitted changes in `packages/hosts/` and `packages/inference/queue/` (Ryan's in-flight work, don't touch)
- `packages/fleet/control/` is clean and shipped
- `packages/memory/` does not exist yet — you create it

---

## After Memory Service: Ren1 Reinvention

Once memory lands and is stable, the next phase is rebuilding the workloads ren1 used to run — ren-queue workers, agora, etc. — as seed-declared workloads with supervised lifecycle. But that's a separate handoff. Memory first.
