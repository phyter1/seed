#!/bin/bash
# Seed — Agent-focused detection.
#
# A trimmed-down version of detect.sh that writes a JSON file the agent can
# read to understand what runtimes are available. Written to
# ~/.config/seed-fleet/detection.json by default.
#
# Usage:
#   bash detect-agent.sh                        # write to default path
#   bash detect-agent.sh --out /tmp/det.json    # write to custom path
#   bash detect-agent.sh --stdout               # print JSON to stdout only
#
# Output schema:
#   {
#     "hostname": "ren3",
#     "os": "darwin",
#     "arch": "arm64",
#     "cores": 8,
#     "ram_gb": 16,
#     "can_mlx": true,
#     "has_nvidia_gpu": false,
#     "gpu_name": null,
#     "vram_gb": 0,
#     "cuda_version": null,
#     "tools": { "bun": true, "git": true, "python3": true, "ollama": true },
#     "runtimes": {
#       "mlx_lm": true,
#       "ollama_running": true,
#       "ollama_models": 3,
#       "mlx_server_running": false
#     },
#     "detected_at": "2026-04-04T..."
#   }

set -euo pipefail

OUT_PATH="${HOME}/.config/seed-fleet/detection.json"
STDOUT_ONLY=false

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT_PATH="$2"; shift 2 ;;
    --stdout) STDOUT_ONLY=true; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
HOSTNAME_SHORT=$(hostname -s)

if [ "$OS" = "darwin" ]; then
  CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo 0)
  RAM_BYTES=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
  RAM_GB=$(( RAM_BYTES / 1073741824 ))
  if [ "$ARCH" = "arm64" ]; then CAN_MLX=true; else CAN_MLX=false; fi
elif [ "$OS" = "linux" ]; then
  CORES=$(nproc 2>/dev/null || echo 0)
  RAM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}')
  RAM_GB=$(( ${RAM_KB:-0} / 1048576 ))
  CAN_MLX=false
else
  CORES=0; RAM_GB=0; CAN_MLX=false
fi

have() { command -v "$1" >/dev/null 2>&1 && echo true || echo false; }

HAS_BUN=$(have bun)
HAS_GIT=$(have git)
HAS_PY=$(have python3)
HAS_OLLAMA=$(have ollama)

# --- NVIDIA GPU probe (Linux only; macOS leaves fields null/false) ---
HAS_NVIDIA_GPU=false
GPU_NAME_JSON="null"
VRAM_GB=0
CUDA_VERSION_JSON="null"

if [ "$OS" = "linux" ] && command -v nvidia-smi >/dev/null 2>&1; then
  # One-shot query, first GPU only.
  NVIDIA_LINE="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d '\r')"
  if [ -n "$NVIDIA_LINE" ]; then
    HAS_NVIDIA_GPU=true
    GPU_NAME="$(printf '%s' "$NVIDIA_LINE" | awk -F', *' '{print $1}')"
    VRAM_MB="$(printf '%s' "$NVIDIA_LINE" | awk -F', *' '{print $2}')"
    if [ -n "${VRAM_MB:-}" ] && [ "$VRAM_MB" -gt 0 ] 2>/dev/null; then
      VRAM_GB=$(( VRAM_MB / 1024 ))
    fi
    # JSON-escape the GPU name (simple: strip quotes + backslashes).
    GPU_NAME_ESCAPED="$(printf '%s' "$GPU_NAME" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    GPU_NAME_JSON="\"$GPU_NAME_ESCAPED\""

    # CUDA version from nvidia-smi banner: "CUDA Version: 12.4"
    CUDA_VERSION="$(nvidia-smi 2>/dev/null | sed -n 's/.*CUDA Version: *\([0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n1)"
    if [ -n "${CUDA_VERSION:-}" ]; then
      CUDA_VERSION_JSON="\"$CUDA_VERSION\""
    fi
  fi
fi

# --- Runtime probes ---
MLX_LM=false
if [ "$CAN_MLX" = true ] && command -v python3 >/dev/null 2>&1; then
  if python3 -c "import mlx_lm" 2>/dev/null; then MLX_LM=true; fi
fi

OLLAMA_RUNNING=false
OLLAMA_MODELS=0
if curl -s --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
  OLLAMA_RUNNING=true
  if command -v python3 >/dev/null 2>&1; then
    OLLAMA_MODELS=$(curl -s --max-time 2 http://localhost:11434/api/tags \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('models',[])))" 2>/dev/null || echo 0)
  fi
fi

MLX_SERVER_RUNNING=false
if curl -s --max-time 2 http://localhost:8080/v1/models >/dev/null 2>&1; then
  MLX_SERVER_RUNNING=true
fi

DETECTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

JSON=$(cat <<EOF
{
  "hostname": "${HOSTNAME_SHORT}",
  "os": "${OS}",
  "arch": "${ARCH}",
  "cores": ${CORES},
  "ram_gb": ${RAM_GB},
  "can_mlx": ${CAN_MLX},
  "has_nvidia_gpu": ${HAS_NVIDIA_GPU},
  "gpu_name": ${GPU_NAME_JSON},
  "vram_gb": ${VRAM_GB},
  "cuda_version": ${CUDA_VERSION_JSON},
  "tools": {
    "bun": ${HAS_BUN},
    "git": ${HAS_GIT},
    "python3": ${HAS_PY},
    "ollama": ${HAS_OLLAMA}
  },
  "runtimes": {
    "mlx_lm": ${MLX_LM},
    "ollama_running": ${OLLAMA_RUNNING},
    "ollama_models": ${OLLAMA_MODELS},
    "mlx_server_running": ${MLX_SERVER_RUNNING}
  },
  "detected_at": "${DETECTED_AT}"
}
EOF
)

if [ "$STDOUT_ONLY" = true ]; then
  printf '%s\n' "$JSON"
else
  mkdir -p "$(dirname "$OUT_PATH")"
  printf '%s\n' "$JSON" > "${OUT_PATH}.tmp"
  mv "${OUT_PATH}.tmp" "$OUT_PATH"
  printf '%s\n' "$JSON"
  echo
  echo "Wrote detection to $OUT_PATH"
fi
