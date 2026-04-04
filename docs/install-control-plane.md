# Control Plane Setup

Turnkey install for the Seed fleet control plane. Runs as a launchd service
on any macOS host (typically a dedicated box like ren2).

## Prerequisites

- macOS 12+ (Darwin arm64 or x64)
- A port you can expose to your fleet (default: `4310`)
- Network reachability from every agent machine to this host

## One-command install

```bash
curl -sSL https://raw.githubusercontent.com/phyter1/seed/main/setup/install-control-plane.sh | sh -s -- \
  --port 4310
```

This script:

1. Detects the architecture (`arm64` or `x64`)
2. Downloads `seed-control-plane-darwin-<arch>` from the latest GitHub Release
3. Verifies the SHA-256 checksum
4. Installs the binary to `~/.local/bin/seed-control-plane`
5. Generates a 32-byte operator bearer token (or uses `--operator-token`)
6. Writes config to `~/.config/seed-fleet/control-plane.json` (mode 0600)
7. Writes a launchd plist and loads the service

The operator token is printed once at the end — save it.

## Options

| Flag | Default | Description |
|---|---|---|
| `--port <port>` | `4310` | TCP port for HTTP + WebSocket. |
| `--operator-token <tok>` | generated | REST API bearer token. |
| `--db <path>` | `~/.local/share/seed-fleet/control.db` | SQLite database path. |
| `--version <tag>` | `latest` | Pin a specific release. |
| `--dry-run` | off | Print actions without doing anything. |

## Verify

```bash
curl http://localhost:4310/health
tail -f ~/Library/Logs/seed-control-plane.log
launchctl list | grep com.seed.control-plane
```

## Using the CLI against this control plane

```bash
export SEED_CONTROL_URL=http://localhost:4310
export SEED_OPERATOR_TOKEN=<token from install>
seed fleet status
```

For other hosts, point them at the externally-reachable URL:

```bash
export SEED_CONTROL_URL=http://<host>:4310
export SEED_OPERATOR_TOKEN=<token>
```

## Exposing externally

Put the control plane behind a TLS-terminating reverse proxy (Caddy,
nginx, Cloudflare Tunnel) so agents can connect over `wss://`. The bare
server listens on HTTP only — it is not meant to face the public internet
directly.

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.seed.control-plane.plist
rm ~/Library/LaunchAgents/com.seed.control-plane.plist
rm ~/.local/bin/seed-control-plane
rm -rf ~/.config/seed-fleet ~/.local/share/seed-fleet
```
