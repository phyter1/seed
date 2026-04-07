# EPIC-006: Heartbeat Host Dispatch

## Status

**Done** — Completed with design decision #21 (existential's heartbeat stays separate; seed builds its own host-neutral replacement).

### Dependency updates
- ~~Depends on EPIC-001~~ — satisfied (EPIC-001 completed session 10, PR #68)
- ~~Depends on EPIC-002~~ — satisfied (EPIC-002 completed session 10, PR #73)
- ~~Depends on EPIC-003~~ — satisfied (EPIC-003 completed earlier session)
- ~~Depends on EPIC-005~~ — satisfied (shipped with 005 partial; soft dependency)
- Blocks EPIC-008 — still active (EPIC-008 is Partial)
- ~~Blocks EPIC-010~~ — partially satisfied (EPIC-010 is Mostly done)

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

## Notes

- **Design Decision #21:** Existential's heartbeat (`heartbeat.sh`, `pulse.sh` on ren1) remains the operational system. This EPIC builds the *future* host-neutral replacement inside seed. The two systems coexist until this EPIC reaches feature parity with existential's proven two-tier cadence. No migration until seed's heartbeat can do everything existential's does.
