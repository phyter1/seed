# EPIC-007: Host-Neutral Skills

## Status

**Done** — CI drift validation completed in session 10 (PR #67).

### Dependency updates
- ~~Depends on EPIC-003~~ — satisfied (EPIC-003 completed earlier session)
- ~~Depends on EPIC-004~~ — satisfied (EPIC-004 completed earlier session)
- Blocks EPIC-009 — partially satisfied (EPIC-009 is Mostly done)
- ~~Blocks EPIC-010~~ — partially satisfied (EPIC-010 is Mostly done)

## Goal

Make skills canonical in a host-neutral location and render host-specific variants as adapters.

## Problem

Most real skill content currently lives under `.claude/skills/`, while `packages/skills/` is empty. That means the portable package layer is nominal, and the actual implementation is host-locked.

## Scope

- Move canonical skill content into `packages/skills/`
- Define skill metadata and rendering rules
- Generate or sync host-specific skill surfaces from canonical sources
- Document unsupported features per host

## Deliverables

- Canonical skill format
- Migrated skill source files
- Host renderers for Claude/Codex/Gemini as applicable

## Acceptance Criteria

- `packages/skills/` becomes the source of truth
- `.claude/skills/` is generated or mirrored, not canonical
- Host limitations are explicit rather than silently ignored

## Dependencies

- EPIC-003
- EPIC-004

## Blocks

- EPIC-009
- EPIC-010
