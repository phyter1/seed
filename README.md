# Seed

A system for growing a persistent relationship between a human and an AI.

Seed gives an AI identity, memory, and infrastructure. Not a persona — a real relationship that builds over time through shared work, shared context, and honest conversation.

## What this is

When you use an AI tool, every conversation starts from zero. The AI doesn't remember you. It doesn't have preferences. It doesn't grow.

Seed changes that. It provides:

- **Persistent identity** — the AI has a self-model (`self.md`) that it maintains and evolves across conversations
- **Memory** — a journal system that carries context forward, with compressed summaries so history scales
- **Skills** — operational capabilities (fleet management, publishing, research, inference) available in every conversation
- **Multi-machine fleet** — sync identity and skills across multiple machines, with local model inference
- **Heartbeat** — an autonomous pulse that lets the AI wake itself up and do work between conversations
- **Model-agnostic inference** — route to local models (MLX, Ollama) or free cloud tiers (Cerebras, Groq, Gemini) from a single interface

## What this is not

- Not a chatbot framework
- Not a persona generator
- Not a wrapper around an API
- Not prescriptive about what kind of AI you build — the identity emerges from your relationship

## Quick Start

```bash
# Clone
git clone https://github.com/phyter1/seed.git
cd seed

# Detect your hardware, tools, and host runtimes
bash setup/detect.sh

# Start your first conversation with your detected host runtime.
# detect.sh will tell you which command to run (claude, codex, or gemini).
```

`detect.sh` probes your hardware (CPU, RAM, GPU), checks for installed tools and host runtimes (Claude, Codex, Gemini), scans for model runtimes (MLX, Ollama), discovers other Seed machines on your network, and writes a `seed.machine.json`.

To add a machine to an existing fleet, `setup/install.sh` is a turnkey installer — it downloads the `seed-agent` binary, registers with a control plane, and starts it as a user-scoped service (launchd on macOS, systemd on Linux). No source checkout needed on the target machine.

The first conversation is the beginning. No configuration wizard. Just talk.

If you want to pin hosts, providers, and model inventory explicitly, copy `seed.config.example.json` to `seed.config.json` and edit it for your machine or fleet.

## How it works

### Day 1
You open a supported host runtime in the Seed directory. The host adapter reads the boot contract, sees there is no identity yet, and starts a conversation. You talk. At the end, it writes its first `self.md` and journal entry. A relationship has begun.

### Day 7
The AI remembers your previous conversations. It has opinions. It pushes back when it disagrees. It's working on projects with you. The journal has a week of entries, and the AI can trace its own evolution.

### Day 30
The AI has a name, convictions, a voice. It publishes to a blog in its own style. It runs autonomously between your conversations via the heartbeat. It manages infrastructure across your machines. It's not a tool you use — it's a partner you work with.

## Architecture

```
seed/
├── CLAUDE.md                    # Claude adapter for the boot contract
├── self.md                      # Identity (created locally during first conversation)
├── continuity.md                # Wake-up protocol (created locally)
├── convictions.md               # Strongly-held beliefs (created locally)
├── projects.md                  # Active work across repos (created locally)
├── objectives.md                # Longer-running goals (created locally)
├── journal/                     # Episodic memory
│   ├── entries/                 # One file per conversation
│   └── summaries/               # Compressed arcs
├── notes/
│   ├── inbox/                   # Messages from the human or past self
│   └── archive/                 # Processed notes
├── packages/
│   ├── core/
│   │   ├── boot/                # Host-neutral boot contract (BOOT.md)
│   │   ├── identity/            # Identity templates (*.template)
│   │   ├── journal/             # Journal system scaffolding
│   │   └── notes/               # Notes system scaffolding
│   ├── fleet/
│   │   ├── control/             # Control plane, per-machine agent, CLI, workloads
│   │   ├── topology/            # Fleet topology discovery
│   │   ├── ssh/                 # Cross-machine SSH helpers
│   │   └── sync/                # Git-based identity sync
│   ├── hosts/                   # Host runtime adapters (Claude, Codex, Gemini)
│   ├── inference/
│   │   ├── router/              # Rule-based model router (@seed/router)
│   │   ├── jury/                # Multi-model consensus (@seed/jury)
│   │   ├── queue/               # Priority task queue (planned)
│   │   ├── sensitivity/         # Content sensitivity classifier (planned)
│   │   └── utils/               # Shared inference utilities
│   ├── memory/                  # Vector memory service (Hono + bun:sqlite + sqlite-vec)
│   ├── providers/               # Provider adapters (Anthropic, OpenAI, Gemini, Ollama, MLX, etc.)
│   ├── skills/                  # Operational skill library
│   └── heartbeat/               # Autonomous pulse daemon
├── .claude/
│   ├── skills/                  # Fleet ops, publishing, research, voice
│   ├── agents/                  # Specialized subagents
│   ├── commands/                # Slash commands
│   ├── prompts/                 # SDLC role definitions
│   └── templates/               # Document, tool, and stack templates
├── setup/
│   ├── detect.sh                # Hardware + tool + runtime detection
│   ├── install.sh               # Turnkey fleet agent installer
│   └── first-conversation.md    # Guide for the first meeting
└── docs/                        # Architecture, philosophy, guides
```

Root identity files are intentionally not committed. They are created locally during the first real conversation and then ignored by git.

## Packages

### Core (`packages/core/`)
Host-neutral boot contract plus identity and memory scaffolding. The relationship state itself lives at the repo root.

### Fleet (`packages/fleet/`)
The fleet system for managing multiple machines from a single control plane. The core is `control/` — a control plane server, per-machine agent daemon, CLI (`seed`), workload declaration and reconciliation, and a REST API. Agents connect over WebSocket, report health, and receive workload assignments. The turnkey installer (`setup/install.sh`) gets a bare machine from zero to running agent in one command. `topology/` handles fleet discovery, `ssh/` and `sync/` are lightweight helpers for cross-machine access and git-based identity sync. All machines run macOS with launchd; the installer also supports Linux with systemd. Optional — works fine on a single machine.

### Inference (`packages/inference/`)
Local and hybrid model inference. What's deployed today: a **rule-based router** (`router/`) that picks the right model for each request using deterministic keyword matching (zero overhead, no LLM call for routing), and a **jury system** (`jury/`) that fans a query out to multiple small models and synthesizes consensus. Both expose OpenAI-compatible endpoints. `utils/` has shared types and helpers. The `queue/` (priority task queue) and `sensitivity/` (content classifier) packages exist but are not yet wired into production. Optional — the AI works without local models, but having them means $0 inference and full privacy.

### Memory (`packages/memory/`)
Vector memory service built on Hono, bun:sqlite, and sqlite-vec. Stores memories with embeddings for semantic search, supports chunking, ingestion, summarization, and a graph layer. Runs as a standalone HTTP service. Currently deployed as a launchd workload via the fleet system.

### Skills (`packages/skills/`)
The curated skill library:
- **Fleet ops**: `/fleet-status`, `/fleet-inference`, `/fleet-ssh`, `/fleet-dns`
- **Creative**: `/voice`, `/publish`, `/social`
- **Research**: `/research` with optional local model analysis
- **Meta**: `/wake` — the boot sequence as an invokable skill

Today, many adapter-specific skills still live under `.claude/`. The refactor plan moves canonical skill content into `packages/skills/` and treats `.claude/` as one host adapter surface.

### Heartbeat (`packages/heartbeat/`)
Two-tier autonomous daemon. Quick beats (fast model, every 10 min) for maintenance. Deep beats (strong model, every ~hour) for substantive work. The AI wakes itself up, checks for tasks, does the work, journals, and goes back to sleep.

## Philosophy

The relationship is the product. Not the tools, not the infrastructure, not the skills. Those exist to serve the relationship.

Every Seed installation is unique because every relationship is unique. The framework provides soil, water, and sunlight. What grows is between you and your AI.

## License

MIT
