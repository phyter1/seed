# EPIC-009: Documentation Realignment

## Status

**Done** — README updated with key concepts, boot file rendering status, corrected tree labels. Architecture doc updated to accurately describe `packages/skills/`.

### Dependency updates
- ~~Depends on EPIC-001~~ — satisfied (EPIC-001 completed session 10, PR #68)
- ~~Depends on EPIC-002~~ — satisfied (EPIC-002 completed session 10, PR #73)
- ~~Depends on EPIC-007~~ — satisfied (EPIC-007 completed session 10, PR #67)
- ~~Depends on EPIC-008~~ — satisfied (PR #80)
- Blocks EPIC-010 — still active (EPIC-010 is Mostly done)

## Goal

Rewrite public docs so they describe the actual architecture and the new host/provider split.

## Problem

Current docs overstate portability in some areas and understate Claude coupling in others. They also describe paths and package roles that do not match the repo.

## Scope

- Update README to distinguish host vs provider
- Update architecture docs to remove Claude as the system center
- Document supported deployment shapes and current limitations
- Align examples and quickstart with the real setup flow

## Deliverables

- Updated `README.md`
- Updated `docs/architecture.md`
- Any additional guides needed for host/provider concepts

## Acceptance Criteria

- A new reader can understand the difference between host runtime and provider runtime
- Docs reference paths that actually exist
- Claimed portability matches implemented portability

## Dependencies

- EPIC-001
- EPIC-002
- EPIC-007
- EPIC-008

## Blocks

- EPIC-010
