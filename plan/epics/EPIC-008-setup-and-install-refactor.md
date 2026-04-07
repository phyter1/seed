# EPIC-008: Setup and Install Refactor

## Status

**Partial** — `seed.config.example.json` defaults to "claude"; needs host-neutral treatment in setup flows.

### Dependency updates
- ~~Depends on EPIC-003~~ — satisfied (EPIC-003 completed earlier session)
- ~~Depends on EPIC-004~~ — satisfied (EPIC-004 completed earlier session)
- Depends on EPIC-005 — still active (EPIC-005 is Partial; config model needed)
- ~~Depends on EPIC-006~~ — satisfied (EPIC-006 completed with decision #21)
- Blocks EPIC-009 — still active (EPIC-009 is Mostly done)
- Blocks EPIC-010 — still active (EPIC-010 is Mostly done)

## Goal

Refactor setup and install flows to detect and configure hosts and providers independently.

## Problem

Current setup flow privileges Claude as the default/required user path and treats Codex/Gemini as optional extras. That conflicts with runtime host agnosticism.

## Scope

- Detect installed hosts separately from providers/runtimes
- Install selected hosts on demand
- Generate next-step guidance based on actual chosen host
- Surface host/provider availability clearly in detection output

## Deliverables

- Updated `setup/detect.sh`
- Updated `setup/install.sh`
- Config/bootstrap generation for selected host(s)

## Acceptance Criteria

- Setup does not imply Claude is the primary path
- A user can choose Codex or Gemini as the default host during setup
- Detection output clearly separates host runtimes from model providers

## Dependencies

- EPIC-003
- EPIC-004
- EPIC-005
- EPIC-006

## Blocks

- EPIC-009
- EPIC-010
