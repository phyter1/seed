# EPIC-003: Host Adapter Interface

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
