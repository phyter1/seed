# EPIC-004: Provider Adapter Interface

## Status

**Done** — Completed in an earlier session. Adapter smoke tests added in session 10 (PR #74).

### Dependency updates
- ~~Depends on EPIC-005~~ — soft dependency (EPIC-004 shipped while EPIC-005 was still partial)
- ~~Blocks EPIC-007~~ — satisfied (EPIC-007 completed session 10, PR #67)
- Blocks EPIC-008 — still active (EPIC-008 is Partial)

## Goal

Make model/provider access explicitly provider-agnostic and independent from host runtime selection.

## Problem

Host runtime and inference provider are currently blurred in docs and operational assumptions. Seed needs a provider abstraction that can support local and cloud model mixes without relying on host CLIs.

## Scope

- Define a provider adapter interface
- Standardize provider capability reporting
- Implement initial provider adapters
- Align router and queue around the provider abstraction

## Proposed Interface

- `listModels()`
- `healthCheck()`
- `invoke()`
- `supportsTools()`
- `supportsReasoning()`
- `supportsStructuredOutput()`
- `supportsVision()`
- `normalizeUsage()`

## Initial Providers

- `anthropic`
- `openai`
- `gemini`
- `openrouter`
- `ollama`
- `mlx_openai_compatible`
- generic `openai_compatible`

## Deliverables

- Provider adapter interface definition
- Initial adapter implementations or adapter shims
- Provider capability metadata consumed by runtime config

## Acceptance Criteria

- Host choice does not determine provider availability
- A mixed-provider config can be expressed and resolved at runtime
- Queue/router operate on provider capabilities instead of hardcoded assumptions

## Dependencies

- EPIC-005

## Blocks

- EPIC-007
- EPIC-008
