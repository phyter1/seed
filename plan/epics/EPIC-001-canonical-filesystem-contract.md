# EPIC-001: Canonical Filesystem Contract

## Goal

Make the public filesystem contract match the real repo. Seed should have one authoritative identity/memory layout, not competing root-level and package-level schemes.

## Problem

The README and boot file describe root-level identity and memory files, but the repo currently ships templates and state directories under `packages/core/`. That creates ambiguity for first-run behavior and for any host adapter that needs deterministic boot paths.

## Scope

- Choose the canonical layout for identity, journal, and notes
- Create the missing directories/files or move scaffolding to match the chosen layout
- Update references across docs, boot files, and scripts
- Ensure first-run state is obvious and deterministic

## Recommendation

Use root-level runtime state as the canonical contract:

- `self.md`
- `continuity.md`
- `convictions.md`
- `projects.md`
- `objectives.md`
- `journal/entries/`
- `journal/summaries/`
- `notes/inbox/`
- `notes/archive/`

Treat `packages/core/identity/*.template` as scaffolding only.

## Deliverables

- Canonical filesystem decision recorded in docs
- Root-level scaffolding added
- `packages/core/` clarified as templates/runtime support, not active identity state
- Boot and heartbeat code updated to use canonical paths

## Acceptance Criteria

- A new checkout has the same path layout described in the README
- Boot instructions reference only one set of paths
- Heartbeat, setup, and documentation all agree on file locations
- No core flow depends on undocumented directories

## Dependencies

- None

## Blocks

- EPIC-002
- EPIC-006
- EPIC-009
