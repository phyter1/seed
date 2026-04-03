# EPIC-009: Documentation Realignment

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
