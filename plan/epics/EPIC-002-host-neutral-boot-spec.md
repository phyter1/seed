# EPIC-002: Host-Neutral Boot Spec

## Status

**Done** — Completed in session 10 (PR #73, rendered BOOT.md into CLAUDE.md).

### Dependency updates
- ~~Depends on EPIC-001~~ — satisfied (EPIC-001 completed session 10, PR #68)
- ~~Blocks EPIC-003~~ — satisfied (EPIC-003 completed earlier session; shipped while 002 was still partial — soft dependency)
- ~~Blocks EPIC-006~~ — satisfied (EPIC-006 completed with decision #21)
- Blocks EPIC-009 — partially satisfied (EPIC-009 is Mostly done)

## Goal

Replace `CLAUDE.md` as the source of truth with a host-neutral boot specification that can be rendered into host-specific entrypoints.

## Problem

Today the continuity contract and the Claude adapter are the same artifact. That makes the system appear Claude-native even when the intended product is broader.

## Scope

- Create a host-neutral boot source file
- Move continuation, first-conversation, permissions, and mode semantics into it
- Define how host-specific boot wrappers are derived
- Establish versioning or regeneration rules for host wrappers

## Proposed Structure

- `packages/core/boot/BOOT.md` or `seed.boot.md` as canonical spec
- Host wrappers generated or synchronized from the spec:
  - `CLAUDE.md`
  - Codex-specific boot wrapper
  - Gemini-specific boot wrapper

## Deliverables

- Canonical boot spec file
- Generation/render strategy for host wrappers
- Updated docs describing host wrappers as adapters

## Acceptance Criteria

- The continuity contract is readable without referencing Claude-specific files
- Host wrappers can differ in syntax while preserving the same behavioral contract
- New hosts can be added without rewriting the continuity system

## Dependencies

- EPIC-001

## Blocks

- EPIC-003
- EPIC-006
- EPIC-009
