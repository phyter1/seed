# Handoff — Workloads Phase 1 + Embed Dim Fix

**Date:** 2026-04-04 (late session)
**From:** Ren (interactive session on ryan-air with Ryan)
**Previous handoffs:**
- `docs/HANDOFF-memory-service-2026-04-04.md` — memory service port (shipped as v0.3.0)
- `docs/HANDOFF-upgrade-infrastructure-2026-04-04.md` — self-update + `seed fleet upgrade` (shipped as v0.2.1/v0.2.2)
- `docs/workloads-design.md` — full workloads system design, 6 phases

**Fleet state at handoff:** ren1 + ren2 + ren3 all on seed v0.4.2. Two workloads deployed and running.

---

## Where We Are

Three releases shipped this session. Working state:

| Release | What shipped |
|---|---|
| **v0.4.0** | Workloads Phase 1 (declarative install, launchd driver, reconcile loop, `workload.*` commands) + memory artifact pipeline |
| **v0.4.1** | Agents now report their LAN IP on announce; discovery endpoint returns real IPs instead of mDNS hostnames or display_name |
| **v0.4.2** | PUT `/v1/config` auto-pushes `machines.<id>` changes to connected agents + memory embed dim fix (384→1024 to match qwen3-embedding:0.6b) |

**Live workloads on the fleet:**
- `memory@0.2.0` on ren1 (port 19888, ~1722 memories, 1024-dim qwen3 embeddings — backfill was running at close of session, should complete autonomously)
- `fleet-router@0.3.0` on ren3 (port 3000, routes to Ollama on ren1/ren2 and spawns MLX Qwen3.5-9B locally)

Both services are declared in control-plane config (`services.memory`, `services.fleet-router`) and discoverable via `GET /v1/services/:id` with resolved LAN IPs.

---

## What Shipped In Detail

### Workloads Phase 1 (v0.4.0)

Implementation of `docs/workloads-design.md` phase 1. Happy path only, file:// URLs only, launchd only. Files added to `packages/fleet/control/src/`:

- `types.ts` — `WorkloadManifest`, `WorkloadDeclaration`, `WorkloadInstallRecord`, 5 new `ACTION_WHITELIST` entries (`workload.install/reload/remove/status/reconcile`), `workloads?: WorkloadDeclaration[]` on `MachineConfig`, `lan_ip` on `AnnounceMessage` + `Machine`
- `templates.ts` + `templates.test.ts` — `@@TOKEN@@` and `{{env_placeholder}}` renderers
- `supervisors/launchd.ts` — `launchctl bootstrap / bootout / list` wrapper, idempotent, per-user GUI domain
- `workload-installer.ts` + `workload-installer.test.ts` — fetch → verify sha256 → extract → render template → write plist → bootstrap
- `reconcile.ts` + `reconcile.test.ts` — pure planning function (install-missing / upgrade-mismatched / reload-drift)
- `workload-runner.ts` — executes a plan, updates state
- `workload-db.ts` — agent-local SQLite tracking install state (`~/.local/share/seed/workloads.db`)
- `agent.ts` — registers `workload.*` handlers, triggers reconcile on config_update + on boot
- `server.ts` — `GET /v1/workloads`, `GET/PUT /v1/workloads/:id`, `POST /v1/workloads/:id/:workload_id/install`

Memory artifact pipeline added at `packages/memory/`:
- `workload/launchd.plist.template` — generic seed-style template using `@@LABEL@@`, `@@BINARY@@`, `@@INSTALL_DIR@@`, `@@LOG_PATH@@`, `@@ENV@@` tokens
- `scripts/build-artifact.sh` — produces `memory-<ver>-<target>.tar.gz` bundles containing manifest.json + binary + vec0.{dylib,so} + launchd template
- CI builds + publishes all 3 platform tarballs in the release

**Deviation from design doc:** workloads are declared inline on `machines.<id>` config instead of a separate `workloads.<id>` key. Simpler (no new push path, existing config_update carries them). See commit `197f0c6` or the merged commit `9a7a008`-ish area for details.

### Discovery fix (v0.4.1)

The initial discovery endpoint used `machine.display_name` as the URL host. Broke immediately when I tried `GET /v1/services/memory` and got back `http://Ren1 (Intel i9):19888` — spaces, parens, unresolvable.

**Fix:** agents now report their LAN IPv4 on `announce`, resolved via a UDP socket's kernel route lookup (connect to control-plane host+port, read back the local address — no packets sent). Control plane stores it on the Machine record. Discovery returns `machine.lan_ip ?? machine_id` (never display_name).

Bonus: avoids mDNS entirely. No more `.local` flakiness.

### Config auto-push (v0.4.2)

`PUT /v1/config {key: "machines.ren3", value: {...}}` used to update the store silently — connected agents wouldn't see the change until their next reconnect. Workloads would sit undeclared for minutes, services wouldn't health-probe, every operator change required an `agent.restart` dance.

**Fix:** when the key matches `machines.<id>` and that machine is connected, push `config_update` over the WebSocket immediately. Response now includes `pushed: boolean` so callers can observe it. Matches what `PUT /v1/workloads/:id` already did.

### Memory embed dim fix (v0.4.2)

The memory service shipped with a hardcoded 384-dim `vec_memories` schema (inherited from Rusty Memory Haiku's all-MiniLM-L6-v2 model). But the configured embedder is `qwen3-embedding:0.6b`, which returns 1024-dim vectors. Every knn query failed with "Dimension mismatch."

**Fix:**
- `MemoryDB` takes an `embedDim` constructor arg, defaulting to `MEMORY_EMBED_DIM` env var (1024)
- On startup, inspects existing `vec_memories` dim; if mismatched, drops + recreates the table and logs a warning
- Operator runs `POST /backfill` to re-embed all memories with the new model
- Memory rows are preserved; only the vector index is rebuilt

Memory service bumped to v0.2.0 (the 384→1024 migration is breaking for any existing vec data).

### Comprehensive CLAUDE.md

Rewrote root `CLAUDE.md` as a working reference covering:
- Architecture (packages, core concepts, protocols, key decisions)
- Operating the fleet (commands, workload declaration, discovery, config push, debugging)
- Working on the code (dev loops, builds, release process, versioning, worktree workflow)
- Preserved boot-contract section for Ren's identity-host use case

This is where to send operators or developers who are new to the repo.

---

## Known Issues / Followups

1. **`POST /backfill` blocks the client.** The Hono handler `await`s the full backfill before responding. For 1722 memories at ~150/min via ollama, that's 10+ min. When the client disconnects (timeout), the server keeps running — effectively a "zombie request handler." Should return 202 immediately + expose `/backfill/status` for polling. Low urgency; current behavior works if you disconnect and check status later.

2. **ren3's fleet-router startup race.** On first request that needed MLX, the router spawned MLX twice (the curl timeout triggered a retry while the first MLX was still loading the model). Only one bound port 8080. Manually killed the orphan. The router should either serialize startup or detect the race. Reproducible if you first-request with a tight client timeout.

3. **`services.<id>` + `machines.<id>.services[]` are separate.** Discovery endpoint reads the global `services.<id>` key for topology; health comes from the agent's health reports for `machines.<id>.services[]` entries. To make a service both discoverable AND health-probed, operators currently set BOTH. Per the workloads design doc, discovery should fall back to workloads (auto-probe workloads with port + probe in their manifest). Deferred — it works today, it's just double-entry.

4. **Workload removal not implemented.** Phase 1 is "install only" per the design. Declaring a workload adds it; removing a declaration doesn't `launchctl bootout` it. Operators must dispatch `workload.remove` explicitly. Not urgent but worth fixing before Phase 3.

5. **No periodic reconcile tick.** Phase 3 feature per the design. Today reconcile fires on: (a) boot, (b) config_update received. If a user manually `launchctl bootout`s a workload, it won't come back until the next config push or agent restart. Drift-healing loop is the fix.

6. **Existential repo still has rusty-memory-haiku references.** The skills in `~/.claude/skills/` that hit `http://localhost:8888` haven't been updated to use seed's discovery endpoint. They'll silently fail on every machine except ren1 (where they hit an old port that no longer exists). Update the skills to `curl $SEED_CONTROL_URL/v1/services/memory | jq -r .url` first.

---

## Commits on main from this session

```
8ae4f69 docs(claude): comprehensive operator + developer guide
ba5978c chore: bump seed v0.4.2 + memory v0.2.0 (embed dim fix)
<merge>  merge: auto-push config + memory embed dim fix
<fixes>  fix(control): PUT /v1/config auto-pushes machines.* changes to agents
<fixes>  fix(memory): configurable embedding dim (default 1024)
18b0a13 chore: bump to v0.4.1
<merge>  merge: discovery returns LAN IP, not display_name
<fix>    fix(discovery): return reachable IP, never display_name
<merge>  merge: workloads Phase 1 — single-machine install
<many>   [11 commits] feat(workloads): Phase 1 scaffold → driver → installer → runner → db → types → agent → server → memory artifact pipeline
28b2dbc chore: gitignore worktree directories (accidentally added in 2153046)
2153046 chore: bump to v0.4.0 + ship memory workload artifact bundles
```

Run `git log --oneline main | head -30` for the exact sequence.

---

## Testing

**Tests:** 219 pass, 0 fail in `packages/fleet/control/` after all changes. 36 pass, 0 fail in `packages/memory/`. Typecheck clean in both.

**End-to-end validation** (live fleet, this session):
1. ✅ Memory workload deployed to ren1 via `PUT /v1/workloads/ren1` → reconcile fetched, extracted, loaded — service running on :19888 with 1722 memories.
2. ✅ Fleet-router workload deployed to ren3 via same mechanism — router running on :3000, streaming responses from gemma4 on ren1 Ollama.
3. ✅ MLX Qwen3.5-9B downloaded + loaded on ren3, confirmed serving `/v1/chat/completions`.
4. ✅ Discovery endpoint returns LAN IPs (ren1=192.168.4.191, ren3=192.168.4.196), not mDNS or display_name.
5. ✅ `healthy: true` reports work once `services.<id>` is wired into the machine's `services[]` config.
6. ✅ Fleet `seed fleet upgrade` rolled all 3 agents through v0.4.0 → v0.4.1 → v0.4.2 cleanly.
7. ⏳ Memory backfill running at handoff (1024-dim re-embed). Will complete autonomously.

---

## Key Commands

```bash
# Fleet status (from ryan-air)
export SEED_CONTROL_URL=http://ren2.local:4310
export SEED_OPERATOR_TOKEN=aaa3766d31da22f3800b138d8553aa07b842b85b46348ac0fdfa2b1461dc494a
seed status

# Check backfill progress
curl -s http://192.168.4.191:19888/status | jq '.embedded_memories'

# Query discovery
curl -s -H "Authorization: Bearer $SEED_OPERATOR_TOKEN" \
  http://ren2.local:4310/v1/services/memory
curl -s -H "Authorization: Bearer $SEED_OPERATOR_TOKEN" \
  http://ren2.local:4310/v1/services/fleet-router

# List workloads per-machine
curl -s -H "Authorization: Bearer $SEED_OPERATOR_TOKEN" \
  http://ren2.local:4310/v1/workloads/ren1
curl -s -H "Authorization: Bearer $SEED_OPERATOR_TOKEN" \
  http://ren2.local:4310/v1/workloads/ren3

# SSH
ssh ryanlowe@ren1.local   # memory host
ssh ryanlowe@ren2.local   # control plane
ssh ren3                  # Apple Silicon, MLX + fleet-router

# Logs (on each machine)
tail -f ~/Library/Logs/seed-agent.log
tail -f ~/Library/Logs/com.seed.memory.log      # ren1
tail -f ~/Library/Logs/com.seed.fleet-router.log # ren3

# Tests
cd ~/code/seed && bun test packages/fleet/control/src/
cd ~/code/seed && bun test packages/memory/src/
```

---

## What's Next

The big remaining workstreams, roughly in priority order:

1. **Phase 2 of workloads** (design doc §Phases): HTTPS artifact fetch from GitHub Releases, checksum verification against the release's checksums.txt, artifact caching in `~/.local/share/seed/workload-cache/`. Would remove the need to scp tarballs manually.

2. **Phase 3 of workloads:** periodic reconcile tick, drift detection, reboot recovery exercised. Needed if we want `launchctl bootout`-then-reboot to self-heal without operator action.

3. **`seed workload` CLI subcommand** (design doc Phase 5). Today operators use curl against the REST API. Could be: `seed workload list/declare/remove/status/reconcile`. Small, high-leverage.

4. **Update existential's `/remember`, `/recall`, `/memories` skills** to use discovery instead of hardcoded `localhost:8888`. Currently broken on every machine except historic ren1.

5. **Harden `/backfill`** to non-blocking + polling API (see known issue #1).

6. **Workload removal path** (known issue #4).

See `docs/workloads-design.md` for phases 4 (Linux + systemd), 5 (operator UX), 6 (secrets/rollback/dep ordering).

---

## Files to Read First (new agent)

1. `CLAUDE.md` — the comprehensive operator + developer guide (rewritten this session)
2. `docs/workloads-design.md` — workloads architecture, 6-phase plan
3. `docs/design-decisions.md` — locked architectural decisions
4. `docs/HANDOFF-workloads-phase1-2026-04-04.md` — this file
5. `packages/fleet/control/src/types.ts` — `WorkloadManifest`, `WorkloadDeclaration`, `ACTION_WHITELIST`
6. `packages/fleet/control/src/reconcile.ts` — convergence decision function (start here to understand the install logic)
7. `packages/fleet/control/src/workload-installer.ts` — the install flow
8. `packages/fleet/control/src/agent.ts` — boot-time reconcile + workload command handlers (grep `runWorkloadReconcile`)
9. `packages/memory/scripts/build-artifact.sh` — canonical artifact bundle example
10. `packages/memory/workload/launchd.plist.template` — canonical workload plist template
