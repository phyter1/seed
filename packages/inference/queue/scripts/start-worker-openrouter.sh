#!/bin/bash
# Start a queue worker for OpenRouter
export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")/.."

KEYS_FILE="${KEYS_FILE:-$HOME/.config/queue/keys.json}"
export API_KEY=$(python3 -c "import json; print(json.load(open('$KEYS_FILE'))['openrouter']['api_key'])")

export WORKER_ID="${WORKER_ID:-openrouter-cloud}"
export CAPABILITY="${CAPABILITY:-frontier}"
export INFERENCE_URL="${INFERENCE_URL:-https://openrouter.ai/api}"
export QUEUE_URL="${QUEUE_URL:-$(scripts/discover-queue.sh 30 5)}"
export DEFAULT_MODEL="${DEFAULT_MODEL:-meta-llama/llama-3.3-70b-instruct:free}"
export POLL_INTERVAL="${POLL_INTERVAL:-5000}"
export RATE_LIMITS="${RATE_LIMITS:-rpm=20,rpd=200}"

if [ -z "$QUEUE_URL" ]; then
  echo "Failed to discover queue server" >&2
  exit 1
fi

exec bun run src/worker.ts
