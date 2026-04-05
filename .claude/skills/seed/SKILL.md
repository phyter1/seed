---
name: seed
description: Operate the Seed fleet via the `seed` CLI — check status, approve/revoke machines, view config, audit log, dispatch agent/CLI upgrades, track install sessions. All operations flow through the control plane HTTP API, never SSH.
argument-hint: status | approve <id> | revoke <id> | config | audit [--limit N] | upgrade [--version <tag>] [--machine <id>] [--dry-run] [--parallel N] | installs [<id>] [--follow] [--events] | self-update [--version <tag>] | configure [--control-url <url>] [--operator-token <token>] | version
allowed-tools: Bash(seed *)
user-invocable: true
---

# /seed

Operate the Seed fleet through the `seed` CLI. The CLI talks to the control plane over HTTP; no SSH is involved in any fleet operation.

## Prerequisites

The CLI reads config from `~/.config/seed-fleet/cli.json` (0600 perms) with this shape:

```json
{
  "control_url": "http://ren2.local:4310",
  "operator_token": "<64-char hex>"
}
```

Env vars `SEED_CONTROL_URL` and `SEED_OPERATOR_TOKEN` override the config file. If you see a connection-refused or 401/403 error, the CLI will print actionable hints pointing to `seed fleet configure`.

## Argument dispatch

Map `$ARGUMENTS` to a `seed fleet <subcommand>` invocation:

| `$ARGUMENTS` starts with | Runs |
|---|---|
| `status` (or empty) | `seed fleet status` |
| `approve <id>` | `seed fleet approve <id>` |
| `revoke <id>` | `seed fleet revoke <id>` |
| `config` | `seed fleet config` |
| `audit` | `seed fleet audit [--limit N]` |
| `upgrade` | `seed fleet upgrade [--version <tag>] [--machine <id>] [--dry-run] [--parallel N]` |
| `installs` | `seed fleet installs [<install_id>] [--status S] [--follow] [--events]` |
| `self-update` | `seed fleet self-update [--version <tag>] [--force]` |
| `configure` | `seed fleet configure [--control-url <url>] [--operator-token <token>]` |
| `version` | `seed version` |
| `join <url>` | `seed fleet join <url> [--machine-id <id>] [--display-name <name>]` |

If `$ARGUMENTS` is empty, default to `status`.

## Common workflows

**Check fleet health:**
```bash
seed fleet status
```

**Roll out a new release:**
```bash
seed fleet upgrade --version v0.4.4 --dry-run   # preview
seed fleet upgrade --version v0.4.4              # execute
```
Updates the agent on each fleet machine via pull-from-GitHub, waits for reconnect, then updates the CLI binary on the same machine. Both binaries flow through the control plane WebSocket; no SSH, no scp.

**Approve a new machine joining the fleet:**
```bash
seed fleet status                # find the pending machine_id
seed fleet approve <machine_id>  # returns a one-time agent token
```
The operator then puts that token in the joining machine's `~/.config/seed-fleet/agent.json`.

**Watch an in-flight install:**
```bash
seed fleet installs --status running --follow
seed fleet installs <install_id> --events
```

**Audit recent commands:**
```bash
seed fleet audit --limit 50
```

**Update this CLI binary:**
```bash
seed fleet self-update                    # latest
seed fleet self-update --version v0.4.4   # specific tag
```

## Notes

- The CLI and agents upgrade together via `seed fleet upgrade`. The control plane daemon (on the control-plane host) currently needs a separate self-update — there is no `seed fleet release` yet that orchestrates all three tiers.
- `seed fleet upgrade` skips machines whose agent is already at target. Known bug: this also skips the CLI update for those machines. Use a direct curl to the `/v1/fleet/:id/command` endpoint with `action: "cli.update"` if you need to force-refresh a stale CLI on an up-to-date agent.
- `audit` is the source of truth for command outcomes — HTTP dispatch is fire-and-forget; command results land in the audit log via the agent's WebSocket response.
- Binary distribution is pull-from-GitHub only. Never use scp or ssh to push Seed binaries to fleet machines as part of normal operation.
