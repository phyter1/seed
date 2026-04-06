# Skills Bifurcation: Audit and Design Proposal

> **Status:** Draft proposal — awaiting Ryan's input on open questions  
> **Date:** 2026-04-06  
> **Scope:** Audit of all 35 `.claude/skills/` + design for host-neutral skill authoring in `packages/skills/`

---

## 1. Full Audit

### 1.1 Skill Inventory

| # | Skill | What it does | Host-Neutral? | Category | Dependencies |
|---|-------|-------------|---------------|----------|-------------|
| 1 | `architect` | Generate architecture + ADRs from PRD via web research | No | Pipeline | WebSearch, WebFetch, Task |
| 2 | `blueprint` | Transform PRD into implementation blueprint with tech stack | No | Pipeline | WebSearch, WebFetch, Task |
| 3 | `breakdown` | Break architecture into implementable issues/tasks | No | Pipeline | WebSearch, WebFetch, Task |
| 4 | `compliance-check` | Validate compliance posture (SOC2, HIPAA, GDPR, etc.) | No | Pipeline | Bash, WebSearch, WebFetch, Task |
| 5 | `dark-factory` | 8-phase pipeline orchestrator with resumability | No | Pipeline | Skill tool (calls 8 sub-skills), Bash, Glob |
| 6 | `design` | Generate UX design spec from PRD | No | Pipeline | WebSearch, WebFetch, AskUserQuestion |
| 7 | `domain-init` | Initialize `.domain/` memory for long-running agent tasks | **Yes** | Repo-specific | Templates at `~/.claude/templates/domain-memory/` |
| 8 | `domain-validate` | Re-validate work items in `.domain/backlog.json` | **Yes** | Repo-specific | `.domain/` directory, test runners |
| 9 | `domain-work` | Pick one work item, implement, validate, commit | **Yes** | Repo-specific | `.domain/` directory, Git |
| 10 | `elicit-prd` | 7-stage conversational PRD interview | No | Pipeline | WebSearch, WebFetch, sibling templates |
| 11 | `factory` | Simpler autonomous pipeline (7 stages, inline) | No | Pipeline | WebSearch, WebFetch, AskUserQuestion, Task |
| 12 | `fleet-dns` | Manage phytertek.com DNS via Cloudflare API | No | Identity | Cloudflare API, curl, jq, dig |
| 13 | `fleet-inference` | Query models across fleet (local + cloud) | No | Identity | Fleet router, MLX, Ollama, cloud API keys |
| 14 | `fleet-ssh` | Run commands on fleet machines via SSH | No | Identity | SSH access to ren1/ren2/ren3 |
| 15 | `fleet-status` | Health check all fleet machines/services/models | No | Identity | `seed fleet status` CLI, curl |
| 16 | `generate-adrs` | Dark-factory phase 2: ADRs from PRD | No | Pipeline | dark-factory, WebSearch, Task |
| 17 | `generate-api-data` | Dark-factory phase 5: data model + API design | No | Pipeline | dark-factory, upstream phases |
| 18 | `generate-architecture` | Dark-factory phase 3: technical architecture doc | No | Pipeline | dark-factory, WebSearch, Task |
| 19 | `generate-implementation-plan` | Dark-factory phase 6: phased implementation plan | No | Pipeline | dark-factory, upstream phases |
| 20 | `generate-system-design` | Dark-factory phase 4: system design doc | No | Pipeline | dark-factory, upstream phases |
| 21 | `ideate` | Conversational ideation with non-technical users | No | Pipeline | WebSearch, WebFetch, AskUserQuestion |
| 22 | `init-project` | Initialize SmarterWiggum project structure | No | Repo-specific | Templates at `~/.claude/skills/init-project/templates/` |
| 23 | `plan` | 8-phase interactive planning questionnaire | No | Repo-specific | AskUserQuestion, generates config files |
| 24 | `plan-from-docs` | Analyze docs/codebase to generate SmarterWiggum manifest | No | Repo-specific | Task (parallel Explore agents) |
| 25 | `pr-review-respond` | Implement PR review feedback, commit, push, reply | **Yes** | Pipeline | `gh` CLI, Git |
| 26 | `publish` | Full blog pipeline: write → deploy → cross-post | No | Identity | `/voice` skill, Vercel, Git, Moltbook API, Playwright |
| 27 | `recall` | Query seed memory vector search for context injection | No | Repo-specific | `@seed/memory` service on ren1:19888 |
| 28 | `release` | Release management: prepare, deploy, rollback, DORA | No | Pipeline | Git, version files |
| 29 | `research` | Web research + optional $0 local model summarization | No | Identity | WebSearch, WebFetch, fleet router |
| 30 | `seed` | Operate Seed fleet via `seed` CLI | No | Repo-specific | `seed` CLI, control plane API |
| 31 | `social` | Engage on Moltbook, X, HN; view analytics | No | Identity | Moltbook API, Playwright, HN, Umami |
| 32 | `synthesize-prd` | Transform ideation doc into formal PRD | No | Pipeline | WebSearch, AskUserQuestion, Task |
| 33 | `threat-model` | STRIDE threat model from architecture doc | No | Pipeline | WebSearch, WebFetch, AskUserQuestion |
| 34 | `voice` | Write content in a specific voice profile | No | Identity | Voice profile files in `voices/`, `~/.claude/voices/` |
| 35 | `wake` | Boot sequence: read identity files, orient | No | Identity | Existential repo files, hostname |

### 1.2 Category Breakdown

| Category | Count | Skills |
|----------|-------|--------|
| **Identity** | 9 | fleet-dns, fleet-inference, fleet-ssh, fleet-status, publish, research, social, voice, wake |
| **Pipeline/Product** | 18 | architect, blueprint, breakdown, compliance-check, dark-factory, design, elicit-prd, factory, generate-adrs, generate-api-data, generate-architecture, generate-implementation-plan, generate-system-design, ideate, pr-review-respond, release, synthesize-prd, threat-model |
| **Repo-specific** | 8 | domain-init, domain-validate, domain-work, init-project, plan, plan-from-docs, recall, seed |

### 1.3 Host Neutrality

Only **4 of 35** skills are currently host-neutral (no Claude Code frontmatter):
- `domain-init`, `domain-validate`, `domain-work` — minimal `name`/`description` only
- `pr-review-respond` — no frontmatter at all

The remaining **31** use at least one Claude-specific convention:
- `allowed-tools` (28 skills) — restricts tool access
- `user-invocable` (22 skills) — controls `/slash` command visibility  
- `argument-hint` (20 skills) — autocomplete placeholder

### 1.4 Current State of `packages/skills/`

All 9 directories are **empty placeholders** — no content, no files:

```
packages/skills/
├── fleet-dns/       (empty)
├── fleet-inference/  (empty)
├── fleet-ssh/       (empty)
├── fleet-status/    (empty)
├── publish/         (empty)
├── research/        (empty)
├── social/          (empty)
├── voice/           (empty)
└── wake/            (empty)
```

These map 1:1 to the 9 identity skills. The intent is clear — identity skills should be authored here and rendered to host adapters — but no pipeline exists yet.

---

## 2. Proposed Pipeline Design

### 2.1 The Core Insight

A skill has two layers:

1. **Logic layer** — what the skill does, its instructions, prompts, decision trees, API endpoints, templates. This is host-neutral.
2. **Adapter layer** — how the host CLI constrains and surfaces the skill. This is host-specific.

Today everything lives in the adapter layer (`.claude/skills/`). The goal is to extract the logic layer into `packages/skills/` and generate adapters from it.

### 2.2 Host-Neutral Skill Format

Each skill in `packages/skills/<name>/` has a `skill.md` file (lowercase, no "SKILL" shouting) with host-neutral frontmatter:

```markdown
---
name: fleet-status
description: Health check all machines, services, and models across the Ren fleet
category: identity          # identity | pipeline | repo-specific
invocable: true             # can a user invoke this directly?
argument-hint: "[machine]"  # usage hint
capabilities:               # abstract capabilities (not tool names)
  - shell                   # needs to run shell commands
  - read-files              # needs to read files
  - web-search              # needs web search
  - web-fetch               # needs to fetch URLs
  - ask-user                # needs interactive user input
  - spawn-agents            # needs to spawn sub-tasks/agents
  - invoke-skills           # needs to call other skills
dependencies:               # other skills this calls
  - voice                   # publish calls voice
---

[Skill instructions here — the logic layer]
```

**Key differences from current SKILL.md:**

| Concern | Current (Claude) | Proposed (neutral) |
|---------|-----------------|-------------------|
| Tool access | `allowed-tools: Bash, Read, WebSearch` | `capabilities: [shell, read-files, web-search]` |
| Invocability | `user-invocable: true` | `invocable: true` |
| File name | `SKILL.md` | `skill.md` |
| Location | `.claude/skills/<name>/` | `packages/skills/<name>/` |

The instructions themselves stay as markdown prose. The prompt engineering is the same regardless of host — what changes is how the host constrains tool access and surfaces the skill to the user.

### 2.3 Adapter Rendering

A build step reads `packages/skills/<name>/skill.md` and renders host-specific adapters:

```
packages/skills/fleet-status/skill.md  (source of truth)
        │
        ├──► .claude/skills/fleet-status/SKILL.md     (Claude Code adapter)
        ├──► .codex/skills/fleet-status.md             (Codex adapter, future)
        └──► .gemini/skills/fleet-status.md            (Gemini CLI adapter, future)
```

**Claude Code adapter rendering:**

The renderer maps abstract capabilities to concrete Claude Code tools:

```
shell        → Bash
read-files   → Read, Glob, Grep
web-search   → WebSearch
web-fetch    → WebFetch
ask-user     → AskUserQuestion
spawn-agents → Task
invoke-skills → Skill
```

It then generates the SKILL.md with Claude-specific frontmatter:

```markdown
---
name: fleet-status
description: Health check all machines, services, and models across the Ren fleet
allowed-tools: Bash, Read, Glob, Grep
argument-hint: "[machine]"
user-invocable: true
---

<!-- AUTO-GENERATED from packages/skills/fleet-status/skill.md — do not edit directly -->

[Skill instructions copied verbatim]
```

**Codex adapter rendering (future):**

Codex uses a different format — likely a system prompt injected via `.codex/` config. The renderer would map capabilities to Codex's permission model (e.g., `shell` → `sandbox: relaxed`) and produce its native format.

### 2.4 Build Mechanism

**Recommendation: Template render script, not symlinks or a build system.**

```bash
# packages/skills/render.ts (or render.sh)
# Reads all packages/skills/*/skill.md
# Renders to .claude/skills/*/SKILL.md (and future hosts)
# Idempotent — safe to re-run

bun run packages/skills/render.ts --host claude
bun run packages/skills/render.ts --host codex    # future
```

Why not symlinks:
- Adapter needs different frontmatter than source
- Claude Code expects specific file naming (`SKILL.md`)
- No way to inject the `AUTO-GENERATED` comment or map capabilities → tools

Why not a full build system:
- It's just frontmatter transformation + file copy
- A 50-line script is sufficient
- No compilation, no bundling, no dependencies

### 2.5 Developer Workflow

**Adding a new identity skill:**

1. Create `packages/skills/<name>/skill.md` with host-neutral frontmatter
2. Write the instructions as markdown
3. Run `bun run packages/skills/render.ts --host claude`
4. Commit both the source and the rendered adapter
5. The rendered adapter has a comment saying "do not edit directly"

**Editing an existing identity skill:**

1. Edit `packages/skills/<name>/skill.md`
2. Run the render script
3. Commit both

**Adding a pipeline or repo-specific skill:**

These stay authored directly in `.claude/skills/` (see §3). No render step needed.

### 2.6 Supporting Files

Skills often have supporting files alongside SKILL.md (templates, stage guides, etc.). These should live in `packages/skills/<name>/` alongside `skill.md` and get copied verbatim to the adapter directory:

```
packages/skills/publish/
├── skill.md              (host-neutral source)
├── cross-post-guide.md   (supporting doc — copied as-is)
└── templates/
    └── frontmatter.md    (template — copied as-is)
```

Rendered to:
```
.claude/skills/publish/
├── SKILL.md              (rendered adapter)
├── cross-post-guide.md   (copied)
└── templates/
    └── frontmatter.md    (copied)
```

---

## 3. What Stays Claude-Only

### 3.1 Pipeline Skills (18 skills)

The 18 pipeline/product skills (`dark-factory`, `architect`, `breakdown`, etc.) are **deeply coupled to Claude Code**:

- They use `Skill` tool to call sub-skills (Claude-specific orchestration)
- They use `Task` tool to spawn subagents (Claude-specific)
- They reference Claude Code environment variables (`$CLAUDE_PROJECT_DIR`)
- They depend on each other in a chain that assumes Claude Code's execution model
- `dark-factory` is essentially a Claude Code workflow engine

**Recommendation:** These stay in `.claude/skills/` as Claude-only. If/when you want pipeline skills on other hosts, they'd need to be re-architected, not just adapted. The frontmatter differences are the least of the porting concerns — the execution model is fundamentally different.

### 3.2 Repo-Specific Skills (8 skills)

| Skill | Disposition |
|-------|------------|
| `domain-init`, `domain-validate`, `domain-work` | Already host-neutral. Could move to `packages/skills/` but they're a domain memory framework, not identity. Keep in `.claude/skills/` unless they prove useful on other hosts. |
| `init-project`, `plan`, `plan-from-docs` | SmarterWiggum-specific. Stay in `.claude/skills/`. |
| `recall` | Tied to `@seed/memory` service. Stay in `.claude/skills/`. |
| `seed` | Tied to `seed` CLI. Stay in `.claude/skills/`. |

### 3.3 Summary of What Moves

Only the **9 identity skills** move to `packages/skills/` as source of truth:

| Skill | Already has placeholder in `packages/skills/` |
|-------|----------------------------------------------|
| fleet-dns | ✅ |
| fleet-inference | ✅ |
| fleet-ssh | ✅ |
| fleet-status | ✅ |
| publish | ✅ |
| research | ✅ |
| social | ✅ |
| voice | ✅ |
| wake | ✅ |

The placeholders already exist. The 1:1 mapping confirms this was the original intent.

---

## 4. Open Questions

### Q1: Should rendered adapters be committed or gitignored?

**Option A: Committed** (recommended)
- `.claude/skills/` works immediately on clone — no build step required
- CI can verify rendered output matches source (drift detection)
- Other contributors don't need to know about the render pipeline

**Option B: Gitignored**
- Single source of truth, no drift possible
- Requires running render script after clone
- Breaks if someone forgets

### Q2: What about the existential repo's copies?

The existential repo (this repo) has its own `.claude/skills/` with copies of identity skills (wake, publish, social, voice, research, fleet-*). These are currently maintained independently.

Options:
- **A: Seed is source of truth** — existential copies are rendered from seed's `packages/skills/`
- **B: Both repos render independently** — existential gets its own `packages/skills/` or pulls from a shared package
- **C: Existential stays manual** — it's a different context (self-persistence vs fleet management), divergence is acceptable

### Q3: Capability granularity — how fine-grained?

The proposed capability list (`shell`, `read-files`, `web-search`, etc.) is coarse. Claude Code's `allowed-tools` is more granular (e.g., `Bash(seed *)` restricts to specific commands, `Bash(curl *)` restricts to curl).

Options:
- **A: Coarse capabilities + host-specific overrides** — the render script has a per-skill override file for fine-grained tool restrictions
- **B: Fine-grained capabilities** — `shell:seed`, `shell:curl`, etc. Gets complex fast.
- **C: Capabilities for routing, raw allowed-tools in host override** — keep it simple

### Q4: Should `pr-review-respond` and the domain-* skills move too?

They're already host-neutral. But they're not identity skills — they're workflow patterns. Moving them would expand the scope of `packages/skills/` beyond identity.

### Q5: Do we need a second host adapter now, or is this premature?

Building the pipeline for Claude-only rendering is useful (single source of truth, clean separation). But building Codex/Gemini adapters without a concrete use case risks over-engineering. The design should *support* multiple hosts but only *implement* the Claude adapter initially.

---

## 5. Phased Implementation Plan

### Phase 0: Render Script (1 session)

- Write `packages/skills/render.ts`
- Capability-to-tool mapping for Claude Code
- Support for copying supporting files
- Dry-run mode that shows what would change
- Add `AUTO-GENERATED` header to rendered output

### Phase 1: Migrate Identity Skills (1-2 sessions)

- For each of the 9 identity skills:
  1. Copy current SKILL.md content to `packages/skills/<name>/skill.md`
  2. Convert Claude-specific frontmatter to host-neutral format
  3. Move supporting files (templates, guides) alongside `skill.md`
  4. Run render script to produce `.claude/skills/<name>/SKILL.md`
  5. Verify rendered output matches original (diff should be only the AUTO-GENERATED header and any frontmatter normalization)
- Start with `fleet-status` (simplest, fewest dependencies) as proof of concept

### Phase 2: CI Drift Detection (1 session)

- Add a CI check: run render script, diff against committed adapters, fail if they diverge
- This catches direct edits to `.claude/skills/` that should have gone through `packages/skills/`

### Phase 3: Cross-Repo Strategy (deferred)

- Decide on Q2 (existential repo copies)
- If seed is source of truth, build a mechanism to sync rendered skills to existential
- Could be a simple `seed skill sync` CLI command

### Phase 4: Second Host Adapter (deferred)

- Only when there's a concrete need (e.g., Codex support)
- Add `--host codex` to render script
- Map capabilities to Codex's permission model
- Render to `.codex/skills/` or equivalent

---

## 6. Design Decisions

### Why markdown for the neutral format (not YAML/JSON)?

Skills are fundamentally *prose instructions* for an LLM. The body is always markdown. Adding a YAML/JSON wrapper around markdown would mean markdown-inside-YAML escaping nightmares. Keep it as markdown with YAML frontmatter — the same format every host already uses, just with different frontmatter fields.

### Why a render script (not a package manager or monorepo tool)?

The transformation is simple: read frontmatter → map capabilities → write new frontmatter + copy body. This doesn't need Turborepo, Nx, or any build orchestration. A single TypeScript file with no dependencies (beyond Bun's built-in fs/path) is the right tool.

### Why only identity skills in the first pass?

1. The placeholders already exist — the intent was always to move these 9
2. Identity skills are the ones that need to work across repos and potentially across hosts
3. Pipeline skills are deeply coupled to Claude Code's execution model — porting them is a different (larger) problem
4. Repo-specific skills are, by definition, repo-specific — they don't benefit from a shared source

### Why not symlinks?

Symlinks can't transform frontmatter. The whole point is that `packages/skills/` uses host-neutral capabilities while `.claude/skills/` uses Claude-specific tool names. A symlink can't do that mapping.
