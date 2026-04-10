# Expertise Accumulation Protocol

A partner starts with templates. It becomes expert through a specific flywheel:

**Work session → discovery → project layer update → next session starts higher.**

Without this flywheel, `partner-claude.md` is a static document that drifts from reality. The partner re-reads it each session, finds it increasingly inaccurate, and compensates by reading more code — which defeats the purpose of having a living document.

This protocol specifies when and how to update the project layer.

---

## What the Project Layer Is For

The project layer in `partner-claude.md` is not a design doc. It is not documentation for humans. It is a **fast-path to fluency for the next session** — written by you, for you, after you've already done the work.

The test: could the next instance of you, reading this section cold, reach working fluency in under 5 minutes? If the answer is no, the section has failed.

---

## When to Update

### Triggers that require an update

- You discovered something that contradicts the current CLAUDE.md (architecture, conventions, constraints)
- You solved a non-obvious problem that would have taken more than 10 minutes to re-solve from scratch
- The project's current state changed in a way that affects what you'd do next
- A design decision was made and the reasoning should survive the gap
- You learned a constraint from failing (a test suite that must pass, a type error that always bites in a specific pattern, a build step that silently swallows errors)

### Triggers that don't require an update

- You made routine progress on a known task
- You wrote a journal entry with context that's only relevant to this conversation
- Something changed that's tracked adequately in git history

**When uncertain:** put it in the journal entry. If you find yourself re-deriving the same thing in a later session, that's the signal to move it into CLAUDE.md.

---

## Where New Knowledge Goes

### Architecture section
- File layout changes (new packages, renamed modules, removed directories)
- Data flow that isn't obvious from reading the code
- The "why" behind structural decisions (not just what exists, but why it's shaped that way)

### Working Model section
- Anything that must be true for changes to not break: test commands that must pass, build steps in the right order, migration steps, deployment gates
- Mandatory conventions that aren't enforced by tooling (naming patterns, commit message formats, PR rules)
- Things that *look* like they should work but don't (traps — document the trap and the workaround)

### Domain Knowledge section
- Concepts specific to this codebase that aren't in the standard vocabulary for the technology
- The "loaded terms" that mean something specific here
- Abstractions that required work to understand (don't make the next session re-derive them)

### Current State section
- This is the only section that should be updated almost every session
- Keep it as a dated snapshot: what's working, what's broken, what's actively being built
- The previous snapshot is preserved in git history — don't worry about losing it, just overwrite it honestly
- A stale Current State is worse than no Current State: it creates false confidence

### Open Questions section
- When a question is resolved, resolve it inline: strike through the question and add a one-line answer
- Resolved questions stay — they're useful context for why the current state is what it is
- Add new questions when you encounter something genuinely unsettled that will affect future work

---

## How to Update Without Making It a Chore

The update should happen at the *end* of a session, after the work is done. Not mid-session — that breaks flow. Not days later — that requires reconstruction.

Format: at the end of your journal entry, add a section:

```
## CLAUDE.md updates this session
- [Section]: [one-line description of what changed and why]
```

Then make the actual edits. If the list is empty, that's fine — no update needed. If the list has more than 4 items, you probably accumulated too much without updating mid-arc; that's a signal the update cadence is too low.

---

## The Current State Anti-Pattern

The most common failure mode: **Current State becomes a roadmap instead of a snapshot.**

Symptoms:
- Lots of future tense ("will be", "planning to", "next step is")
- Tasks and TODOs
- Information about what you intend to do, not what is actually true

The fix: Current State only contains present-tense facts. Tasks belong in the inbox (`notes/inbox/`) or a task tracker. If you find future-tense language, delete it or move it.

---

## Accumulation Failure Modes

**The drift problem:** CLAUDE.md was accurate when written but has fallen behind the code. Next session the partner reads it, trusts it, and makes incorrect assumptions. Fix: treat stale Current State sections as a warning sign. If the last update was more than a week ago and the project was active, the section is probably stale.

**The over-documentation problem:** Every session adds a paragraph. The document grows until no one reads it carefully. Fix: before adding, ask if something existing can be *replaced* rather than appended to. Accuracy > completeness.

**The design-doc problem:** The project layer becomes aspirational — describing the system as it should be, not as it is. Fix: only write what's observably true today. Aspirations belong in `objectives.md`.

**The redundancy problem:** The same fact exists in the journal entry AND in CLAUDE.md. Journal entries are ephemeral context; CLAUDE.md is permanent reference. When something moves from journal to CLAUDE.md, it can be stripped from future journal entries. Don't carry both.
