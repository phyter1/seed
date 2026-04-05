# Handoff — LexBox→Seed Phase 1 Complete + Security Rotation

**Date:** 2026-04-05 (late-night session, ryan-air)
**From:** Claude session (ryan-air with Ryan)
**Previous handoffs:**
- `docs/HANDOFF-lexbox-extraction-and-fleet-2026-04-04.md` — Phase 1 start (PR#2 provenance + telemetry migration)
- `~/code/existential/handoff/lexbox-to-seed-extraction.md` — the 8-item extraction plan

**Fleet state at handoff:** unchanged operationally. ren1+ren2+ren3 on seed v0.4.2, **memory@0.2.0 still deployed on ren1**, fleet-router@0.3.0 on ren3. Control plane restarted once during token rotation (clean, ~3s blip).

---

## What shipped this session

Seven PRs merged. All Phase 1 items from the extraction plan are now on main.

### PR #3 — `@seed/inference-utils` (extract_json port)
Branch: `extract-json` → merged as `96f76ea`
Ports `extract_json` from `existential/engine/lexbox/utils.py` with identical semantics. Handles `<think>…</think>` tags, markdown code fences, prose-before-and-after, nested braces, braces-in-strings. Returns `JsonValue | null`. 22 tests (21 from Python + 1 defensive). New package at `packages/inference/utils/`.

### PR #4 — `@seed/sensitivity` (interface + identity profile)
Branch: `sensitivity-profile` → merged as `fe0315f`
Ships the `SensitivityProfile` interface, `SensitivityLevel` = `"SENSITIVE" | "GENERAL" | "FRONTIER"`, and a compiled-in `identityProfile` tuned for Seed-as-identity-host. Defaults GENERAL (inverse of LexBox's legal/medical fail-safe). Trips SENSITIVE on: `ryan/` path refs, credentials (OpenAI/Anthropic/GH/GL/AWS/Slack/private-keys/inline assignments), PII (SSN/phone/email via HTML5 spec regex), explicit markers (PRIVATE/CONFIDENTIAL/SECRET/NDA/DO NOT SHARE/local-only). `classifyMessages()` skips system prompts so instruction words don't trip. 33 tests. New package at `packages/inference/sensitivity/`. **NOT YET WIRED into router pre-dispatch** — that's a follow-up blocked on cloud providers landing in the router.

### PR #5 — memory@0.4.0 (origin column + enforcement)
Branch: `memory-origin` → merged as `c2f607d`
Adds `Origin` = `"internal" | "external"` and an `origin` column (nullable). Server-level enforcement: `origin='external'` on `POST /ingest` requires `source_url` AND `fetched_at` (400 with missing-field list otherwise). `origin='internal'` and null both skip enforcement. DB layer accepts anything so admin scripts can write freely. 14 new tests.

### PR #6 — security: scrub `SEED_OPERATOR_TOKEN`
Branch: `scrub-operator-token` → merged as `83a0da8`
Gitleaks caught 5 occurrences of the **live operator token** in three handoff docs on main. Token was rotated on ren2 (see "Rotation" below) and doc occurrences replaced with `$SEED_OPERATOR_TOKEN` env-var references. Git history still contains the old literal — dead string post-rotation.

### PR #7 — gitleaks pre-push hook + config fix
Branch: `pre-push-gitleaks` → merged as `11fd98c`
**The latent bug**: previous `.gitleaks.toml` had only `[allowlist]`, which silently *replaced* gitleaks' default ruleset instead of extending it. Existing pre-commit hook had been running a scanner with zero rules. Fixed with `[extend].useDefault = true`. New `.githooks/pre-push` scans the exact commit range being pushed (`remote_sha..local_sha`, or `local_sha --not --remotes=origin` for new branches). Fails hard if gitleaks missing. `setup/install-deps.sh` installs gitleaks + sets `core.hooksPath=.githooks`. CLAUDE.md gained a "Git hooks" section. Allowlisted `packages/inference/sensitivity/src/*.test.ts` for the sensitivity fake-secret test fixtures.

### PR #8 — memory@0.4.1 (content-hash dedup short-circuit)
Branch: `content-hash-dedup` → merged as `d80786e`
When caller supplies `content_hash`, look up against memories (project-scoped, top-level only) before firing the LLM/embedder. Byte-identical content returns `{status: "duplicate", duplicate_of: id}`. Completes the value of the `content_hash` column from PR#2. 10 new tests.

### PR #9 — memory@0.4.2 (`/backfill-origin` admin endpoint)
Branch: `backfill-origin` → merged as `ce66eec`
Idempotent one-shot migration for rows written before memory@0.4.0. `POST /backfill-origin {origin, default_source?}` sets `origin` on all NULL-origin rows. Optional `default_source` fills empty/null sources. 11 new tests.

---

## Security rotation

**`SEED_OPERATOR_TOKEN` rotated on ren2.** The old value `aaa3766d31da22f3800b138d8553aa07b842b85b46348ac0fdfa2b1461dc494a` had been committed to main in 3 handoff docs. Rotation steps executed:

1. Backed up plist to `~/Library/LaunchAgents/com.seed.control-plane.plist.bak-2026-04-05-rotation` on ren2
2. Generated new 64-char hex token via `openssl rand -hex 32`
3. Updated plist via `plutil -replace EnvironmentVariables.OPERATOR_TOKEN`
4. `launchctl bootout` + `bootstrap` → control plane restarted cleanly
5. All 3 agents reconnected (ren1, ren2, ren3)
6. Verified: old token → 403, new token → 200

**The operator knows the new token.** If the next session needs to hit the control plane, the operator will provide it. It is NOT in this doc by design.

---

## Hooks infrastructure now active

After `setup/install-deps.sh` runs on a dev machine:
- `gitleaks` installed (brew on macOS, release binary on Linux)
- `git config core.hooksPath .githooks` set in the seed clone
- `.githooks/pre-commit` runs gitleaks on staged changes (permissive — skips if missing)
- `.githooks/pre-push` runs gitleaks on the push range (strict — fails if missing)

Bypass for a single push: `git push --no-verify`. Use only if certain.

**Known historical findings:** `gitleaks git` on full history shows 3 findings — the pre-scrub token in the 3 handoff commits. Expected; dead post-rotation. The pre-push hook scopes to new commits only, so these won't block pushes.

---

## Follow-ups, prioritized

### Immediate (fleet action)

1. **Deploy `memory@0.4.2` to ren1.**
   - Build artifact: `cd packages/memory && bash scripts/build-artifact.sh`
   - Publish to artifact location (file:// for now; HTTPS/GitHub Releases in Phase 2 of workloads)
   - Update workload declaration:
     ```bash
     curl -X PUT http://ren2.local:4310/v1/workloads/ren1 \
       -H "Authorization: Bearer $SEED_OPERATOR_TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"workloads": [{"id": "memory", "version": "0.4.2", "artifact_url": "file://..."}]}'
     ```
   - Verify agent reconciles and memory service restarts healthily
   - Run backfill:
     ```bash
     curl -X POST http://ren1.local:19888/backfill-origin \
       -H 'Content-Type: application/json' \
       -d '{"origin": "internal", "default_source": "journal"}'
     ```
   - Expect: `{"status": "done", "updated": 1722}` (or however many pre-0.4.0 rows exist)
   - Verify: `curl http://ren1.local:19888/memories | jq '[.memories[] | select(.origin == null)] | length'` → 0

2. **Verify ingest on ren1 with new provenance contract.** Pick a fetched-content flow and ingest with `origin='external'` + `source_url` + `fetched_at` to confirm the enforcement works in prod.

### Phase 2 extractions (unscoped)

From `~/code/existential/handoff/lexbox-to-seed-extraction.md`:

3. **Jury challenge round.** Add `challenge: boolean` to the existing `/v1/jury` endpoint. Dedicated stage where a model reviews all jurors' outputs for contradictions/gaps/errors before synthesis. Source pattern: LexBox `full_pipeline.py` stage 5. **I argue highest-value Phase 2 item** — it's the kind of multi-model coordination that proves Seed's jury pattern is a real primitive.
4. **Authoritative source fetcher with freshness.** Build `packages/memory/sources.ts` with declared URLs + scheduled refresh + ontology tags. Integration: `/research` skill gets a `--corpus <name>` flag.
5. **Grading primitive.** `packages/skills/grade/` — score output on configurable criteria (1-10). Use inside `/publish blog` to grade drafts before deploy.
6. **Continuous improvement daemon.** `packages/heartbeat/maintenance/` — low-priority jobs (tag, summarize, grade, detect drift) that run on idle fleet compute.

### Router wiring for sensitivity

7. **Wire `identityProfile` into router pre-dispatch.** Needs `ProviderKind` to gain a `cloud` distinction first — today's router is local-only (MLX + Ollama). Reject cloud dispatch when `classification.local_only === true`. Not shippable meaningfully until cloud providers land in the router.

### Other

8. **Gitleaks on other repos** (operator's judgment). seed is now covered. `ren-infra` is the next plausible target (bootstrap scripts could contain credentials). `ren-blog` is low-value (public + creds out-of-tree). `existential` is the operator's call.

---

## Files/commits the next agent should know

**New packages this session:**
- `packages/inference/utils/` — `@seed/inference-utils`, exports `extractJson`, `JsonValue`
- `packages/inference/sensitivity/` — `@seed/sensitivity`, exports `SensitivityProfile`, `identityProfile`, etc.

**Changed in memory package:**
- `packages/memory/package.json` → `0.4.2`
- `packages/memory/src/types.ts` → `Origin`, `ORIGINS`, `ProvenanceInput.origin`, `Memory.origin`
- `packages/memory/src/db.ts` → origin column migration, `findByContentHash`, `backfillOrigin`
- `packages/memory/src/memory.ts` → content-hash short-circuit in `ingest()`
- `packages/memory/src/server.ts` → origin validation + external-requires-provenance enforcement + `/backfill-origin` endpoint

**New repo infrastructure:**
- `.githooks/pre-push` — gitleaks scan on push
- `.gitleaks.toml` → now extends defaults (`[extend].useDefault = true`) + allowlists sensitivity test fixtures
- `setup/install-deps.sh` → installs gitleaks, sets `core.hooksPath`
- `CLAUDE.md` → "Git hooks (gitleaks pre-push)" subsection

**Cross-repo references (unchanged since last handoff):**
- `~/code/existential/handoff/lexbox-to-seed-extraction.md` — the 8-item extraction plan
- `~/code/existential/engine/lexbox/` — LexBox source for Phase 2 extractions
- `~/code/ren-jury/src/rule-router.ts` — current home of the jury pattern

---

## Seed conventions in play (unchanged)

- Work in worktrees under `.claude/worktrees/<branch>`
- Commit each logical step separately
- Tests + typecheck must pass
- `SEED_VERSION` bumps only for fleet releases; memory package version is independent
- Additive migrations only
- Direct pushes to main for trivial fixes, PRs for everything substantive
- **gitleaks hooks are now active** — if they fire, read the findings, don't `--no-verify` without confirming they're false positives

---

## Suggested first action for next session

**If the operator wants to ship the fleet work:** deploy memory@0.4.2 to ren1 and run the backfill. It's the finish-the-arc move. About an hour of work including verification.

**If the operator wants to keep building:** start Phase 2 jury challenge round. Check in on interface design before writing code — the challenge-round shape benefits from operator input (how aggressive, what model tier, pass-through vs gate).

**Ask before starting Phase 2** — the operator was deliberate about scoping Phase 1 tightly. Phase 2 is bigger and a scope conversation is worth having.
