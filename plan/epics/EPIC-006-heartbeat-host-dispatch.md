# EPIC-006: Heartbeat Host Dispatch

## Goal

Refactor heartbeat execution so it dispatches through the selected host adapter rather than directly invoking Claude CLI.

## Problem

Current heartbeat is hard-coupled to `claude -p` and Anthropic model naming. That prevents runtime host selection and makes autonomy vendor-specific.

## Scope

- Replace direct CLI invocation with host dispatch
- Make heartbeat resolve host and model from config
- Standardize logs and error handling across hosts
- Preserve note ingestion/archive behavior and journal diffing

## Deliverables

- Host-neutral heartbeat runner
- Per-host dispatch logic
- Config-driven quick/deep profile selection
- Failure reporting for unsupported host capabilities

## Acceptance Criteria

- Heartbeat can run via Claude, Codex, or Gemini when configured
- No heartbeat script directly embeds Claude model names or CLI syntax
- Logs include selected host, selected model/profile, and exit state

## Dependencies

- EPIC-001
- EPIC-002
- EPIC-003
- EPIC-005

## Blocks

- EPIC-008
- EPIC-010
