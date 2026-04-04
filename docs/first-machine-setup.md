# First Machine Setup

Turnkey install for adding a fresh macOS or Linux machine to a Seed fleet.
No Xcode CLI Tools, no `bun install`, no `git clone`, no source code on
the target.

## Prerequisites

- macOS 12+ (Darwin arm64 or x64) **or** Linux x64 with systemd (Ubuntu 24.04+, Debian 12+, etc.)
- A running Seed control plane — see [install-control-plane.md](./install-control-plane.md)
- The control plane's URL (e.g. `wss://control.example.com` or `ws://<host>:4310`)

## One-command install

```bash
curl -sSL https://raw.githubusercontent.com/phyter1/seed/main/setup/install.sh | sh -s -- \
  --control-url wss://your-control-plane.example.com \
  --machine-id $(hostname -s)
```

The same script handles both macOS and Linux — it branches internally on
`uname -s`.

This script:

1. Detects the OS (`darwin` or `linux`) and architecture (`arm64` or `x64`)
2. Installs the inference runtime stack for the detected hardware
   (see [What the installer installs](#what-the-installer-installs))
3. Downloads the matching pre-built binaries from the latest GitHub Release
4. Verifies SHA-256 checksums against the release's `checksums.txt`
5. Installs `seed-agent` and `seed` to `~/.local/bin/`
6. Registers the machine with the control plane (`seed fleet join`)
7. Writes a user-scoped service file:
   - macOS: `~/Library/LaunchAgents/com.seed.agent.plist`
   - Linux: `~/.config/systemd/user/seed-agent.service`
8. On Linux, enables lingering via `sudo loginctl enable-linger` (one-time,
   **only** if not already enabled) so the service survives logout
9. Loads the service so the agent starts immediately and on every boot

## What the installer installs

The install script detects your hardware and installs the full inference
stack. Everything is idempotent — already-present runtimes are detected and
skipped. Runtime install failures are warnings, not errors: the Seed agent
install completes either way.

**macOS (Apple Silicon):**

- Homebrew (if missing; may prompt for Xcode CLI Tools)
- Python 3 (via Homebrew, if missing)
- Ollama (Mac app bundle from `ollama.com`)
- MLX + `mlx-lm` (via `pip3 --user --break-system-packages`)
- Seed agent + CLI

**macOS (Intel):**

- Homebrew
- Ollama
- Seed agent + CLI
- (No MLX — Apple Silicon only)

**Linux (x64):**

- Ollama (via the official `install.sh`, sets up a systemd service)
- Seed agent + CLI
- (NVIDIA drivers and CUDA must be pre-installed; the installer just
  reports what `nvidia-smi` sees)

Pass `--no-runtimes` to skip runtime installation entirely (e.g. for
offline builds or custom runtime setups).

## Options

| Flag | Default | Description |
|---|---|---|
| `--control-url <url>` | (none) | Control plane URL. Omit to install binaries only. |
| `--machine-id <id>` | `hostname -s` | Unique machine identifier. |
| `--display-name <name>` | unset | Human-readable name shown in the dashboard. |
| `--version <tag>` | `latest` | Pin a specific release (e.g. `v0.1.0`). |
| `--no-runtimes` | off | Skip inference runtime install (Homebrew, Ollama, Python 3, MLX). |
| `--dry-run` | off | Print actions without downloading or touching the system. |

## Next step: approve the machine

On the control plane host:

```bash
seed fleet approve <machine-id>
```

The agent will pick up the token over its WebSocket connection and save it.

## Verify

From any host with the CLI + operator token:

```bash
seed fleet status
```

**On the machine itself (macOS):**

```bash
tail -f ~/Library/Logs/seed-agent.log
launchctl list | grep com.seed.agent
```

**On the machine itself (Linux):**

```bash
tail -f ~/.local/state/seed-agent/agent.log
systemctl --user status seed-agent
```

## Re-running the installer

The installer is idempotent:

- Existing `~/.config/seed-fleet/agent.json` is kept (won't re-register)
- The launchd service is unloaded + reloaded so plist changes take effect
- Binaries are overwritten with the newly-downloaded versions

To force a clean re-join, delete `~/.config/seed-fleet/agent.json` first.

## Uninstall

**macOS:**

```bash
launchctl unload ~/Library/LaunchAgents/com.seed.agent.plist
rm ~/Library/LaunchAgents/com.seed.agent.plist
rm ~/.local/bin/seed-agent ~/.local/bin/seed
rm -rf ~/.config/seed-fleet
```

**Linux:**

```bash
systemctl --user disable --now seed-agent.service
rm ~/.config/systemd/user/seed-agent.service
systemctl --user daemon-reload
rm ~/.local/bin/seed-agent ~/.local/bin/seed
rm -rf ~/.config/seed-fleet ~/.local/state/seed-agent
# Optional — disable lingering if no other user services need it:
# sudo loginctl disable-linger "$USER"
```
