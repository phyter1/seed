# Seed Refactor Plan

This planning corpus tracks the refactor from a Claude-native relationship system to a runtime host-agnostic and provider/model-agnostic system.

## Goal

Seed should support:

- Any supported host runtime at execution time: Claude Code, Codex CLI, Gemini CLI, future hosts
- Any supported provider/model combination at execution time: local MLX, Ollama, OpenAI, Anthropic, Gemini, OpenRouter, generic OpenAI-compatible endpoints
- A single continuity system that is not coupled to one host's boot file, skill format, or CLI semantics

## Core design rule

Host and model provider are different layers.

- **Host**: the interactive or headless agent shell
- **Provider**: the API/runtime that serves models

Examples:

- Codex host + OpenRouter/OpenAI providers
- Claude host + Anthropic/Bedrock/Vertex providers
- Gemini host + Gemini provider
- Any host + local Ollama/MLX via Seed's own runtime where appropriate

## Structure

- `backlog.md` — overview, sequencing, MVP
- `epics/` — one file per epic

## Current target

The first milestone is not "full parity everywhere." The first milestone is:

- canonical filesystem contract
- host-neutral boot contract
- host adapters for Claude/Codex/Gemini
- config-driven heartbeat dispatch
- explicit provider adapter layer
