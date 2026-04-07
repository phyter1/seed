# EPIC-003: Host Adapter Interface

## Status

**Done** — Completed in an earlier session. Adapter smoke tests added in session 10 (PR #74).

### Dependency updates
- ~~Depends on EPIC-002~~ — soft dependency (EPIC-003 shipped while EPIC-002 was still partial)
- ~~Blocks EPIC-006~~ — satisfied (EPIC-006 completed with decision #21)
- ~~Blocks EPIC-007~~ — satisfied (EPIC-007 completed session 10, PR #67)
- Blocks EPIC-008 — still active (EPIC-008 is Partial)

## Goal

Define and implement a stable adapter layer for supported host runtimes.

## Problem

Seed currently treats Claude as both host and product shell. Codex and Gemini need to be first-class hosts, not bolt-ons.

## Scope

- Define a host adapter interface
- Add adapters for Claude, Codex, and Gemini
- Define host capability detection and unsupported-feature handling
- Move host-specific rendering and invocation logic out of core/runtime code

## Proposed Interface

Each host adapter should implement:

- `detect()`
- `runInteractive()`
- `runHeadless()`
- `renderBootFile()`
- `renderSkills()`
- `supportsHeartbeat()`
- `supportsMcp()`
- `supportsToolPermissions()`
- `supportsStructuredOutput()`

## Initial Adapters

- `packages/hosts/claude`
- `packages/hosts/codex`
- `packages/hosts/gemini`

## Deliverables

- Adapter interface definition
- Three initial host adapters
- Shared host capability model

## Acceptance Criteria

- Seed can launch through any supported host selected in config
- Core logic no longer shells directly into `claude`
- Host-specific syntax lives only in adapters

## Dependencies

- EPIC-002

## Blocks

- EPIC-006
- EPIC-007
- EPIC-008
