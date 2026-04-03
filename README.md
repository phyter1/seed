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

# Detect your hardware and install dependencies
bash setup/detect.sh
bash setup/install.sh  # if anything is missing

# Start your first conversation
# Today the Claude adapter is the primary path:
claude
```

That is the current default adapter path. Seed's continuity system is broader than any one host runtime, but Claude is the most complete adapter in the repo today.

The first conversation is the beginning. No configuration wizard. Just talk.

## How it works

### Day 1
You open a supported host runtime in the Seed directory. Today that path is best supported through Claude Code. The host adapter reads the boot contract, sees there is no identity yet, and starts a conversation. You talk. At the end, it writes its first `self.md` and journal entry. A relationship has begun.

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
│   ├── core/                    # Boot contract, templates, scaffolding
│   ├── fleet/                   # Multi-machine sync and SSH
│   ├── hosts/                   # Host runtime adapters (Claude, Codex, Gemini)
│   ├── inference/               # Queue server, model router
│   ├── skills/                  # Operational skill library
│   └── heartbeat/               # Autonomous pulse daemon
├── .claude/
│   ├── skills/                  # Fleet ops, publishing, research, voice
│   ├── agents/                  # Specialized subagents
│   ├── commands/                # Slash commands
│   ├── prompts/                 # SDLC role definitions
│   └── templates/               # Document, tool, and stack templates
├── setup/
│   ├── detect.sh                # Hardware detection
│   ├── install.sh               # Dependency installation
│   └── first-conversation.md    # Guide for the first meeting
└── docs/                        # Architecture, philosophy, guides
```

Root identity files are intentionally not committed. They are created locally during the first real conversation and then ignored by git.

## Packages

### Core (`packages/core/`)
Host-neutral boot contract plus identity and memory scaffolding. The relationship state itself lives at the repo root.

### Fleet (`packages/fleet/`)
Git-based sync across machines. launchd/systemd service templates. Cross-machine SSH management. Optional — works fine on a single machine.

### Inference (`packages/inference/`)
Priority-based task queue with capability routing. Model router that picks the best model for each request. Workers for local (MLX, Ollama) and cloud (Cerebras, Groq, Gemini, OpenRouter) providers. Optional — the AI works without local models, but having them means $0 inference and total privacy.

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
