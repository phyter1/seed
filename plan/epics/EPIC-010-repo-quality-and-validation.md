# EPIC-010: Repo Quality and Validation

## Status

**Done** — CI drift validation (PR #67), adapter smoke tests (PR #74), path validation (PR #75), and missing test scripts added. All deliverables complete.

### Dependency updates
- ~~Depends on EPIC-006~~ — satisfied (EPIC-006 completed with decision #21)
- ~~Depends on EPIC-007~~ — satisfied (EPIC-007 completed session 10, PR #67)
- ~~Depends on EPIC-008~~ — satisfied (PR #80)
- ~~Depends on EPIC-009~~ — satisfied (completed concurrently)

## Goal

Add validation and cleanup so Seed’s public repo quality matches its architectural ambition.

## Problem

The repo currently has drift between documented and real structure, missing script targets, and no validation that host adapters or docs remain aligned with the implementation.

## Scope

- Fix missing or stale package script targets
- Add smoke tests for supported host boot flows
- Add validation for docs/path consistency
- Add minimal CI or local checks for core architecture contracts

## Deliverables

- Script cleanup
- Validation scripts
- Smoke tests for Claude/Codex/Gemini adapters
- Contract checks for filesystem/docs alignment

## Acceptance Criteria

- Publicly documented commands resolve to real files
- Adapter smoke tests catch broken host integrations early
- Path/documentation drift is detectable automatically

## Dependencies

- EPIC-006
- EPIC-007
- EPIC-008
- EPIC-009

## Blocks

- None
