#!/bin/bash
# Start a queue worker for OpenRouter
export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")/.."

KEYS_FILE="${KEYS_FILE:-$HOME/.config/queue/keys.json}"
export API_KEY=$(python3 -c "import json; print(json.load(open('$KEYS_FILE'))['openrouter']['api_key'])")

export PROVIDER_ID="${PROVIDER_ID:-openrouter}"
export WORKER_ID="${WORKER_ID:-openrouter-cloud}"
export CAPABILITY="${CAPABILITY:-frontier}"
export QUEUE_URL="${QUEUE_URL:-$(scripts/discover-queue.sh 30 5)}"
export FALLBACK_INFERENCE_URL="${FALLBACK_INFERENCE_URL:-https://openrouter.ai/api/v1}"
export FALLBACK_DEFAULT_MODEL="${FALLBACK_DEFAULT_MODEL:-meta-llama/llama-3.3-70b-instruct:free}"
export POLL_INTERVAL="${POLL_INTERVAL:-5000}"
export RATE_LIMITS="${RATE_LIMITS:-rpm=20,rpd=200}"

if [ -z "$QUEUE_URL" ]; then
  echo "Failed to discover queue server" >&2
  exit 1
fi

exec bun run src/worker.ts
