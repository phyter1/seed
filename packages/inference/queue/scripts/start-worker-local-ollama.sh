#!/bin/bash
# Start a queue worker for a local Ollama instance.
#
# Configure via environment variables:
#   WORKER_ID       — unique name for this worker (default: $HOSTNAME-ollama)
#   CAPABILITY      — speed|reasoning|code|any (default: any)
#   INFERENCE_URL   — Ollama endpoint (default: http://localhost:11434)
#   DEFAULT_MODEL   — model to use (required)
#   QUEUE_URL       — queue server URL (auto-discovered if not set)
#   POLL_INTERVAL   — ms between polls (default: 2000)
export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")/.."

MACHINE_NAME="${HOSTNAME:-$(hostname)}"

export WORKER_ID="${WORKER_ID:-${MACHINE_NAME}-ollama}"
export CAPABILITY="${CAPABILITY:-any}"
export INFERENCE_URL="${INFERENCE_URL:-http://localhost:11434}"
export POLL_INTERVAL="${POLL_INTERVAL:-2000}"

if [ -z "$DEFAULT_MODEL" ]; then
  echo "DEFAULT_MODEL is required (e.g. DEFAULT_MODEL=nemotron-cascade-2)" >&2
  exit 1
fi

# Auto-discover queue server via mDNS if QUEUE_URL not set
if [ -z "$QUEUE_URL" ]; then
  export QUEUE_URL=$(scripts/discover-queue.sh 30 5)
  if [ -z "$QUEUE_URL" ]; then
    echo "Failed to discover queue server" >&2
    exit 1
  fi
fi

exec bun run src/worker.ts
