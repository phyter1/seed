# Handoff — Router Port Smoke-Tested, Workload Build Pending

**Date:** 2026-04-05 (midday, ryan-air)
**From:** Claude session (ryan-air with Ryan)
**Previous handoff:** `docs/HANDOFF-router-port-and-chunk-backfill-2026-04-05.md`

---

## TL;DR

The #14 router jury port is **verified behaviour-equivalent** against the live fleet via a local smoke test. It is **not yet deployed to ren3** — redeploying requires building a proper workload artifact for `@seed/router` v1.0.0, which doesn't exist yet (only `@seed/memory` has a workload build script today).

ren3 is still running the pre-#14 `fleet-router-0.3.0` artifact, which continues to work fine. No production impact.

---

## What shipped this session

### Smoke test of #14 against live fleet

Started the new `@seed/router` locally on ryan-air (port 3001), pointed it at the real fleet (MLX_HOST=ren3.local:8080, REN1/REN2 Ollama hosts), and ran identical `/v1/jury` calls against both the deployed pre-#14 router (`ren3:3000`) and the new one. Captured outputs in `/tmp/router-smoke/` on ryan-air.

**Result: behaviour-equivalent.** Response schema identical, SSE event sequence identical, aggregation output identical.

Expected (non-regression) differences observed:
- `/health` router version `rule-based-v0.3` → `rule-based-v1.0`
- `/health` adds `config_source: "seed"` field (new, non-breaking)
- Fleet count 5 → 6 (a new qwen3-coder:30b model got added on ren3 — unrelated to #14)
- Juror count 4 → 5 per jury call (same reason: new ren2/qwen3-coder:30b)
- Aggregator output identical ("Blue"/agreement=1, "391"/agreement=0)

### Pre-existing quirk surfaced but not addressed

Non-streaming math query returns `agreement: 0` even when all jurors emit byte-identical "391". Streaming color query correctly reports `agreement: 1` on "Blue". Same behaviour in both old and new routers, so it's inherited — not introduced by #14. Worth chasing later; suspect the `calculateAgreement` function handles the word vs. numeric case differently, or the non-streaming path sees post-processed content that differs.

---

## Why ren3 wasn't redeployed

The deployed `fleet-router-0.3.0` artifact on ren3 uses a **source-drop model**: its `bin/fleet-router` is a shell wrapper that runs `bun run src/rule-router.ts` against the sidecar-shipped source file. Manifest sidecars are just `src/rule-router.ts` + `src/start-mlx-server.py`. No compilation, no bundled deps.

This works for the pre-#14 router because `rule-router.ts` is self-contained (no workspace deps). It **does not work** for the new router, which lives at `packages/inference/router/src/router.ts` and depends on:

- `@seed/jury` (file:../jury) — the primitive from #11
- `@seed/inference-utils` (file:../utils)

Shipping the new router requires bundling those workspace deps into the artifact — either via `bun build --compile` (like memory does) or `bun build --target=bun --outfile=dist/router.js` (single-file bundle with deps inlined).

No router workload build script exists in the repo today. Only `packages/memory/` has a working `build-artifact.sh`. Writing one for the router is a real task, not a 10-minute de-risk — so we stopped at local verification and filed this handoff.

---

## What the next agent should do (router)

**Build a workload artifact for `@seed/router` v1.0.0 and deploy to ren3.**

### Concrete plan

1. **Create `packages/inference/router/workload/`**:
   - `launchd.plist.template` — copy the structure from `packages/memory/workload/launchd.plist.template`. Use label `com.seed.fleet-router`.
2. **Create `packages/inference/router/scripts/build-artifact.sh`**:
   - Model it on `packages/memory/scripts/build-artifact.sh`.
   - Two reasonable bundling approaches to choose between:
     - **Option 1 (simpler):** `bun build src/router.ts --target=bun --outfile=dist/router.js` produces a single JS file with workspace deps inlined. Ship `dist/router.js` + `src/start-mlx-server.py` as sidecars. Launcher is `exec bun run $INSTALL_DIR/router.js`. Requires bun on the target (ren3 has it).
     - **Option 2 (self-contained):** `bun build src/router.ts --compile --target=bun-darwin-arm64 --outfile=dist/fleet-router-darwin-arm64` produces a standalone executable (like memory). No runtime bun dependency. Python sidecar still needed. May have issues if router uses `import.meta.dir` to resolve the python path — verify this.
   - Include `src/start-mlx-server.py` as a sidecar in both options (`router.ts` spawns it).
3. **Produce `manifest.json`** matching the existing `fleet-router-0.3.0/manifest.json` shape. Env vars: `ROUTER_PORT=3000`, `MLX_HOST=localhost:8080`, `MLX_MODEL=mlx-community/Qwen3.5-9B-MLX-4bit`, `MLX_PYTHON=/opt/homebrew/bin/python3.11`, `REN1_OLLAMA_HOST=ren1.local:11434`, `REN2_OLLAMA_HOST=ren2.local:11434`. Port 3000, HTTP probe on `/health`. Version `1.0.0`.
4. **Tarball + sha256** into `dist/artifacts/fleet-router-1.0.0-darwin-arm64.tar.gz`.
5. **Deploy via control-plane**: PUT the artifact through the ren2 control-plane API (`SEED_CONTROL_URL=http://ren2.local:4310`, operator token via `ssh ryanlowe@ren2.local 'plutil -extract EnvironmentVariables.OPERATOR_TOKEN raw ~/Library/LaunchAgents/com.seed.control-plane.plist'`). Reconcile to ren3. See how memory@0.4.8 was deployed in the previous handoff for the exact API calls.
6. **Smoke test on ren3:3000 post-deploy**: run `/v1/jury` (streaming + non-streaming) against it, verify `/health` reports `rule-based-v1.0`, verify SSE event sequence matches the local-smoke-test baseline in `/tmp/router-smoke/` (the files may be gone by the time next session runs — re-capture from current ren3:3000 before deploy).

### Pre-captured reference data

On ryan-air at `/tmp/router-smoke/` (may not survive reboot):
- `baseline-nonstream.json` — pre-#14 router non-streaming response
- `baseline-stream.txt` — pre-#14 router SSE stream
- `new-nonstream.json` — new router non-streaming response (from local run)
- `new-stream.txt` — new router SSE stream (from local run)

If these are gone, the verification method is easy to re-run: hit `/v1/jury` on the currently-deployed router, save output, deploy, hit the new one with same input, diff schemas.

---

## Memory system follow-ups (do not forget)

This session surfaced that **`@seed/memory` is a data sink, not a participant in inference.** Grep confirmed:

- Zero references to `@seed/memory` outside its own package (skills, router, jury, heartbeat all silent).
- No `recall` skill/tool that retrieves memories into prompt context at inference time.
- Router/jury do not consult memory for routing hints, sensitivity gating, or context injection.
- Heartbeat has a commented-out ingest stub at `packages/heartbeat/heartbeat.sh:109`; no reads.
- The closest thing to memory-in-prompt today is the `rusty-memory-haiku` agent on :8888 (separate system, used by `/recall` in existential repo).

### Concrete memory integration work

None of these is urgent but they should be tracked as the next phase of memory work:

1. **Build a `recall` skill** — `.claude/skills/recall/` that hits `http://ren1.local:19888/search?q=...&k=...` and formats top-k results for prompt injection. Mirror the ergonomics of `/recall` in the existential repo but point at `@seed/memory`.
2. **Heartbeat memory reads** — on boot, heartbeat should recall memories related to recent journal context before acting. Complement the ingest stub (line 109 of `heartbeat.sh`) with a read path.
3. **Router pre-dispatch memory hints** — optional: surface related entities/relationships as routing signals. Speculative; design needed.
4. **Jury challenger seeding** — let the challenge round in `@seed/jury` optionally receive conflicting past memories as priming. Also speculative.
5. **Root-cause the vec0 PK disagreement** — memory@0.4.8 papers over the symptom with per-row try/catch at every `INSERT INTO vec_memories` call site. The vec0 virtual table claims absence on SELECT but existence on INSERT for the same memory_id. See the previous handoff's "vec0 quirk" section for investigation notes. Likely requires reading `sqlite-vec` internals (`vec_memories_rowids` table) or filing an upstream issue with a repro.
6. **Cross-platform sqlite-vec install docs** — `packages/memory/scripts/build-binaries.sh` still doesn't document the sqlite-vec install story for linux-x64 targets. Carried from the previous handoff.

---

## Locked decisions (unchanged)

From the previous handoff, all still apply:

- Jury package lives at `packages/inference/jury`, provider-agnostic.
- `ProviderTier = 'local' | 'midtier' | 'frontier'` required on `ProviderDefinition`.
- Challenge round uses pass-through (advisory) semantics by default.
- `Sensitivity:'SENSITIVE'` + `sensitivityLock` caps challenger to local tier.
- `@seed/jury` depends on `@seed/inference-utils` via `file:../utils`.
- Router aggregator prompt stays byte-identical via `makeRouterAggregator`; **do NOT swap in `makeDefaultAggregator` without validation**.
- `vec_memories` INSERTs are not trusted alone — always wrap in try/catch when iterating (vec0 PK disagreement quirk).
- gitleaks hooks active; bypass only with `--no-verify` when certain.
- No mention of generation or Claude in git commits or PRs.

---

## Don't touch

- Fleet machines without explicit ask.
- The 7 pre-existing worktrees under `.claude/worktrees/` from prior sessions.
- Prior session `docs/HANDOFF-*.md` files — reference, don't modify.

---

## Suggested first action for next session

Build the router workload artifact (steps 1-4 above). Then pause and confirm the deploy plan with Ryan before PUTting to control-plane. The build is fully offline work and low-risk; the deploy is the point where we want alignment.

After router deploy lands, the next piece is **sensitivity wiring into router pre-dispatch** (follow-up #1 from the previous handoff) — a design conversation with Ryan about fail-hard vs. downgrade-to-local semantics on SENSITIVE requests that would otherwise cloud-dispatch.

Memory integration work (items 1-6 above) is its own track — pick one when you have a clear ask from Ryan. `recall` skill is probably the highest-leverage first bite.
