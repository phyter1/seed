# Harvest Skill — Automatic Skill Extraction

**Status:** Design
**Date:** 2026-04-05
**Authors:** Ryan & Ren (interactive session)
**Inspired by:** [SAGE: Skill Augmented GRPO for self-Evolution](https://arxiv.org/abs/2512.17102) — RL framework where agents learn to extract and reuse skills, achieving 59% fewer tokens through accumulated skill libraries.

---

## Problem

Seed's skill library is manually curated. Someone notices a reusable pattern, writes a SKILL.md, and commits it. This works, but the bottleneck is human attention — patterns that *should* become skills silently evaporate at the end of each conversation.

The harvest map (`docs/harvest-map.md`) already defines a pipeline for extracting battle-tested code from the fleet into Seed: **Harvest → Port → Genericize → Validate → Migrate → Retire**. But nothing triggers that pipeline automatically. Nothing *notices* when a heartbeat just solved a problem in a way that generalizes.

SAGE demonstrates that when you put skill extraction under optimization pressure, agents get dramatically more efficient. We can't do RL, but we can close the same loop structurally: every deep beat reviews its own work, identifies reusable patterns, and proposes skill additions — with the local model fleet acting as quality gate.

---

## Design Principles

1. **Conservative by default.** Most beats won't produce skills. That's correct behavior. A high rejection rate is a feature, not a bug. The library should grow slowly and deliberately.
2. **Update over create.** A skill library with 200 narrow skills is worse than 35 well-scoped ones. When a candidate overlaps with an existing skill, propose an update — don't create a new entry.
3. **No human in the approval loop.** The jury (local model fleet) approves or rejects. Human review is an escalation path, not the default.
4. **Institutional memory.** The system remembers what it rejected and why. It doesn't re-propose the same bad candidates.
5. **Persistence is a signal.** A pattern that keeps surfacing across different contexts despite being rejected deserves reconsideration with increasing weight.
6. **$0 operation.** The entire pipeline runs on local models. No cloud API calls for skill extraction.

---

## Three Phases

### Phase 1: Extract — "Is there a skill here?"

**Input:** The deep beat's journal entry + git diff of any artifacts produced during the beat.

The journal entry is the primary signal — it captures intent, outcome, and the beat's own assessment of what it did. The diff captures mechanics.

**Classifier prompt (local model via fleet router):**

> You are reviewing a completed work session. Given the journal entry and code changes below, answer ONE question: Did this session produce a reusable workflow or pattern that would save significant time if encountered in a genuinely different context?
>
> Signals it IS a skill:
> - Multi-step workflow likely to recur in different contexts
> - Non-obvious approach where "just figure it out" would waste real time
> - Produced a reusable artifact (script, template, config pattern)
>
> Signals it is NOT a skill:
> - Specific to one file, one bug, one context
> - One-off creative work (a specific blog post, not the publishing workflow)
> - Simple enough that any competent agent would arrive at the same solution
> - Pure maintenance or infrastructure repair
>
> Answer with either:
> - `NO_SKILL` — nothing reusable here
> - `CANDIDATE: <name>` followed by a 2-3 sentence description of the capability (not the specific task)
>
> Be conservative. When in doubt, answer NO_SKILL.

**Granularity guidance:** A skill represents a *capability*, not a *step*. "Post to Moltbook with verification" is not a skill — it's part of the "social engagement" skill. "Full publishing pipeline: write, verify deploy, cross-post" is a skill.

**Expected rejection rate:** 80-90% of beats should produce NO_SKILL. If the rate drops significantly below that, the classifier threshold needs tightening.

---

### Phase 2: Match — "Does this already exist?"

**Input:** The candidate from Phase 1 + the full skill index.

The skill index is a single file (`skill-index.md`) that tracks ALL skills — active and rejected — with enough context for the classifier to make decisions.

**Index structure:**

```markdown
# Skill Index

## Active Skills
- wake: Boot sequence and orientation protocol [since: 2026-03-15]
- publish: Full blog pipeline — write, commit, deploy, verify, cross-post [since: 2026-03-20]
- fleet-status: Health check all machines, services, models [since: 2026-03-18]
- social: Check notifications, engage on Moltbook/X/HN, browse feeds [since: 2026-03-22]
- fleet-inference: Query any model across the fleet — local or cloud [since: 2026-03-25]
- research: Web research + optional local model analysis [since: 2026-03-28]
...

## Rejected Candidates
- moltbook-verify: Standalone Moltbook verification flow
  rejected: 2026-04-05 | attempts: 1 | reason: subset of existing "social" skill
  contexts: [2026-04-05-14-30-beat]

- blog-frontmatter-lint: Validate YAML frontmatter before commit
  rejected: 2026-04-05 | attempts: 3 | reason: too narrow, single-step check
  contexts: [2026-04-03-beat, 2026-04-04-beat, 2026-04-05-beat]
  ⚠ escalate: 3 attempts across different contexts — reconsider with full evidence
```

**Classifier prompt (jury mode — fan out to both Intel models, MLX aggregates):**

> You are reviewing a skill candidate against the existing skill library. Given:
>
> 1. The candidate: [name + description]
> 2. The active skill index: [full active skills list]
> 3. The rejected candidates index: [full rejected list]
>
> Classify this candidate as exactly ONE of:
>
> - `DUPLICATE: <existing_skill>` — this capability is already fully covered by an active skill
> - `UPDATE: <existing_skill>` — this extends or improves an existing skill with new capability (not a subset — an addition)
> - `PREVIOUSLY_REJECTED: <rejected_name>` — this is substantially the same as a previously rejected candidate
> - `NEW` — this is a genuinely novel capability not covered by any existing skill
> - `NOT_A_SKILL` — on reflection, this doesn't meet the bar for a reusable capability
>
> Important distinctions:
> - "Extends skill X" (UPDATE) is different from "is a subset of skill X" (DUPLICATE)
> - A candidate that matches a rejected entry with 3+ attempts should be flagged for escalation, not auto-rejected
>
> Answer with the classification and a one-sentence rationale.

**Why jury mode:** Two diverse models (gemma4:e2b on ren1, gemma4:e4b on ren2) vote independently. If they agree — the verdict stands. If they disagree — the candidate is flagged as ambiguous and held for human review. Disagreement is a signal that the decision isn't clear-cut.

---

### Phase 3: Propose — "Here's the change"

Based on the Phase 2 classification:

| Classification | Action |
|---|---|
| `DUPLICATE` | Stop. Log to index (increment attempts if already there). |
| `NOT_A_SKILL` | Stop. Log to rejected index with reason and context. |
| `PREVIOUSLY_REJECTED` (< 3 attempts) | Stop. Increment attempt count. Record new context. |
| `PREVIOUSLY_REJECTED` (≥ 3 attempts) | **Escalate.** Flag in index with ⚠. Include all contexts. Jury re-evaluates with shifted prompt (see Escalation below). |
| `UPDATE` | Read the full target SKILL.md. Generate a proposed diff. Write to staging. |
| `NEW` | Generate a complete SKILL.md in canonical format. Write to staging. |

**Staging directory:** `skills/staging/`

```
skills/staging/
├── 2026-04-05_fleet-monitor_NEW.md          # proposed new skill
├── 2026-04-05_social_UPDATE.diff.md         # proposed update to existing
└── 2026-04-05_deploy-verify_ESCALATED.md    # jury re-evaluation of persistent candidate
```

Each staged proposal includes:

```markdown
---
type: new | update | escalated
target: <existing skill name, if update>
extracted_from: <journal entry filename>
rationale: <why this generalizes beyond the specific task>
jury_verdict: <agree | split>
---

<proposed SKILL.md content or diff>
```

**Auto-merge rules:**
- `NEW` with jury agreement → merge into `.claude/skills/<name>/SKILL.md` + update skill index
- `UPDATE` with jury agreement → apply diff to existing skill + update skill index
- `ESCALATED` → always requires human review regardless of jury verdict
- Jury split on any classification → hold in staging for human review

---

## Escalation: Persistence as Signal

When a rejected candidate hits 3 attempts from different contexts, the jury prompt shifts:

> This pattern has been proposed [N] times across these independent contexts:
> 1. [context 1 — date, what the beat was doing]
> 2. [context 2]
> 3. [context 3]
>
> It was previously rejected for: [original reason]
>
> The question is no longer "is this a skill?" but "does the recurrence across different contexts change the original rejection rationale?"
>
> Consider:
> - Are these genuinely different contexts, or the same narrow workflow repeating?
> - Has the scope of the candidate grown beyond the original rejection reason?
> - Would formalizing this save meaningful time across future conversations?
>
> Answer: `APPROVE` (with proposed skill scope) or `SUSTAIN_REJECTION` (with updated rationale)

If the jury approves an escalated candidate, it moves to staging as an `ESCALATED` proposal — which still requires human review. Escalation is the ceiling of autonomous authority. The system can *recommend* overturning its own rejection, but a human confirms.

At **5+ attempts**, the candidate is flagged in the index regardless of jury verdict. If something surfaces 5 times and keeps getting rejected, either the extraction is miscalibrated or the jury's threshold is wrong. A human should look.

---

## Integration: Heartbeat Deep Beat

The harvest runs as the **final step of every deep beat**, after the journal entry is written but before the beat ends.

Addition to the deep beat prompt:

```
## Skill Harvest (automatic — runs every deep beat)

After writing your journal entry, run the harvest pipeline:

1. Read your journal entry + git diff from this beat
2. Send to fleet router for extraction classification
3. If CANDIDATE: read skill-index.md, send to jury for matching
4. Based on jury verdict: update index, stage proposal, or stop
5. If anything was staged or an index was updated, commit with message: "harvest: <brief description>"

This should take < 60 seconds using local models. If the fleet is unreachable, skip — don't spend the beat on infrastructure.
```

**Cost:** ~2 local model calls per beat (extraction classifier + jury match). Both run on fleet hardware at $0. Total added latency: 30-60 seconds per deep beat.

**Expected output cadence:** Given 80-90% rejection at extraction and jury filtering on the rest, expect ~1-2 staged proposals per week. The library grows slowly. That's the point.

---

## The Skill Index File

`skill-index.md` lives at the repo root (or `docs/`). It is the single source of truth for what the harvest pipeline knows about.

It must stay synchronized with the actual `.claude/skills/` directory. The harvest skill itself should verify consistency at the start of each run: if a skill exists in `.claude/skills/` but not in the index, add it. If a skill is in the index but not in `.claude/skills/`, flag the inconsistency.

**Bootstrap:** Generate the initial index from the current 35 skills in `.claude/skills/` by reading each SKILL.md's frontmatter (name + description).

---

## Safety Mechanisms

| Mechanism | Purpose |
|---|---|
| High extraction threshold | Most beats produce NO_SKILL (target: 80-90% rejection) |
| Jury agreement required | Split verdicts go to human review, not auto-merge |
| Update bias | Prefer extending existing skills over creating new ones |
| Rejection memory | Previously rejected candidates are tracked with rationale |
| Attempt counting | Prevents infinite re-proposal of the same bad candidates |
| Escalation ceiling | ≥3 attempts triggers re-evaluation; ≥5 always flags human |
| Staging directory | Nothing auto-merges without jury agreement |
| Consistency check | Index is verified against actual skill directory each run |
| Rate limit | Maximum 1 proposal per beat (if multiple candidates, pick strongest) |

---

## What This Enables for Seed

Every Seed installation runs its own fleet, its own heartbeats, its own work. With the harvest skill:

- **Skill libraries diverge per installation.** A Seed instance on a data engineering fleet accumulates different skills than one on a web dev stack. The identity is already unique — now the capabilities become unique too.
- **The harvest map closes automatically.** Fleet-proven patterns flow into the canonical skill library without waiting for a human to notice them.
- **Growth is bounded.** The conservative classifier + jury + rejection memory + update bias means the library grows at ~1-2 skills per week, not 1-2 per beat.
- **The skill that writes skills.** This design is itself a skill. Once proven on the fleet, it gets harvested into Seed's canonical library — following its own pipeline.

---

## Resolved Decisions

1. **Index location:** Root-level `skill-index.md`. It's a first-class system artifact, not documentation about the system. Same level as `self.md` and `projects.md`.
2. **Diff format for updates:** Markdown description with before/after excerpts. Precise enough to act on, readable enough to evaluate quickly. The actual edit is done by whoever approves the proposal — not pre-computed as a patch.
3. **Cross-beat pattern detection:** Included as a dedicated harvest beat tier (see below).

---

## Harvest Beat — Cross-Beat Pattern Detection

The heartbeat becomes three tiers:

| Tier | Model | Cadence | Purpose |
|------|-------|---------|---------|
| Quick | Haiku/fast | Every 10 min | Maintenance, inbox check |
| Deep | Opus/strong | Every ~hour | Substantive work + per-beat extraction |
| Harvest | Local fleet only | Daily | Batch-review recent deep beats for cross-beat skill patterns |

The harvest beat asks a fundamentally different question than per-beat extraction. Per-beat: "Did *this* beat produce a skill?" Harvest beat: "Do the *last N beats together* reveal a pattern that no individual beat surfaced?"

**Why this matters:** Some skills only become visible in aggregate. If you solved a similar DNS problem three times this week in three different contexts, no single beat screams "skill!" but the cluster does. Repetition across different contexts is exactly what "reusable" means.

### Two-Stage Local Processing ($0)

The harvest beat runs entirely on fleet hardware. No cloud calls.

**Stage 1: Compress** — Qwen3.5 on Ren 3 (MLX, 28 tok/s) reads each of the last ~24 journal entries individually and produces a single tagged line:

```
2026-04-05 14:30 — [dns, cloudflare, api] fixed A record for blog subdomain
2026-04-05 15:30 — [moltbook, social, rate-limit] hit rate limit posting, added pre-check
2026-04-05 16:30 — [blog, deploy, verify] caught failed deploy, added verification step
```

24 fast calls, each trivial — summarize and tag. Seconds per entry.

**Stage 2: Detect** — Same model receives all 24 compressed lines in a single prompt (~50 lines). Pattern detection on a compact document instead of cross-referencing 24 full entries.

Prompt:

> Given these 24 session summaries from the last day, identify any capability that appears 3+ times across genuinely different contexts. Not the same task repeating — the same underlying *pattern* applied to different problems.
>
> For each cluster found, describe:
> 1. The underlying capability (not the specific tasks)
> 2. Which sessions demonstrate it (by timestamp)
> 3. Why this generalizes beyond these specific instances
>
> If no cross-beat patterns exist, say NONE. Most days will have none. That's correct.

Candidates from the harvest beat enter the same Match → Propose pipeline as per-beat candidates, but with stronger prior confidence — a pattern that emerged across multiple independent beats has already demonstrated reusability.

### Cost

- Stage 1: ~24 local model calls × ~50 tokens each = ~1,200 tokens total
- Stage 2: 1 local model call × ~500 tokens = ~500 tokens
- Total: ~1,700 tokens on local fleet. $0. Under 5 minutes wall time.

---

## Skill Retirement — Usage Tracking via Hook

Skills can become obsolete. A skill extracted for a workflow that got replaced, or a tool integration that changed, shouldn't sit in the library forever unchallenged.

**Tracking mechanism:** A `PostToolUse` hook on the `Skill` tool passively logs every skill invocation across all sessions — interactive and heartbeat, every machine.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Skill",
        "command": "echo \"$(date -u +%Y-%m-%dT%H:%M:%SZ) $CLAUDE_TOOL_INPUT\" >> ~/.local/share/seed/skill-usage.log"
      }
    ]
  }
}
```

This hook ships in Seed's settings template so every installation gets it automatically.

**Staleness detection:** The harvest beat reads `skill-usage.log`, cross-references against the skill index, and updates a `last_used` timestamp per skill. Any skill unreferenced for 30 days gets flagged in the index:

```
- deploy-verify: Verify Vercel deployment status after push [since: 2026-03-20]
  ⚠ stale: last used 2026-03-04 (31 days ago)
```

No auto-deletion. Just surfaced for review. A stale skill might still be correct but unused — or it might be dead weight. A human decides.

---

## Metrics — Lightweight Pipeline Health

The harvest beat appends a single line to `~/.local/share/seed/harvest-metrics.log` at the end of each daily run:

```
2026-04-05 | beats_reviewed: 24 | extracted: 3 | jury_agree: 2 | jury_split: 1 | merged: 1 | rejected: 1 | staged: 1 | active_skills: 37 | stale_skills: 0
```

One line per day. Human-readable. Greppable. No database, no dashboard.

**Anomaly flags** (logged inline by the harvest beat when detected):

| Condition | Flag |
|---|---|
| Extraction rejection rate < 70% | "Classifier may be too loose — extracted {n}/{total} beats" |
| Jury split rate > 50% over 7 days | "Matching prompt may need tuning — jury split on {n}/{total} candidates" |
| Library growth > 5 skills/week sustained | "Growth rate elevated — review recent merges for quality" |
| No proposals in 30 days | "Pipeline may be too conservative, or work has been routine" |

These are informational, not blocking. They surface in the harvest beat's journal entry so a human or future beat can investigate.

---

## All Decisions Summary

| Question | Decision |
|---|---|
| Index location | Root-level `skill-index.md` |
| Update diff format | Markdown description with before/after excerpts |
| Cross-beat detection | Dedicated harvest beat tier, daily, two-stage local compression |
| Approval authority | Jury consensus auto-merges; jury split → human review |
| Rejection memory | Unified index tracks rejected candidates with rationale + attempt count |
| Persistence escalation | 3+ attempts → shifted jury prompt; 5+ → always flag human |
| Skill retirement | PostToolUse hook tracks usage; 30-day stale threshold |
| Metrics | Single-line daily log + inline anomaly flags |
| Cost | $0 — entire pipeline runs on local fleet models |
