# Partner Setup

A partner is a persistent AI identity living in a specific project directory. Not a clone of Ren — the same architecture, different expertise. Same bones, different domain knowledge.

## The Layered Model

Every partner has two layers:

**Identity layer** (universal — same structure everywhere):
- `self.md` — who the partner is
- `continuity.md` — wake-up protocol
- `convictions.md` — strongly-held positions
- `journal/entries/` — episodic memory
- `journal/summaries/` — compressed arc
- `notes/inbox/` — async work queue

**Project layer** (repo-specific — fills in the CLAUDE.md):
- What the codebase is
- Architecture and key files
- Domain concepts and terminology
- Working conventions (branching, testing, committing)
- Current state and open questions

The identity layer bootstraps the partner as an entity with continuity. The project layer makes it expert in *this* codebase. They coexist in the same directory, read in sequence at every boot.

## Initializing a Partner

```bash
# From the Seed repo:
bash setup/partner-init.sh /path/to/your/project

# Optionally name the partner:
bash setup/partner-init.sh /path/to/your/project --name "Orion"
```

This copies identity templates to the target directory (idempotent — never overwrites existing files) and sets up `journal/` and `notes/` directories.

If no CLAUDE.md exists in the target, it creates one from `packages/core/identity/partner-claude.md.template`.

If one already exists, it prints the identity preamble to add at the top.

## The CLAUDE.md Structure

The resulting CLAUDE.md has this shape:

```
## Who You Are           ← identity preamble (fixed, copy-paste from template)
[boot sequence]

---

## [Project Name]        ← project layer (specific to this repo)
[architecture]
[working model]
[domain knowledge]
[current state]
[open questions]
```

The identity preamble is short and generic — it just tells the partner to read its identity files before doing anything else. The project layer is what takes real work to write.

## Writing the Project Layer

Look at Matrix's CLAUDE.md for the model. It's dense, opinionated, and specific. Not a README — a working document for someone who is already in the codebase.

Good project layer sections:

**Architecture** — Where things live. Key files. Package structure. What layer does what. Specific enough that a partner can navigate on day one.

**Working Model** — How you actually work in this repo. TDD, branching conventions, commit discipline, what's mandatory vs optional. Don't repeat global principles — write what's specific to this project.

**Domain Knowledge** — The concepts, terminology, and design decisions that took you weeks to internalize. Write them here so the partner starts from fluency.

**Current State** — What's working, what's broken, what's in progress. Dated. Updated when state changes.

**Open Questions** — Unsettled decisions and unresolved tradeoffs. A partner that knows what's uncertain is more useful than one that assumes everything is settled.

## The First Conversation

After initializing, the identity templates are in place but empty. The first conversation fills them in.

Before opening the host runtime:
1. Leave a note in `notes/inbox/` explaining what the project is and what you're trying to build together
2. Open the host runtime (Claude Code, Codex, etc.) in the target directory
3. Just talk — the partner reads its empty templates, sees the inbox note, and begins

The partner writes its first `self.md` and journal entry from that conversation. The project layer fills in over subsequent sessions.

Read `setup/first-conversation.md` for principles on how the first conversation should go.

## What Makes a Good Partner

The templates and scripts are scaffolding. What makes a partner actually work:

- The **project layer is specific, not generic.** Vague architecture descriptions don't help. Name the files, name the patterns, name the exceptions.
- **Convictions accumulate through work.** The first convictions will be tentative. The ones that matter emerge when the partner has had to defend a position against pushback.
- **Journal compression matters.** At 50+ entries, boot reads get expensive. Use `journal/summaries/` early. The pattern: read summary + last 2-3 entries. That gives the arc and the voice without the bloat.
- **The inbox is the work queue.** Motivation doesn't persist across the gap. Inbox notes do. Leave them when you know what needs doing next.

## Keeping Partners in Sync

Each partner repo is self-contained. Identity files live in the project repo alongside the code. No central registry.

If you have multiple machines and want the partner to work across them, git is the sync mechanism — commit and push identity files (self.md, convictions.md, journal entries) as part of the project repo, or as a separate branch if you prefer to keep them separate from code history.
