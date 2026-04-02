# SDLC Agent Prompt Schema

Each YAML file in this directory defines a spawnable agent role.

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable role name |
| `description` | string | yes | One-line description of what this agent does |
| `model` | string | no | Model override (e.g., `opus`, `sonnet`) |
| `allowed_tools` | string | no | Comma-separated tool whitelist for `--allowedTools` |
| `skip_permissions` | bool | no | Whether to use `--dangerously-skip-permissions` (default: false) |
| `system_prompt` | string | yes | Appended to the agent's system prompt via `--append-system-prompt` |
| `initial_prompt` | string | no | Template for the first prompt injected after spawn. Supports `{target}` placeholder for the project/file/PR being worked on |
| `suggested_cwd` | string | no | Hint for working directory (e.g., `{project_root}`) |

## Usage

```bash
# Spawn an architect agent in a project
cortex spawn-role architect ~/code/myproject

# Spawn a reviewer for a specific PR
cortex spawn-role reviewer ~/code/myproject --target "PR #42"

# Spawn a tester focused on a module
cortex spawn-role tester ~/code/myproject --target "src/auth/"
```
