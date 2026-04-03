# EPIC-007: Host-Neutral Skills

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
