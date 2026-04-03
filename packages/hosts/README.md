# Hosts

This package defines Seed's host runtime adapter layer.

A **host** is the shell that runs the agent experience:

- Claude Code
- Codex CLI
- Gemini CLI

Hosts are not the same as model providers. A host controls:

- interactive execution
- headless execution
- tool permission syntax
- structured output format
- boot wrapper rendering

Providers control where model inference comes from:

- OpenAI
- Anthropic
- Gemini API
- OpenRouter
- Ollama
- MLX or other OpenAI-compatible local endpoints

Seed should be able to vary the host independently from the provider/model mix.
