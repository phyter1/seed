# Providers

This package defines Seed's provider adapter layer.

A **provider** is where model inference comes from:

- Anthropic API
- OpenAI API
- Gemini API
- OpenRouter
- Ollama
- MLX via an OpenAI-compatible server
- any other OpenAI-compatible endpoint

Providers are not the same as hosts.

- **Host**: the shell that runs the agent loop
- **Provider**: the backend that serves model inference

Seed should support:

- Claude host + Anthropic provider
- Codex host + OpenAI provider
- Gemini host + Gemini provider
- any host + local Ollama/MLX or OpenRouter through Seed's own runtime

The provider layer is the long-term boundary for routing, capability checks, and usage normalization.
