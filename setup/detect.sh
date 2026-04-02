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

HAS_GIT=false; check_tool git && HAS_GIT=true
HAS_NODE=false; check_tool node && HAS_NODE=true
HAS_BUN=false; check_tool bun && HAS_BUN=true
HAS_PYTHON=false; check_tool python3 && HAS_PYTHON=true
HAS_CLAUDE=false; check_tool claude && HAS_CLAUDE=true
HAS_OLLAMA=false; check_tool ollama && HAS_OLLAMA=true

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
        'claude': $( [ "$HAS_CLAUDE" = true ] && echo "true" || echo "false" ),
        'ollama': $( [ "$HAS_OLLAMA" = true ] && echo "true" || echo "false" ),
        'mlx_lm': $( [ "$HAS_MLX_LM" = true ] && echo "true" || echo "false" ),
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
[ "$HAS_CLAUDE" = false ] && MISSING="$MISSING claude-code"

if [ -n "$MISSING" ]; then
  echo "Missing required tools:$MISSING"
  echo "Run: bash setup/install.sh"
else
  echo "All required tools present."
  echo ""
  echo "Next step: open Claude Code in this directory."
  echo "  cd $(pwd) && claude"
  echo ""
  echo "Your first conversation will be the beginning."
fi
