# Seed Refactor Backlog

## Objective

Refactor Seed into a host-agnostic runtime that can operate through Claude Code, Codex CLI, Gemini CLI, or future hosts while routing work across any configured local or cloud model providers.

## Principles

- Continuity is the product; host integrations are adapters.
- Host and provider must remain separate abstractions.
- The documented filesystem contract must match the real repo.
- Public docs should describe what exists, not what is planned.
- Runtime selection should be config-driven, not hardcoded into scripts.

## MVP

The first meaningful milestone is:

1. Canonical root-level identity/journal/notes layout
2. Host-neutral boot spec
3. Claude/Codex/Gemini host adapters
4. Config-driven heartbeat dispatch
5. Provider/model configuration independent of host choice

## Execution Order

1. [EPIC-001](./epics/EPIC-001-canonical-filesystem-contract.md) — Canonical Filesystem Contract
2. [EPIC-002](./epics/EPIC-002-host-neutral-boot-spec.md) — Host-Neutral Boot Spec
3. [EPIC-003](./epics/EPIC-003-host-adapter-interface.md) — Host Adapter Interface
4. [EPIC-005](./epics/EPIC-005-runtime-config-model.md) — Runtime Config Model
5. [EPIC-006](./epics/EPIC-006-heartbeat-host-dispatch.md) — Heartbeat Host Dispatch
6. [EPIC-004](./epics/EPIC-004-provider-adapter-interface.md) — Provider Adapter Interface
7. [EPIC-007](./epics/EPIC-007-host-neutral-skills.md) — Host-Neutral Skills
8. [EPIC-008](./epics/EPIC-008-setup-and-install-refactor.md) — Setup and Install Refactor
9. [EPIC-009](./epics/EPIC-009-documentation-realignment.md) — Documentation Realignment
10. [EPIC-010](./epics/EPIC-010-repo-quality-and-validation.md) — Repo Quality and Validation

## Risks

- The current repo has a split-brain filesystem contract: docs and boot file describe root-level identity files, while scaffolding lives under `packages/core/`.
- `.claude/` currently contains most real skill implementation, so adapter extraction will be invasive.
- Heartbeat is hard-coupled to Claude CLI semantics.
- Codex and Gemini are suitable host adapters, but neither should be treated as a universal provider abstraction.

## Exit Criteria

Seed reaches the target architecture when:

- a user can choose `claude`, `codex`, or `gemini` as the host
- a user can independently configure provider/model mixes
- the continuity system is no longer described or implemented as Claude-specific
- the repo’s documented structure matches the actual structure
