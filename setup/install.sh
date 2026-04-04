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
#   --telemetry-url <url>  Control plane URL to report install events to.
#                          Defaults to --control-url (http/https form).
#                          Set to "" to disable telemetry explicitly.
#   --no-runtimes          Skip inference runtime install (Homebrew, Ollama,
#                          Python3, MLX). Normally these are installed
#                          unconditionally (skipped per-runtime if present).
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
TELEMETRY_URL=""
TELEMETRY_URL_SET=false
INSTALL_ID=""
INSTALL_RUNTIMES=true
RUNTIME_WARNINGS=""

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
    --telemetry-url) TELEMETRY_URL="$2"; TELEMETRY_URL_SET=true; shift 2 ;;
    --no-runtimes) INSTALL_RUNTIMES=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) die "unknown argument: $1 (use --help)" ;;
  esac
done

# ------------------------------------------------------------------------
# Install telemetry (best-effort, never blocks the install)
# ------------------------------------------------------------------------
# Default telemetry target: derive an http(s) URL from --control-url unless
# the caller explicitly passed --telemetry-url (even empty, to disable).
if [ "$TELEMETRY_URL_SET" = false ] && [ -n "$CONTROL_URL" ]; then
  case "$CONTROL_URL" in
    wss://*)   TELEMETRY_URL="https://${CONTROL_URL#wss://}" ;;
    ws://*)    TELEMETRY_URL="http://${CONTROL_URL#ws://}" ;;
    https://*|http://*) TELEMETRY_URL="$CONTROL_URL" ;;
  esac
fi
# Strip trailing slash
TELEMETRY_URL="${TELEMETRY_URL%/}"

# Generate a unique install id per invocation.
INSTALL_ID="${MACHINE_ID:-unknown}-$(date +%Y%m%dT%H%M%S)-${RANDOM}"

# report_event <step> <status> [<details-json>]
# Always logs to stderr. If telemetry is configured, POST the event to the
# control plane. Returns 2 if the control plane responded with a retry
# suggestion. Exits 2 if the control plane signals abort.
report_event() {
  local step="$1"
  local status="$2"
  local details="${3:-{\}}"

  printf '\033[1;90m[telemetry]\033[0m %s %s: %s\n' \
    "$(date +%H:%M:%S)" "$step" "$status" >&2

  [ -z "$TELEMETRY_URL" ] && return 0
  [ "$DRY_RUN" = true ] && return 0

  local payload
  payload=$(cat <<JSON
{
  "install_id": "$INSTALL_ID",
  "machine_id": "$MACHINE_ID",
  "target": "agent",
  "os": "${OS:-unknown}",
  "arch": "${ARCH:-unknown}",
  "step": "$step",
  "status": "$status",
  "details": $details,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
)

  local response
  response=$(curl -sfS --max-time 5 -X POST \
    "$TELEMETRY_URL/v1/install/event" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null) || return 0

  [ -z "$response" ] && return 0

  if printf '%s' "$response" | grep -q '"abort":true'; then
    error "Control plane signaled abort: $response"
    exit 2
  fi

  if [ "$status" = "failed" ]; then
    local retry_delay
    retry_delay=$(printf '%s' "$response" | grep -oE '"delay_ms":[0-9]+' \
      | head -n1 | cut -d: -f2)
    if [ -n "$retry_delay" ]; then
      warn "Control plane suggests retry in ${retry_delay}ms"
      return 2
    fi
  fi

  return 0
}

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
# Update the install id now that we have a real machine id.
INSTALL_ID="${MACHINE_ID}-$(date +%Y%m%dT%H%M%S)-${RANDOM}"

report_event "install.started" "ok" \
  "{\"os\":\"$OS\",\"arch\":\"$ARCH\",\"version\":\"$VERSION\"}"
report_event "detect.environment" "ok" \
  "{\"os\":\"$OS\",\"arch\":\"$ARCH\",\"machine_id\":\"$MACHINE_ID\"}"

info "Seed turnkey agent install"
info "  repo:        $REPO"
info "  version:     $VERSION"
info "  arch:        $OS-$ARCH"
info "  machine id:  $MACHINE_ID"
info "  control url: ${CONTROL_URL:-<not set — will install binaries only>}"
info "  dry-run:     $DRY_RUN"

# ------------------------------------------------------------------------
# Install inference runtimes (based on detected OS/arch)
# ------------------------------------------------------------------------
# Runtime installs are best-effort: failures are warnings, not errors.
# The Seed agent can run without Ollama/MLX; it just won't probe those
# services. Each step is idempotent — already-installed runtimes are
# detected and skipped.

has_homebrew()   { command -v brew >/dev/null 2>&1; }
has_python3()    { command -v python3 >/dev/null 2>&1; }
has_ollama()     { command -v ollama >/dev/null 2>&1; }
has_mlx()        { python3 -c "import mlx" 2>/dev/null; }
has_nvidia_smi() { command -v nvidia-smi >/dev/null 2>&1; }

runtime_warn() {
  local runtime="$1"
  local msg="$2"
  warn "runtime install warning: $runtime — $msg"
  if [ -z "$RUNTIME_WARNINGS" ]; then
    RUNTIME_WARNINGS="\"$runtime\""
  else
    RUNTIME_WARNINGS="$RUNTIME_WARNINGS,\"$runtime\""
  fi
}

python3_version() {
  python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo "unknown"
}

install_homebrew_if_missing() {
  if has_homebrew; then
    info "Homebrew already installed"
    return 0
  fi
  report_event "runtime.homebrew" "started" "{}"
  info "Installing Homebrew (may prompt for Xcode CLI Tools)"
  if [ "$DRY_RUN" = true ]; then
    printf '  + install Homebrew via official install.sh\n'
    report_event "runtime.homebrew" "ok" "{\"dry_run\":true}"
    return 0
  fi
  if /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/null; then
    # Add brew to PATH for this session
    if [ -d /opt/homebrew/bin ]; then
      export PATH="/opt/homebrew/bin:$PATH"
    elif [ -d /usr/local/bin ]; then
      export PATH="/usr/local/bin:$PATH"
    fi
    local ver
    ver=$(brew --version 2>/dev/null | head -n1 | awk '{print $2}')
    report_event "runtime.homebrew" "ok" "{\"version\":\"${ver:-unknown}\"}"
  else
    report_event "runtime.homebrew" "failed" "{\"error\":\"brew install script failed\"}"
    runtime_warn "homebrew" "install script failed"
    return 1
  fi
}

install_python3_if_missing() {
  if has_python3; then
    info "Python 3 already installed ($(python3_version))"
    return 0
  fi
  report_event "runtime.python3" "started" "{}"
  info "Installing Python 3 via Homebrew"
  if [ "$DRY_RUN" = true ]; then
    printf '  + brew install python@3.12\n'
    report_event "runtime.python3" "ok" "{\"dry_run\":true}"
    return 0
  fi
  if ! has_homebrew; then
    report_event "runtime.python3" "failed" "{\"error\":\"homebrew missing\"}"
    runtime_warn "python3" "Homebrew not available — cannot install Python 3"
    return 1
  fi
  if brew install python@3.12; then
    local ver
    ver=$(python3_version)
    report_event "runtime.python3" "ok" "{\"version\":\"$ver\"}"
  else
    report_event "runtime.python3" "failed" "{\"error\":\"brew install python@3.12 failed\"}"
    runtime_warn "python3" "brew install python@3.12 failed"
    return 1
  fi
}

install_ollama_if_missing() {
  if has_ollama; then
    local ver
    ver=$(ollama --version 2>/dev/null | awk 'NR==1{print $NF}')
    info "Ollama already installed (${ver:-unknown})"
    return 0
  fi
  report_event "runtime.ollama" "started" "{}"
  if [ "$DRY_RUN" = true ]; then
    info "Installing Ollama"
    case "$OS" in
      darwin) printf '  + download Ollama.zip, copy to /Applications, symlink CLI\n' ;;
      linux)  printf '  + curl -fsSL https://ollama.com/install.sh | sh\n' ;;
    esac
    report_event "runtime.ollama" "ok" "{\"dry_run\":true}"
    return 0
  fi
  case "$OS" in
    darwin)
      info "Installing Ollama (macOS app bundle)"
      local zip="/tmp/Ollama-$$.zip"
      local extract_dir="/tmp/ollama-extract-$$"
      mkdir -p "$extract_dir"
      if ! curl -fsSL https://ollama.com/download/Ollama.zip -o "$zip"; then
        report_event "runtime.ollama" "failed" "{\"error\":\"download failed\"}"
        runtime_warn "ollama" "failed to download Ollama.zip"
        rm -rf "$zip" "$extract_dir"
        return 1
      fi
      if ! unzip -q "$zip" -d "$extract_dir"; then
        report_event "runtime.ollama" "failed" "{\"error\":\"unzip failed\"}"
        runtime_warn "ollama" "failed to unzip Ollama.zip"
        rm -rf "$zip" "$extract_dir"
        return 1
      fi
      # Remove existing installation, then copy
      rm -rf /Applications/Ollama.app 2>/dev/null || true
      if ! cp -R "$extract_dir/Ollama.app" /Applications/; then
        report_event "runtime.ollama" "failed" "{\"error\":\"copy to /Applications failed\"}"
        runtime_warn "ollama" "failed to install Ollama.app to /Applications"
        rm -rf "$zip" "$extract_dir"
        return 1
      fi
      rm -rf "$zip" "$extract_dir"
      # Create CLI symlink
      local cli_src="/Applications/Ollama.app/Contents/Resources/ollama"
      if [ -x "$cli_src" ]; then
        if ! ln -sf "$cli_src" /usr/local/bin/ollama 2>/dev/null; then
          mkdir -p "$HOME/.local/bin"
          ln -sf "$cli_src" "$HOME/.local/bin/ollama"
        fi
      else
        warn "Ollama CLI binary not found at expected path: $cli_src"
      fi
      # Start Ollama app
      open -a Ollama 2>/dev/null || true
      # Wait for server
      local i
      for i in 1 2 3 4 5 6 7 8 9 10; do
        if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
          break
        fi
        sleep 1
      done
      local ver
      ver=$(ollama --version 2>/dev/null | awk 'NR==1{print $NF}')
      report_event "runtime.ollama" "ok" "{\"version\":\"${ver:-unknown}\"}"
      ;;
    linux)
      info "Installing Ollama (official install.sh)"
      if curl -fsSL https://ollama.com/install.sh | sh; then
        local ver
        ver=$(ollama --version 2>/dev/null | awk 'NR==1{print $NF}')
        report_event "runtime.ollama" "ok" "{\"version\":\"${ver:-unknown}\"}"
      else
        report_event "runtime.ollama" "failed" "{\"error\":\"install script failed\"}"
        runtime_warn "ollama" "ollama install script failed"
        return 1
      fi
      ;;
  esac
}

install_mlx_if_missing() {
  if has_mlx; then
    info "MLX already installed"
    return 0
  fi
  report_event "runtime.mlx" "started" "{}"
  info "Installing MLX (mlx, mlx-lm) via pip3"
  if [ "$DRY_RUN" = true ]; then
    printf '  + python3 -m pip install --user --break-system-packages mlx mlx-lm\n'
    report_event "runtime.mlx" "ok" "{\"dry_run\":true}"
    return 0
  fi
  if ! has_python3; then
    report_event "runtime.mlx" "failed" "{\"error\":\"python3 missing\"}"
    runtime_warn "mlx" "Python 3 not available — cannot install MLX"
    return 1
  fi
  if python3 -m pip install --user --break-system-packages mlx mlx-lm; then
    local ver
    ver=$(python3 -c "import mlx; print(mlx.__version__)" 2>/dev/null || echo unknown)
    report_event "runtime.mlx" "ok" "{\"version\":\"$ver\"}"
  else
    report_event "runtime.mlx" "failed" "{\"error\":\"pip install mlx failed\"}"
    runtime_warn "mlx" "pip install mlx mlx-lm failed"
    return 1
  fi
}

verify_nvidia_driver() {
  if has_nvidia_smi; then
    local gpu_info
    gpu_info=$(nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>/dev/null | head -n1)
    if [ -n "$gpu_info" ]; then
      info "NVIDIA GPU detected: $gpu_info"
      # JSON-escape the gpu_info for telemetry
      local esc
      esc=$(printf '%s' "$gpu_info" | sed 's/\\/\\\\/g; s/"/\\"/g')
      report_event "runtime.nvidia_check" "ok" "{\"detected\":true,\"gpu\":\"$esc\"}"
    else
      info "nvidia-smi present but no GPU detected"
      report_event "runtime.nvidia_check" "ok" "{\"detected\":false}"
    fi
  else
    info "No nvidia-smi found (this is fine if the machine has no GPU)"
    report_event "runtime.nvidia_check" "ok" "{\"detected\":false,\"reason\":\"no nvidia-smi\"}"
  fi
}

if [ "$INSTALL_RUNTIMES" = true ]; then
  info "Installing inference runtimes for $OS-$ARCH"
  case "$OS:$ARCH" in
    darwin:arm64)
      install_homebrew_if_missing || true
      install_python3_if_missing || true
      install_ollama_if_missing || true
      install_mlx_if_missing || true
      ;;
    darwin:x64)
      install_homebrew_if_missing || true
      install_ollama_if_missing || true
      ;;
    linux:x64)
      install_ollama_if_missing || true
      verify_nvidia_driver
      ;;
  esac
else
  info "Skipping runtime install (--no-runtimes)"
fi

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
  report_event "download.binary" "started" "{\"asset\":\"$asset\"}"
  if [ "$DRY_RUN" = true ]; then
    printf '  + curl -sSLf -o %s %s/%s\n' "$dest" "$BASE" "$asset"
    report_event "download.binary" "ok" "{\"asset\":\"$asset\",\"dry_run\":true}"
    return 0
  fi
  if ! curl -sSLf -o "$dest" "$BASE/$asset"; then
    report_event "download.binary" "failed" \
      "{\"asset\":\"$asset\",\"error_type\":\"network_error\",\"url\":\"$BASE/$asset\"}"
    die "failed to download $asset"
  fi
  local size
  size=$(stat -f%z "$dest" 2>/dev/null || stat -c%s "$dest" 2>/dev/null || echo 0)
  report_event "download.binary" "ok" \
    "{\"asset\":\"$asset\",\"size_bytes\":$size}"
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
  report_event "verify.checksum" "started" "{}"
  for asset in "$AGENT_ASSET" "$CLI_ASSET"; do
    expected="$(grep " $asset\$" "$TMP_DIR/$CHECKSUMS_ASSET" | awk '{print $1}')"
    if [ -z "$expected" ]; then
      report_event "verify.checksum" "failed" \
        "{\"asset\":\"$asset\",\"error_type\":\"checksum_mismatch\",\"error\":\"no entry\"}"
      die "no checksum entry for $asset"
    fi
    actual="$(sha256_of "$TMP_DIR/$asset")"
    if [ "$expected" != "$actual" ]; then
      report_event "verify.checksum" "failed" \
        "{\"asset\":\"$asset\",\"error_type\":\"checksum_mismatch\",\"expected\":\"$expected\",\"actual\":\"$actual\"}"
      die "checksum mismatch for $asset: expected $expected, got $actual"
    fi
    info "  ok  $asset"
  done
  report_event "verify.checksum" "ok" "{}"
else
  info "Skipping checksum verification (dry run)"
fi

# ------------------------------------------------------------------------
# Install binaries to ~/.local/bin
# ------------------------------------------------------------------------
info "Installing binaries to $BIN_DIR"
report_event "install.binary" "started" "{\"dest\":\"$BIN_DIR\"}"
run "mkdir -p '$BIN_DIR'"
run "install -m 0755 '$TMP_DIR/$AGENT_ASSET' '$BIN_DIR/seed-agent'"
run "install -m 0755 '$TMP_DIR/$CLI_ASSET' '$BIN_DIR/seed'"
report_event "install.binary" "ok" "{\"dest\":\"$BIN_DIR\"}"

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
    report_event "config.generate" "started" "{}"
    JOIN_ARGS="join '$CONTROL_URL' --machine-id '$MACHINE_ID'"
    [ -n "$DISPLAY_NAME" ] && JOIN_ARGS="$JOIN_ARGS --display-name '$DISPLAY_NAME'"
    if ! run "'$BIN_DIR/seed' $JOIN_ARGS"; then
      report_event "config.generate" "failed" \
        "{\"error_type\":\"network_error\",\"error\":\"seed fleet join failed\"}"
      die "failed to register with control plane"
    fi
    report_event "config.generate" "ok" "{\"config\":\"$AGENT_CONFIG\"}"
  fi
else
  info "No --control-url provided; skipping registration step"
  info "Run this later to register:"
  info "  $BIN_DIR/seed join <control-url> --machine-id $MACHINE_ID"
fi

# ------------------------------------------------------------------------
# Install + load service (platform-specific)
# ------------------------------------------------------------------------
case "$OS" in
  darwin)
    info "Installing launchd plist at $PLIST_PATH"
    report_event "service.install" "started" "{\"manager\":\"launchd\",\"path\":\"$PLIST_PATH\"}"
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
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
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

    report_event "service.install" "ok" "{\"manager\":\"launchd\"}"
    info "Loading launchd service $SERVICE_LABEL"
    report_event "service.start" "started" "{\"manager\":\"launchd\",\"label\":\"$SERVICE_LABEL\"}"
    # Unload first so a re-run picks up any plist changes; ignore failure.
    run "launchctl unload '$PLIST_PATH' 2>/dev/null || true"
    if ! run "launchctl load '$PLIST_PATH'"; then
      report_event "service.start" "failed" \
        "{\"manager\":\"launchd\",\"error_type\":\"permission_denied\",\"error\":\"launchctl load failed\"}"
      die "launchctl load failed"
    fi
    report_event "service.start" "ok" "{\"manager\":\"launchd\"}"
    ;;

  linux)
    info "Installing systemd user unit at $SYSTEMD_UNIT_PATH"
    report_event "service.install" "started" "{\"manager\":\"systemd\",\"path\":\"$SYSTEMD_UNIT_PATH\"}"
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
Environment="PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
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

    report_event "service.install" "ok" "{\"manager\":\"systemd\"}"
    info "Reloading systemd user daemon and starting service"
    report_event "service.start" "started" "{\"manager\":\"systemd\",\"unit\":\"seed-agent.service\"}"
    run "systemctl --user daemon-reload"
    if ! run "systemctl --user enable --now seed-agent.service"; then
      report_event "service.start" "failed" \
        "{\"manager\":\"systemd\",\"error_type\":\"permission_denied\",\"error\":\"systemctl enable --now failed\"}"
      die "systemctl enable --now seed-agent.service failed"
    fi
    report_event "service.start" "ok" "{\"manager\":\"systemd\"}"
    ;;
esac

report_event "install.complete" "ok" \
  "{\"machine_id\":\"$MACHINE_ID\",\"runtime_warnings\":[${RUNTIME_WARNINGS}]}"

if [ -n "$RUNTIME_WARNINGS" ]; then
  warn "Install completed with runtime warnings: [${RUNTIME_WARNINGS}]"
  warn "The agent will still run; inference services may be unavailable."
fi

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
       seed approve $MACHINE_ID
  2. Tail the log to verify the agent connects:
       tail -f $LOG_PATH
  3. Check service status:
       $SERVICE_HINT
  4. Check status from the control plane:
       seed status

EOF
