#!/bin/bash
# Seed — Turnkey control plane install for macOS or Linux hosts.
#
# Downloads a pre-built seed-control-plane binary from GitHub Releases,
# installs it to ~/.local/bin, writes a launchd plist (macOS) or a systemd
# user unit (Linux), and starts the service. Generates an operator bearer
# token if one is not supplied.
#
# On Linux, the installer may call `sudo loginctl enable-linger` exactly
# once — only if lingering is not already enabled for the current user.
# No other sudo calls are made.
#
# Usage (one-liner):
#   curl -sSL https://raw.githubusercontent.com/phyter1/seed/main/setup/install-control-plane.sh | sh -s -- \
#     --port 4310
#
# Options:
#   --port <port>           TCP port for HTTP/WS (default: 4310)
#   --operator-token <tok>  Operator bearer token (default: generated)
#   --db <path>             SQLite DB path (default: ~/.local/share/seed-fleet/control.db)
#   --version <tag>         Pin a specific release tag (default: latest)
#   --dry-run               Print actions, download nothing, touch nothing
#   -h, --help              Show this help

set -euo pipefail

# ------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------
REPO="phyter1/seed"
BIN_DIR="$HOME/.local/bin"
CONFIG_DIR="$HOME/.config/seed-fleet"
CONTROL_PLANE_CONFIG="$CONFIG_DIR/control-plane.json"
DEFAULT_DB_PATH="$HOME/.local/share/seed-fleet/control.db"
SERVICE_LABEL="com.seed.control-plane"

# Platform-specific paths (resolved after OS detection).
PLIST_PATH=""
LOG_PATH=""
SYSTEMD_UNIT_PATH=""
LINUX_LOG_DIR=""

VERSION="latest"
PORT="4310"
OPERATOR_TOKEN=""
DB_PATH="$DEFAULT_DB_PATH"
DRY_RUN=false

# ------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------
info()  { printf '\033[1;34m[install-cp]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[install-cp]\033[0m %s\n' "$*" >&2; }
error() { printf '\033[1;31m[install-cp]\033[0m %s\n' "$*" >&2; }
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
    --port) PORT="$2"; shift 2 ;;
    --operator-token) OPERATOR_TOKEN="$2"; shift 2 ;;
    --db) DB_PATH="$2"; shift 2 ;;
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

case "$OS" in
  darwin)
    for tool in curl shasum launchctl; do
      command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
    done
    PLIST_PATH="$HOME/Library/LaunchAgents/com.seed.control-plane.plist"
    LOG_PATH="$HOME/Library/Logs/seed-control-plane.log"
    ;;
  linux)
    for tool in curl sha256sum systemctl; do
      command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
    done
    if [ "$DRY_RUN" = false ]; then
      if ! systemctl --user daemon-reload >/dev/null 2>&1; then
        die "systemctl --user is not available (need a user systemd instance)"
      fi
    fi
    SYSTEMD_UNIT_PATH="$HOME/.config/systemd/user/seed-control-plane.service"
    LINUX_LOG_DIR="$HOME/.local/state/seed-control-plane"
    LOG_PATH="$LINUX_LOG_DIR/control-plane.log"
    ;;
esac

# Generate a 32-byte hex operator token if none was provided.
if [ -z "$OPERATOR_TOKEN" ]; then
  if [ "$DRY_RUN" = true ]; then
    OPERATOR_TOKEN="dry-run-token-placeholder"
  else
    OPERATOR_TOKEN="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)"
  fi
  GENERATED_TOKEN=true
else
  GENERATED_TOKEN=false
fi

info "Seed turnkey control plane install"
info "  repo:     $REPO"
info "  version:  $VERSION"
info "  arch:     $OS-$ARCH"
info "  port:     $PORT"
info "  db:       $DB_PATH"
info "  token:    $( [ "$GENERATED_TOKEN" = true ] && echo 'generated' || echo 'provided' )"
info "  dry-run:  $DRY_RUN"

# ------------------------------------------------------------------------
# Resolve release tag and download binary
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
  TAG="$(printf '%s' "$META" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
  [ -n "$TAG" ] || die "could not parse tag_name from release metadata (has a release been published?)"
fi
info "Release tag: $TAG"

BASE="https://github.com/$REPO/releases/download/$TAG"
BIN_ASSET="seed-control-plane-$OS-$ARCH"
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

download "$BIN_ASSET" "$TMP_DIR/$BIN_ASSET"
download "$CHECKSUMS_ASSET" "$TMP_DIR/$CHECKSUMS_ASSET"

# ------------------------------------------------------------------------
# Verify checksum (shasum on macOS, sha256sum on Linux)
# ------------------------------------------------------------------------
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

if [ "$DRY_RUN" = false ]; then
  info "Verifying SHA-256 checksum"
  expected="$(grep " $BIN_ASSET\$" "$TMP_DIR/$CHECKSUMS_ASSET" | awk '{print $1}')"
  [ -n "$expected" ] || die "no checksum entry for $BIN_ASSET"
  actual="$(sha256_of "$TMP_DIR/$BIN_ASSET")"
  [ "$expected" = "$actual" ] || die "checksum mismatch for $BIN_ASSET"
  info "  ok  $BIN_ASSET"
else
  info "Skipping checksum verification (dry run)"
fi

# ------------------------------------------------------------------------
# Install binary
# ------------------------------------------------------------------------
info "Installing binary to $BIN_DIR"
case "$OS" in
  darwin)
    run "mkdir -p '$BIN_DIR' '$(dirname "$DB_PATH")' '$CONFIG_DIR' '$HOME/Library/LaunchAgents' '$HOME/Library/Logs'"
    ;;
  linux)
    run "mkdir -p '$BIN_DIR' '$(dirname "$DB_PATH")' '$CONFIG_DIR' '$(dirname "$SYSTEMD_UNIT_PATH")' '$LINUX_LOG_DIR'"
    ;;
esac
run "install -m 0755 '$TMP_DIR/$BIN_ASSET' '$BIN_DIR/seed-control-plane'"

# ------------------------------------------------------------------------
# Persist config (operator token + port)
# ------------------------------------------------------------------------
CONFIG_JSON=$(cat <<EOF
{
  "control_url": "http://localhost:$PORT",
  "port": $PORT,
  "db_path": "$DB_PATH",
  "operator_token": "$OPERATOR_TOKEN"
}
EOF
)

info "Writing control plane config to $CONTROL_PLANE_CONFIG"
if [ "$DRY_RUN" = true ]; then
  printf '  + write 0600-perm config with token to %s\n' "$CONTROL_PLANE_CONFIG"
else
  umask 077
  printf '%s\n' "$CONFIG_JSON" > "$CONTROL_PLANE_CONFIG.tmp"
  chmod 0600 "$CONTROL_PLANE_CONFIG.tmp"
  mv "$CONTROL_PLANE_CONFIG.tmp" "$CONTROL_PLANE_CONFIG"
fi

# ------------------------------------------------------------------------
# Install + load service (platform-specific)
# ------------------------------------------------------------------------
case "$OS" in
  darwin)
    info "Installing launchd plist at $PLIST_PATH"

    PLIST_CONTENTS=$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SERVICE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN_DIR/seed-control-plane</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$HOME</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CONTROL_PORT</key>
    <string>$PORT</string>
    <key>CONTROL_DB</key>
    <string>$DB_PATH</string>
    <key>OPERATOR_TOKEN</key>
    <string>$OPERATOR_TOKEN</string>
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
      umask 077
      printf '%s\n' "$PLIST_CONTENTS" > "$PLIST_PATH.tmp"
      chmod 0600 "$PLIST_PATH.tmp"
      mv "$PLIST_PATH.tmp" "$PLIST_PATH"
    fi

    info "Loading launchd service $SERVICE_LABEL"
    run "launchctl unload '$PLIST_PATH' 2>/dev/null || true"
    run "launchctl load '$PLIST_PATH'"
    ;;

  linux)
    info "Installing systemd user unit at $SYSTEMD_UNIT_PATH"

    SYSTEMD_CONTENTS=$(cat <<EOF
[Unit]
Description=Seed fleet control plane server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BIN_DIR/seed-control-plane
Restart=always
RestartSec=10
Environment="CONTROL_PORT=$PORT"
Environment="CONTROL_DB=$DB_PATH"
Environment="OPERATOR_TOKEN=$OPERATOR_TOKEN"
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
      umask 077
      printf '%s\n' "$SYSTEMD_CONTENTS" > "$SYSTEMD_UNIT_PATH.tmp"
      chmod 0600 "$SYSTEMD_UNIT_PATH.tmp"
      mv "$SYSTEMD_UNIT_PATH.tmp" "$SYSTEMD_UNIT_PATH"
    fi

    # Enable lingering so the user service survives logout (one sudo call max).
    LINGER_STATE="$(loginctl show-user "$USER" 2>/dev/null | sed -n 's/^Linger=//p' | head -n1)"
    if [ "$LINGER_STATE" = "yes" ]; then
      info "Lingering already enabled for $USER"
    else
      info "Enabling systemd lingering for $USER (one-time sudo call)"
      run "sudo loginctl enable-linger '$USER'"
    fi

    info "Reloading systemd user daemon and starting service"
    run "systemctl --user daemon-reload"
    run "systemctl --user enable --now seed-control-plane.service"
    ;;
esac

# ------------------------------------------------------------------------
# Next steps
# ------------------------------------------------------------------------
cat <<EOF

Control plane installed.

  Binary:   $BIN_DIR/seed-control-plane
EOF

if [ "$OS" = "darwin" ]; then
  printf '  Plist:    %s\n' "$PLIST_PATH"
else
  printf '  Unit:     %s\n' "$SYSTEMD_UNIT_PATH"
fi

cat <<EOF
  Config:   $CONTROL_PLANE_CONFIG
  DB:       $DB_PATH
  Logs:     $LOG_PATH
  Port:     $PORT

EOF

if [ "$GENERATED_TOKEN" = true ] && [ "$DRY_RUN" = false ]; then
  cat <<EOF
Operator token (save this — shown once):

  $OPERATOR_TOKEN

Use it to call the REST API:
  export SEED_OPERATOR_TOKEN=$OPERATOR_TOKEN
  seed fleet status

EOF
fi

cat <<EOF
Verify the server is up:
  curl http://localhost:$PORT/health  # (once service is ready)
  tail -f $LOG_PATH

EOF
