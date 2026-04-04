#!/bin/bash
# Seed — Turnkey agent install for fresh macOS or Linux machines.
#
# Downloads a pre-built seed-agent binary from GitHub Releases, installs it
# to ~/.local/bin, registers the machine with a control plane, and starts
# the agent as a user-scoped service (launchd on macOS, systemd --user on
# Linux). No Xcode CLI Tools, no git, no bun, no source code on the target.
#
# On Linux, the installer may call `sudo loginctl enable-linger` exactly
# once — only if lingering is not already enabled for the current user.
# No other sudo calls are made.
#
# Usage (one-liner):
#   curl -sSL https://raw.githubusercontent.com/phyter1/seed/main/setup/install.sh | sh -s -- \
#     --control-url wss://control.phytertek.com \
#     --machine-id ren3
#
# Or download and run locally:
#   bash install.sh --control-url wss://... --machine-id ren3
#
# Options:
#   --control-url <url>    Control plane URL (wss://... or https://...)
#   --machine-id <id>      Machine ID (defaults to `hostname -s`)
#   --display-name <name>  Human-readable display name (optional)
#   --version <tag>        Pin a specific release tag (default: latest)
#   --dry-run              Print actions, download nothing, touch nothing
#   -h, --help             Show this help

set -euo pipefail

# ------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------
REPO="phyter1/seed"
BIN_DIR="$HOME/.local/bin"
CONFIG_DIR="$HOME/.config/seed-fleet"
AGENT_CONFIG="$CONFIG_DIR/agent.json"
SERVICE_LABEL="com.seed.agent"

# Platform-specific paths (resolved after OS detection).
PLIST_PATH=""
LOG_PATH=""
SYSTEMD_UNIT_PATH=""
LINUX_LOG_DIR=""

VERSION="latest"
CONTROL_URL=""
MACHINE_ID=""
DISPLAY_NAME=""
DRY_RUN=false

# ------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------
info()  { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[install]\033[0m %s\n' "$*" >&2; }
error() { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; }
die()   { error "$*"; exit 1; }

run() {
  if [ "$DRY_RUN" = true ]; then
    printf '  + %s\n' "$*"
  else
    eval "$@"
  fi
}

usage() {
  sed -n '2,/^set -/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
  exit 0
}

# ------------------------------------------------------------------------
# Parse arguments
# ------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --control-url) CONTROL_URL="$2"; shift 2 ;;
    --machine-id) MACHINE_ID="$2"; shift 2 ;;
    --display-name) DISPLAY_NAME="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) die "unknown argument: $1 (use --help)" ;;
  esac
done

# ------------------------------------------------------------------------
# OS + architecture detection
# ------------------------------------------------------------------------
OS_NAME="$(uname -s)"
case "$OS_NAME" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *)      die "unsupported OS: $OS_NAME (supported: Darwin, Linux)" ;;
esac

RAW_ARCH="$(uname -m)"
case "$OS:$RAW_ARCH" in
  darwin:arm64)  ARCH="arm64" ;;
  darwin:x86_64) ARCH="x64" ;;
  linux:x86_64)  ARCH="x64" ;;
  linux:aarch64) die "linux arm64 is not yet a published release target" ;;
  *) die "unsupported architecture for $OS: $RAW_ARCH" ;;
esac

# Required tools per OS
case "$OS" in
  darwin)
    for tool in curl shasum launchctl; do
      command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
    done
    PLIST_PATH="$HOME/Library/LaunchAgents/com.seed.agent.plist"
    LOG_PATH="$HOME/Library/Logs/seed-agent.log"
    ;;
  linux)
    for tool in curl sha256sum systemctl; do
      command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
    done
    # Verify systemctl --user works (user bus must be reachable).
    if [ "$DRY_RUN" = false ]; then
      if ! systemctl --user status >/dev/null 2>&1; then
        # systemctl --user returns nonzero when no units running; real failure
        # is "Failed to connect to bus". Probe with daemon-reload instead.
        if ! systemctl --user daemon-reload >/dev/null 2>&1; then
          die "systemctl --user is not available (need a user systemd instance)"
        fi
      fi
    fi
    SYSTEMD_UNIT_PATH="$HOME/.config/systemd/user/seed-agent.service"
    LINUX_LOG_DIR="$HOME/.local/state/seed-agent"
    LOG_PATH="$LINUX_LOG_DIR/agent.log"
    ;;
esac

[ -z "$MACHINE_ID" ] && MACHINE_ID="$(hostname -s)"

info "Seed turnkey agent install"
info "  repo:        $REPO"
info "  version:     $VERSION"
info "  arch:        $OS-$ARCH"
info "  machine id:  $MACHINE_ID"
info "  control url: ${CONTROL_URL:-<not set — will install binaries only>}"
info "  dry-run:     $DRY_RUN"

# ------------------------------------------------------------------------
# Resolve release tag and download binaries
# ------------------------------------------------------------------------
if [ "$VERSION" = "latest" ]; then
  API_URL="https://api.github.com/repos/$REPO/releases/latest"
else
  API_URL="https://api.github.com/repos/$REPO/releases/tags/$VERSION"
fi

if [ "$DRY_RUN" = true ]; then
  info "[dry-run] would fetch release metadata from $API_URL"
  TAG="${VERSION/#latest/v0.0.0-dry-run}"
else
  info "Fetching release metadata from $API_URL"
  META="$(curl -sSL -H 'Accept: application/vnd.github+json' "$API_URL")" \
    || die "failed to fetch release metadata"

  # Extract the tag name without needing jq (may not be installed).
  TAG="$(printf '%s' "$META" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
  [ -n "$TAG" ] || die "could not parse tag_name from release metadata (has a release been published?)"
fi
info "Release tag: $TAG"

BASE="https://github.com/$REPO/releases/download/$TAG"
AGENT_ASSET="seed-agent-$OS-$ARCH"
CLI_ASSET="seed-cli-$OS-$ARCH"
CHECKSUMS_ASSET="checksums.txt"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

download() {
  local asset="$1" dest="$2"
  info "Downloading $asset"
  if [ "$DRY_RUN" = true ]; then
    printf '  + curl -sSLf -o %s %s/%s\n' "$dest" "$BASE" "$asset"
    return 0
  fi
  curl -sSLf -o "$dest" "$BASE/$asset" \
    || die "failed to download $asset"
}

download "$AGENT_ASSET" "$TMP_DIR/$AGENT_ASSET"
download "$CLI_ASSET" "$TMP_DIR/$CLI_ASSET"
download "$CHECKSUMS_ASSET" "$TMP_DIR/$CHECKSUMS_ASSET"

# ------------------------------------------------------------------------
# Verify checksums (shasum on macOS, sha256sum on Linux)
# ------------------------------------------------------------------------
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

if [ "$DRY_RUN" = false ]; then
  info "Verifying SHA-256 checksums"
  for asset in "$AGENT_ASSET" "$CLI_ASSET"; do
    expected="$(grep " $asset\$" "$TMP_DIR/$CHECKSUMS_ASSET" | awk '{print $1}')"
    [ -n "$expected" ] || die "no checksum entry for $asset"
    actual="$(sha256_of "$TMP_DIR/$asset")"
    if [ "$expected" != "$actual" ]; then
      die "checksum mismatch for $asset: expected $expected, got $actual"
    fi
    info "  ok  $asset"
  done
else
  info "Skipping checksum verification (dry run)"
fi

# ------------------------------------------------------------------------
# Install binaries to ~/.local/bin
# ------------------------------------------------------------------------
info "Installing binaries to $BIN_DIR"
run "mkdir -p '$BIN_DIR'"
run "install -m 0755 '$TMP_DIR/$AGENT_ASSET' '$BIN_DIR/seed-agent'"
run "install -m 0755 '$TMP_DIR/$CLI_ASSET' '$BIN_DIR/seed'"

case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *) warn "$BIN_DIR is not in PATH. Add this to your shell rc:"
     warn "  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

# ------------------------------------------------------------------------
# Register with control plane (optional)
# ------------------------------------------------------------------------
if [ -n "$CONTROL_URL" ]; then
  if [ -f "$AGENT_CONFIG" ] && [ "$DRY_RUN" = false ]; then
    info "Existing agent config at $AGENT_CONFIG — skipping re-registration"
    info "  (delete it if you want to re-join a different control plane)"
  else
    info "Registering machine with control plane"
    JOIN_ARGS="fleet join '$CONTROL_URL' --machine-id '$MACHINE_ID'"
    [ -n "$DISPLAY_NAME" ] && JOIN_ARGS="$JOIN_ARGS --display-name '$DISPLAY_NAME'"
    run "'$BIN_DIR/seed' $JOIN_ARGS"
  fi
else
  info "No --control-url provided; skipping registration step"
  info "Run this later to register:"
  info "  $BIN_DIR/seed fleet join <control-url> --machine-id $MACHINE_ID"
fi

# ------------------------------------------------------------------------
# Install + load service (platform-specific)
# ------------------------------------------------------------------------
case "$OS" in
  darwin)
    info "Installing launchd plist at $PLIST_PATH"
    run "mkdir -p '$HOME/Library/LaunchAgents' '$HOME/Library/Logs' '$CONFIG_DIR'"

    PLIST_CONTENTS=$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SERVICE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN_DIR/seed-agent</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$HOME</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SEED_AGENT_CONFIG</key>
    <string>$AGENT_CONFIG</string>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_PATH</string>
  <key>StandardErrorPath</key>
  <string>$LOG_PATH</string>
</dict>
</plist>
EOF
)

    if [ "$DRY_RUN" = true ]; then
      printf '  + write plist to %s\n' "$PLIST_PATH"
    else
      printf '%s\n' "$PLIST_CONTENTS" > "$PLIST_PATH.tmp"
      mv "$PLIST_PATH.tmp" "$PLIST_PATH"
    fi

    info "Loading launchd service $SERVICE_LABEL"
    # Unload first so a re-run picks up any plist changes; ignore failure.
    run "launchctl unload '$PLIST_PATH' 2>/dev/null || true"
    run "launchctl load '$PLIST_PATH'"
    ;;

  linux)
    info "Installing systemd user unit at $SYSTEMD_UNIT_PATH"
    run "mkdir -p '$(dirname "$SYSTEMD_UNIT_PATH")' '$LINUX_LOG_DIR' '$CONFIG_DIR'"

    SYSTEMD_CONTENTS=$(cat <<EOF
[Unit]
Description=Seed fleet agent daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BIN_DIR/seed-agent
Restart=always
RestartSec=10
Environment="SEED_AGENT_CONFIG=$AGENT_CONFIG"
Environment="HOME=$HOME"
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
StandardOutput=append:$LOG_PATH
StandardError=append:$LOG_PATH

[Install]
WantedBy=default.target
EOF
)

    if [ "$DRY_RUN" = true ]; then
      printf '  + write systemd unit to %s\n' "$SYSTEMD_UNIT_PATH"
    else
      printf '%s\n' "$SYSTEMD_CONTENTS" > "$SYSTEMD_UNIT_PATH.tmp"
      mv "$SYSTEMD_UNIT_PATH.tmp" "$SYSTEMD_UNIT_PATH"
    fi

    # Enable lingering so the user service survives logout (only one sudo call).
    LINGER_STATE="$(loginctl show-user "$USER" 2>/dev/null | sed -n 's/^Linger=//p' | head -n1)"
    if [ "$LINGER_STATE" = "yes" ]; then
      info "Lingering already enabled for $USER"
    else
      info "Enabling systemd lingering for $USER (one-time sudo call)"
      run "sudo loginctl enable-linger '$USER'"
    fi

    info "Reloading systemd user daemon and starting service"
    run "systemctl --user daemon-reload"
    run "systemctl --user enable --now seed-agent.service"
    ;;
esac

# ------------------------------------------------------------------------
# Next steps
# ------------------------------------------------------------------------
SERVICE_HINT=""
case "$OS" in
  darwin)
    SERVICE_HINT="launchctl list | grep com.seed.agent"
    ;;
  linux)
    SERVICE_HINT="systemctl --user status seed-agent"
    ;;
esac

cat <<EOF

Agent installed.

  Binary:  $BIN_DIR/seed-agent
  CLI:     $BIN_DIR/seed
EOF

if [ "$OS" = "darwin" ]; then
  printf '  Plist:   %s\n' "$PLIST_PATH"
else
  printf '  Unit:    %s\n' "$SYSTEMD_UNIT_PATH"
fi

cat <<EOF
  Config:  $AGENT_CONFIG
  Logs:    $LOG_PATH

Next steps:
  1. On the control plane host, approve this machine:
       seed fleet approve $MACHINE_ID
  2. Tail the log to verify the agent connects:
       tail -f $LOG_PATH
  3. Check service status:
       $SERVICE_HINT
  4. Check status from the control plane:
       seed fleet status

EOF
