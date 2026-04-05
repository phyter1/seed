#!/bin/bash
# Start a queue worker for a local MLX instance.
#
# Configure via environment variables:
#   WORKER_ID       — unique name for this worker (default: $HOSTNAME-mlx)
#   PROVIDER_ID     — provider key from seed.config.json (default: mlx_local)
#   CAPABILITY      — speed|reasoning|code|any (default: speed)
#   INFERENCE_URL   — explicit override for the provider endpoint
#   DEFAULT_MODEL   — explicit override for the provider model
#   QUEUE_URL       — queue server URL (auto-discovered if not set)
#   POLL_INTERVAL   — ms between polls (default: 2000)
export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")/.."

MACHINE_NAME="${HOSTNAME:-$(hostname)}"

export PROVIDER_ID="${PROVIDER_ID:-mlx_local}"
export WORKER_ID="${WORKER_ID:-${MACHINE_NAME}-mlx}"
export CAPABILITY="${CAPABILITY:-speed}"
export FALLBACK_INFERENCE_URL="${FALLBACK_INFERENCE_URL:-http://localhost:8080}"
export FALLBACK_DEFAULT_MODEL="${FALLBACK_DEFAULT_MODEL:-mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit-mlx}"
export POLL_INTERVAL="${POLL_INTERVAL:-2000}"

# Auto-discover queue server via mDNS if QUEUE_URL not set
if [ -z "$QUEUE_URL" ]; then
  export QUEUE_URL=$(scripts/discover-queue.sh 30 5)
  if [ -z "$QUEUE_URL" ]; then
    echo "Failed to discover queue server" >&2
    exit 1
  fi
fi

exec bun run src/worker.ts
