#!/bin/bash
# Seed — Hardware Detection & Environment Setup
# Run this first. It figures out what you have and configures accordingly.
set -e

echo ""
echo "  🌱 Seed — Hardware Detection"
echo ""

SEED_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$SEED_DIR/seed.config.json"

# --- Detect platform ---
OS=$(uname -s)
ARCH=$(uname -m)
HOSTNAME=$(hostname -s)

echo "Machine:  $HOSTNAME"
echo "OS:       $OS"
echo "Arch:     $ARCH"

# --- Detect hardware ---
if [ "$OS" = "Darwin" ]; then
  CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo "unknown")

  if [ "$ARCH" = "arm64" ]; then
    RAM_BYTES=$(sysctl -n hw.memsize 2>/dev/null || echo "0")
    RAM_GB=$((RAM_BYTES / 1073741824))
    CHIP=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Apple Silicon")
    GPU="Metal/MLX"
    CAN_MLX=true
  else
    RAM_BYTES=$(sysctl -n hw.memsize 2>/dev/null || echo "0")
    RAM_GB=$((RAM_BYTES / 1073741824))
    CHIP=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Intel")
    GPU="none"
    CAN_MLX=false
  fi
elif [ "$OS" = "Linux" ]; then
  CORES=$(nproc 2>/dev/null || echo "unknown")
  RAM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}')
  RAM_GB=$((RAM_KB / 1048576))
  CHIP=$(cat /proc/cpuinfo 2>/dev/null | grep "model name" | head -1 | sed 's/.*: //')
  GPU=$(lspci 2>/dev/null | grep -i nvidia | head -1 | sed 's/.*: //' || echo "none")
  CAN_MLX=false
else
  echo "Unsupported OS: $OS"
  exit 1
fi

echo "CPU:      $CHIP ($CORES cores)"
echo "RAM:      ${RAM_GB}GB"
echo "GPU:      $GPU"
echo "MLX:      $CAN_MLX"

# --- Detect installed tools ---
echo ""
echo "Checking tools..."

check_tool() {
  if command -v "$1" &>/dev/null; then
    VERSION=$($1 --version 2>/dev/null | head -1 || echo "installed")
    echo "  ✓ $1 ($VERSION)"
    return 0
  else
    echo "  ✗ $1 (not found)"
    return 1
  fi
}

HOST_PROBE_MODE="${SEED_HOST_PROBE:-passive}"

check_host_runtime() {
  local command="$1"
  local probe_cmd="$2"
  local version=""
  local status="missing"
  local reason="command not found on PATH"

  if ! command -v "$command" >/dev/null 2>&1; then
    echo "missing|||$reason"
    return 1
  fi

  if version=$("$command" --version 2>/dev/null | head -1); then
    version="${version:-installed}"
  else
    status="unavailable"
    reason="version probe failed"
    echo "$status|$version||$reason"
    return 0
  fi

  if [ "$HOST_PROBE_MODE" = "active" ] && [ -n "$probe_cmd" ]; then
    if ! bash -lc "$probe_cmd" >/tmp/seed-host-probe.log 2>&1; then
      status="unavailable"
      reason="$(head -1 /tmp/seed-host-probe.log | tr '|' '/' | tr -d '\r')"
      reason="${reason:-active readiness probe failed}"
      echo "$status|$version||$reason"
      return 0
    fi
  fi

  echo "ready|$version||"
  return 0
}

HAS_GIT=false; check_tool git && HAS_GIT=true
HAS_NODE=false; check_tool node && HAS_NODE=true
HAS_BUN=false; check_tool bun && HAS_BUN=true
HAS_PYTHON=false; check_tool python3 && HAS_PYTHON=true
HAS_OLLAMA=false; check_tool ollama && HAS_OLLAMA=true

echo ""
echo "Checking host runtimes..."

IFS='|' read -r CLAUDE_STATUS CLAUDE_VERSION _ CLAUDE_REASON <<< "$(check_host_runtime claude "claude -p 'Reply with OK only.' --output-format json")"
IFS='|' read -r CODEX_STATUS CODEX_VERSION _ CODEX_REASON <<< "$(check_host_runtime codex "codex exec 'Reply with OK only.' --json")"
IFS='|' read -r GEMINI_STATUS GEMINI_VERSION _ GEMINI_REASON <<< "$(check_host_runtime gemini "gemini -p 'Reply with OK only.' --output-format json")"

print_host_status() {
  local name="$1"
  local status="$2"
  local version="$3"
  local reason="$4"

  if [ "$status" = "ready" ]; then
    echo "  ✓ $name (${version:-ready})"
  elif [ "$status" = "unavailable" ]; then
    echo "  ! $name (${version:-installed}; unavailable${reason:+: $reason})"
  else
    echo "  ✗ $name (${reason:-not found})"
  fi
}

print_host_status claude "$CLAUDE_STATUS" "$CLAUDE_VERSION" "$CLAUDE_REASON"
print_host_status codex "$CODEX_STATUS" "$CODEX_VERSION" "$CODEX_REASON"
print_host_status gemini "$GEMINI_STATUS" "$GEMINI_VERSION" "$GEMINI_REASON"

HAS_CLAUDE=false; [ "$CLAUDE_STATUS" != "missing" ] && HAS_CLAUDE=true
HAS_CODEX=false; [ "$CODEX_STATUS" != "missing" ] && HAS_CODEX=true
HAS_GEMINI=false; [ "$GEMINI_STATUS" != "missing" ] && HAS_GEMINI=true

DEFAULT_HOST="none"
if [ "$CLAUDE_STATUS" = "ready" ]; then
  DEFAULT_HOST="claude"
elif [ "$CODEX_STATUS" = "ready" ]; then
  DEFAULT_HOST="codex"
elif [ "$GEMINI_STATUS" = "ready" ]; then
  DEFAULT_HOST="gemini"
fi

# --- Detect model runtimes ---
echo ""
echo "Checking model runtimes..."

HAS_MLX_LM=false
if [ "$CAN_MLX" = true ] && python3 -c "import mlx_lm" 2>/dev/null; then
  echo "  ✓ mlx-lm (installed)"
  HAS_MLX_LM=true
else
  echo "  ✗ mlx-lm (not available)"
fi

OLLAMA_RUNNING=false
if curl -s --connect-timeout 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
  MODEL_COUNT=$(curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('models',[])))" 2>/dev/null || echo "0")
  echo "  ✓ Ollama server running ($MODEL_COUNT models)"
  OLLAMA_RUNNING=true
else
  echo "  ✗ Ollama server not running"
fi

# --- Detect other fleet machines ---
echo ""
echo "Scanning local network for other Seed machines..."

FLEET_MACHINES="[]"
for suffix in 1 2 3 4 5; do
  for name in ren seed machine; do
    HOST="${name}${suffix}.local"
    if ssh -o ConnectTimeout=1 -o BatchMode=yes -o StrictHostKeyChecking=no "$(whoami)@$HOST" 'echo OK' 2>/dev/null; then
      REMOTE_HOSTNAME=$(ssh -o ConnectTimeout=1 -o BatchMode=yes "$(whoami)@$HOST" 'hostname -s' 2>/dev/null)
      echo "  Found: $HOST ($REMOTE_HOSTNAME)"
    fi
  done
done

# --- Write config ---
echo ""
echo "Writing config to $CONFIG..."

python3 -c "
import json
config = {
    'machine': {
        'hostname': '$HOSTNAME',
        'os': '$OS',
        'arch': '$ARCH',
        'cores': $CORES,
        'ram_gb': $RAM_GB,
        'chip': '''$CHIP''',
        'gpu': '$GPU',
        'can_mlx': $( [ "$CAN_MLX" = true ] && echo "true" || echo "false" ),
    },
    'tools': {
        'git': $( [ "$HAS_GIT" = true ] && echo "true" || echo "false" ),
        'node': $( [ "$HAS_NODE" = true ] && echo "true" || echo "false" ),
        'bun': $( [ "$HAS_BUN" = true ] && echo "true" || echo "false" ),
        'python3': $( [ "$HAS_PYTHON" = true ] && echo "true" || echo "false" ),
        'ollama': $( [ "$HAS_OLLAMA" = true ] && echo "true" || echo "false" ),
        'mlx_lm': $( [ "$HAS_MLX_LM" = true ] && echo "true" || echo "false" ),
    },
    'hosts': {
        'default': None if '$DEFAULT_HOST' == 'none' else '$DEFAULT_HOST',
        'heartbeat': None if '$DEFAULT_HOST' == 'none' else '$DEFAULT_HOST',
        'installed': {
            'claude': $( [ "$HAS_CLAUDE" = true ] && echo "true" || echo "false" ),
            'codex': $( [ "$HAS_CODEX" = true ] && echo "true" || echo "false" ),
            'gemini': $( [ "$HAS_GEMINI" = true ] && echo "true" || echo "false" ),
        },
        'status': {
            'claude': '$CLAUDE_STATUS',
            'codex': '$CODEX_STATUS',
            'gemini': '$GEMINI_STATUS',
        },
        'versions': {
            'claude': '''$CLAUDE_VERSION''',
            'codex': '''$CODEX_VERSION''',
            'gemini': '''$GEMINI_VERSION''',
        },
        'reasons': {
            'claude': '''$CLAUDE_REASON''',
            'codex': '''$CODEX_REASON''',
            'gemini': '''$GEMINI_REASON''',
        }
    },
    'inference': {
        'ollama_running': $( [ "$OLLAMA_RUNNING" = true ] && echo "true" || echo "false" ),
        'ollama_models': $MODEL_COUNT if '$OLLAMA_RUNNING' == 'true' else 0,
    },
    'fleet': {
        'machines': [],
        'role': 'standalone'
    }
}
print(json.dumps(config, indent=2))
" > "$CONFIG"

echo ""
echo "Detection complete. Config saved to seed.config.json"
echo ""

# --- Report what needs to be installed ---
MISSING=""
[ "$HAS_GIT" = false ] && MISSING="$MISSING git"
[ "$HAS_NODE" = false ] && MISSING="$MISSING node"
[ "$HAS_BUN" = false ] && MISSING="$MISSING bun"

if [ -n "$MISSING" ]; then
  echo "Missing required tools:$MISSING"
  echo "Run: bash setup/install.sh"
elif [ "$DEFAULT_HOST" = "none" ]; then
  echo "No supported host runtime is ready."
  echo "Install or repair at least one of: Claude Code, Codex CLI, Gemini CLI"
  echo "Run: bash setup/install.sh"
else
  echo "All required tools present."
  echo ""
  echo "Default host runtime: $DEFAULT_HOST"
  echo "Next step: open Seed with your host runtime in this directory."
  echo "  cd $(pwd) && $DEFAULT_HOST"
  echo ""
  echo "Your first conversation will be the beginning."
fi
