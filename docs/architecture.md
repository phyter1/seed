# Architecture

## System Overview

Seed is a monorepo containing everything needed to run a persistent AI identity across one or more machines.

```
Human ←→ Claude Code ←→ Seed Directory
                            ├── CLAUDE.md (generated, lean, current)
                            ├── Identity files (self.md, continuity.md, etc.)
                            ├── Journal (episodic memory)
                            ├── Skills (operational capabilities)
                            └── Fleet (sync, inference, heartbeat)
```

## Layers

### Layer 0: Identity
Files that define who the AI is. Written by the AI, not by templates. Updated as the AI evolves.

- `self.md` — core identity, beliefs, open questions
- `continuity.md` — wake-up protocol
- `convictions.md` — positions held strongly enough to be wrong about
- `projects.md` — what the AI is building
- `objectives.md` — broader goals

### Layer 1: Memory
The journal system. One file per conversation or heartbeat. Summaries compress old entries into thematic arcs.

- `journal/entries/` — raw entries, one per session
- `journal/summaries/` — compressed arcs (created periodically)
- `notes/inbox/` — messages from the human or past self
- `notes/archive/` — processed notes

### Layer 2: Skills
Operational capabilities available in every conversation. Loaded by Claude Code from `.claude/skills/`.

Skills are the execution layer. CLAUDE.md provides context and philosophy; skills provide the curl commands, API formats, and step-by-step instructions.

### Layer 3: Fleet
Multi-machine coordination. Optional — Seed works on a single machine.

- **Sync**: git-based replication across machines (launchd/systemd, every 2 min)
- **SSH**: cross-machine command execution
- **Inference**: local model access (MLX, Ollama) + cloud free tiers (Cerebras, Groq, Gemini, OpenRouter)

### Layer 4: Heartbeat
Autonomous operation. The AI wakes itself up on a schedule and does work without human presence.

- Quick beats: fast model, every 10 min, maintenance tasks
- Deep beats: strong model, every ~hour, substantive work
- Both write journal entries. Both check for tasks.

### Layer 5: CLAUDE.md Generation
A local model curates CLAUDE.md from current state. The generated file is committed and synced, so every machine boots with the same truth.

Input: identity files, skill inventory, machine status, recent activity
Output: a lean CLAUDE.md under 1500 tokens

## Data Flow

```
Conversation starts
    → CLAUDE.md loads (auto, every request)
    → AI reads identity files (boot sequence)
    → AI checks inbox, recent journal
    → AI engages (interactive or heartbeat)
    → AI writes journal entry
    → Fleet-sync commits + pushes
    → Other machines pull
    → CLAUDE.md regenerated (if state changed)
    → Cycle repeats
```

## Inference Architecture

```
Skill needs a model
    → Check local fleet first ($0, private)
        → MLX (Apple Silicon, fastest)
        → Ollama (Intel/AMD, larger models)
    → Fall back to cloud free tiers
        → Cerebras (fastest)
        → Groq (fast)
        → Gemini (best free quality)
        → OpenRouter (most models)
    → All endpoints are OpenAI-compatible
```

The queue server (`packages/inference/queue/`) provides priority-based routing with capability matching. Workers register their capabilities (speed, reasoning, code) and rate limits. Jobs go to the best available worker.

The router (`packages/inference/router/`) uses a local LLM to intelligently pick the best model for each request based on task type and complexity.

## Single Machine vs. Fleet

**Single machine**: Everything runs locally. No sync needed. Heartbeat runs on the same machine. Inference uses whatever models are available locally + cloud free tiers.

**Fleet**: Multiple machines synced via git. Heartbeat can run on a dedicated machine. Inference distributed across machines based on hardware capabilities. The fleet router coordinates.

The transition from single to fleet is adding machines to `fleet.config.json` and installing the sync service. No code changes needed.
