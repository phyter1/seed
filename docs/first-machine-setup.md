# First Machine Setup

Turnkey install for adding a fresh macOS machine to a Seed fleet. No Xcode
CLI Tools, no `bun install`, no `git clone`, no source code on the target.

## Prerequisites

- macOS 12+ (Darwin arm64 or x64)
- A running Seed control plane — see [install-control-plane.md](./install-control-plane.md)
- The control plane's URL (e.g. `wss://control.example.com` or `ws://<host>:4310`)

## One-command install

```bash
curl -sSL https://raw.githubusercontent.com/phyter1/seed/main/setup/install.sh | sh -s -- \
  --control-url wss://your-control-plane.example.com \
  --machine-id $(hostname -s)
```

This script:

1. Detects the architecture (`arm64` or `x64`)
2. Downloads the matching pre-built binaries from the latest GitHub Release
3. Verifies SHA-256 checksums against the release's `checksums.txt`
4. Installs `seed-agent` and `seed` to `~/.local/bin/`
5. Registers the machine with the control plane (`seed fleet join`)
6. Writes `~/Library/LaunchAgents/com.seed.agent.plist`
7. Loads the launchd service so the agent starts immediately and on every boot

## Options

| Flag | Default | Description |
|---|---|---|
| `--control-url <url>` | (none) | Control plane URL. Omit to install binaries only. |
| `--machine-id <id>` | `hostname -s` | Unique machine identifier. |
| `--display-name <name>` | unset | Human-readable name shown in the dashboard. |
| `--version <tag>` | `latest` | Pin a specific release (e.g. `v0.1.0`). |
| `--dry-run` | off | Print actions without downloading or touching the system. |

## Next step: approve the machine

On the control plane host:

```bash
seed fleet approve <machine-id>
```

The agent will pick up the token over its WebSocket connection and save it.

## Verify

```bash
# From any host with the CLI + operator token:
seed fleet status

# On the machine itself:
tail -f ~/Library/Logs/seed-agent.log
launchctl list | grep com.seed.agent
```

## Re-running the installer

The installer is idempotent:

- Existing `~/.config/seed-fleet/agent.json` is kept (won't re-register)
- The launchd service is unloaded + reloaded so plist changes take effect
- Binaries are overwritten with the newly-downloaded versions

To force a clean re-join, delete `~/.config/seed-fleet/agent.json` first.

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.seed.agent.plist
rm ~/Library/LaunchAgents/com.seed.agent.plist
rm ~/.local/bin/seed-agent ~/.local/bin/seed
rm -rf ~/.config/seed-fleet
```
