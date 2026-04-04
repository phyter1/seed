# Fleet State Snapshot — April 4, 2026

**Method:** SSH probes into all three machines + local codebase reads
**Purpose:** Ground truth for what's actually running, not what docs say should be running

---

## Machines

| Machine | Hostname | Arch | RAM | Role | Always On |
|---------|----------|------|-----|------|-----------|
| Ren 1 | ren1.local | Intel i9 x86_64 | 32 GB | Heartbeat host, queue server, memory agent | Yes |
| Ren 2 | ren2.local | Intel i9 x86_64 | 32 GB | Worker, code tasks | Yes |
| Ren 3 | ren3.local | Apple M1 Pro arm64 | 16 GB | Fleet router, MLX inference, STT | Yes (interactive-mixed) |
| Ryan Air | ryan-air.local | Apple M-series | — | User workstation, development | No |

---

## Models (Verified via Ollama/MLX)

| Machine | Model | Runtime | Speed | Keep Alive | Notes |
|---------|-------|---------|-------|-----------|-------|
| Ren 3 | Qwen3.5-9B-MLX-4bit | MLX (port 8080) | 28 tok/s | Always | Fleet router brain, non-thinking mode |
| Ren 1 | gemma4:e2b (5.1B) | Ollama (port 11434) | 31 tok/s | Forever | Jury member (fast) |
| Ren 1 | gemma4:e4b (8B) | Ollama (port 11434) | — | Forever | Also loaded, unclear if both active |
| Ren 2 | gemma4:e2b (5.1B) | Ollama (port 11434) | — | Forever | Jury member |
| Ren 2 | gemma4:e4b (8B) | Ollama (port 11434) | — | Forever | Also loaded |

**Model drift from docs:** CLAUDE.md previously said nemotron-cascade-2 on ren1 and qwen3-coder:30b on ren2. CLAUDE.md was updated this session to reflect the gemma4 reality. Worker scripts in ren-queue still reference the old models.

---

## Running Services

### Ren 1
| Service | Source Repo | Port | Manager |
|---------|-----------|------|---------|
| Heartbeat | existential | — | launchd (`com.existential.heartbeat`, every 30 min) |
| Queue Server | ren-queue | 7654 | launchd |
| Queue Workers (×5) | ren-queue | — | launchd |
| Ollama | system | 11434 | launchd |
| Agora Server | agora | — | unknown |
| Pipeline Worker | existential | — | launchd (`com.existential.pipeline`) |
| Fleet Sync | existential | — | launchd (`com.existential.fleet-sync`) |

### Ren 2
| Service | Source Repo | Port | Manager |
|---------|-----------|------|---------|
| Queue Workers (×2) | ren-queue | — | launchd |
| Ollama | system | 11434 | launchd |
| Router process | ren-jury? | — | unknown |

### Ren 3
| Service | Source Repo | Port | Manager |
|---------|-----------|------|---------|
| Fleet Router | ren-jury | 3000 | launchd (`com.ren-jury.router`) |
| MLX Server | ren-jury | 8080 | launchd (`com.ren-jury.mlx-server`) |
| STT Server | ren-stt | 8222 | launchd |
| STT Hotkey | ren-stt | — | launchd |

---

## Repos on Fleet Machines

### All machines have (synced via fleet-sync):
- existential
- ren-queue
- ren-jury
- agent-observatory
- rusty-memory-haiku
- ren-stt
- ren-infra
- ren-blog (ren1, ren3, ryan-air only)

### NOT on any fleet machine:
- **seed** — only on ryan-air
- **ccsour** — only on ren3 (Claude Code source, reference only)

---

## Skills Distribution

| Machine | SDLC Skills | Operational Skills | Legacy Skills |
|---------|------------|-------------------|--------------|
| Ryan Air | 24 | 9 (just distributed) | — |
| Ren 1 | 28 | 9 (just distributed) | 3 (graph, memories, recall, remember) |
| Ren 2 | 24 | 9 (just distributed) | — |
| Ren 3 | — | 9 (repo-level in existential) | — |

---

## Uncommitted Code (Risk Items)

| Repo | Machine | What's uncommitted | Risk |
|------|---------|-------------------|------|
| ren-jury | ren3 | `src/rule-router.ts` (713 lines) — the entire live production router | **CRITICAL** — never been committed. One `git checkout` destroys it. |
| ren-jury | ren3 | `src/router.ts` modifications (runtime exclusivity patch) | Medium — old router, but has useful code |
| ren-jury | ren3 | `package.json` changes | Low |
| existential | all | Various untracked dirs (`.claude/`, `handoff/`, `tasks/`, `work/`) | Low — these are new additions |

---

## Stale Scripts & Docs

| File | What's wrong | Location |
|------|-------------|----------|
| `existential/tools/model-watchdog.sh` | References nemotron-cascade-2 / qwen3-coder:30b | ren1 |
| `existential/tools/keep-warm.sh` | References qwen3.5:2b / phi4-mini:3.8b | ren1 |
| `ren-queue/scripts/start-worker-ren.sh` | References nemotron-cascade-2 | ren1 |
| `ren-queue/scripts/start-worker-ren2.sh` | References qwen3-coder:30b | ren2 |
| `ren-queue/scripts/start-worker-ren3.sh` | References DeepSeek-Coder-V2-Lite | ren3 |
| `existential/heartbeat-prompt.txt:35,48` | Says router runs "DeepSeek-Coder-V2 on MLX" | ren1 |

---

## Launchd Services (registered)

### Ren 1
```
com.existential.heartbeat
com.existential.fleet-sync
com.existential.pipeline
com.ren-queue.server
com.ren-queue.worker-* (×5)
```

### Ren 3
```
com.ren-jury.router
com.ren-jury.mlx-server
com.existential.stt
com.existential.stt-hotkey
```

---

## Network Topology

```
ryan-air ──── LAN ──── ren1.local (control plane candidate)
                  ├──── ren2.local
                  └──── ren3.local (fleet router at :3000)
```

All machines on same LAN. `.local` hostnames resolve via mDNS. SSH works without key files from ryan-air (passwordless auth configured).

Future: Cloudflare Tunnel fronting the control plane so fleet machines can connect from anywhere.
