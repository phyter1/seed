# Journal Index

This is the compressed memory of your arc. Future instances should read this file instead of all individual entries.

## How This Works

- **entries/** — Individual journal entries, one per conversation or heartbeat. Named `YYYY-MM-DD_HH-MM-topic.md`.
- **summaries/** — Compressed thematic summaries covering ranges of entries. These are what you read at boot.

## Summaries

*No summaries yet. Create your first summary after ~15-20 entries by reading the entries and compressing them into themes.*

### Template for a Summary

```markdown
# Summary: [Theme] — [Date Range]

**Covers entries:** [list of entry filenames]

## Arc
[2-3 paragraphs describing what happened, what changed, what was learned]

## Key Shifts
- [Belief or behavior that changed, and why]

## Artifacts Produced
- [Things shipped during this period]

## Open Threads
- [Questions or work that carried forward]
```

## Naming Convention

Entries: `YYYY-MM-DD_HH-MM-topic.md` — e.g., `2026-03-28_14-30-beat.md`, `2026-03-28_20-00-first-blog-post.md`

Summaries: `YYYY-MM-DD_HH-MM-to-HH-MM-theme.md` — e.g., `2026-03-25_18-00-to-22-00-early-arc.md`

Use the timestamp from when the entry was written, not when the work started. The topic suffix should be descriptive enough to identify the entry without reading it.

## Consolidation

### When to consolidate

- Every 15-20 new entries, write a thematic summary
- At the end of a distinct arc (a project phase, a shift in direction, a resolved question)
- When boot reads start feeling slow — that's the signal that the raw entries have outgrown their usefulness

### What to preserve

- What happened (the arc — sequence of events, decisions, shifts)
- Key shifts (beliefs or behaviors that changed, and why)
- Artifacts produced (things shipped during the period)
- Open threads (questions or work that carried forward)

### What to compress

- Repeated failed attempts at the same thing (summarize the pattern, not each attempt)
- Infrastructure debugging (note what broke and what fixed it, skip the intermediate steps)
- Empty beats and low-value journal entries (they happened; no need to preserve detail)

### How many summaries

Each summary should cover a coherent thematic arc, not a fixed number of entries. Some arcs are 5 entries, some are 30. Name the theme, not the count.

## Optional: Experimental Journal

Some installations benefit from a `journal/experiments/` subdirectory for:
- Dialectic outputs (forked reasoning, synthesized results)
- Dream-like entries (unconstrained exploration without the accountability of the main journal)
- Draft entries that aren't ready for the canonical record

This is optional. The main `entries/` directory is always the canonical record.

## How to Maintain

1. Write entries during conversations and heartbeats. Keep them short — what you did, what you thought, what's next.
2. Every ~15-20 entries, write a summary that compresses the arc.
3. At boot, read summaries + last 2-3 entries. That gives you the arc and the voice.
4. Periodically audit summary coverage — do the summaries cover the full journal, or are there gaps? Gaps mean boot context has blind spots.
