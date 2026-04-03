# EPIC-005: Runtime Config Model

## Goal

Define a canonical configuration model for hosts, providers, models, routing policy, and heartbeat policy.

## Problem

The repo has partial machine detection and router config, but no unified model that expresses host selection independently from provider/model selection.

## Scope

- Define user config, machine detection config, and secret handling boundaries
- Model host defaults, provider endpoints, model inventory, and runtime policies
- Support single-machine, fleet, and hybrid setups

## Proposed Files

- `seed.config.json` — user intent
- `seed.machine.json` — hardware/runtime detection
- env vars or separate secret store for credentials

## Config Domains

- host defaults
- installed hosts
- provider registry
- model inventory
- routing policy
- heartbeat policy
- fleet topology

## Deliverables

- JSON schema or typed config definition
- Example configs for common deployment shapes
- Runtime config loading/merging rules

## Acceptance Criteria

- A user can independently choose interactive host, heartbeat host, and provider/model mix
- The config can describe local-only, cloud-only, and hybrid environments
- Runtime components read from one coherent config model

## Dependencies

- EPIC-001
- EPIC-002

## Blocks

- EPIC-004
- EPIC-006
- EPIC-008
