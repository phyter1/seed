#!/bin/bash
# Start a queue worker for Groq cloud
export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")/.."

KEYS_FILE="${KEYS_FILE:-$HOME/.config/queue/keys.json}"
export API_KEY=$(python3 -c "import json; print(json.load(open('$KEYS_FILE'))['groq']['api_key'])")

export WORKER_ID="${WORKER_ID:-groq-cloud}"
export CAPABILITY="${CAPABILITY:-speed}"
export INFERENCE_URL="${INFERENCE_URL:-https://api.groq.com/openai}"
export QUEUE_URL="${QUEUE_URL:-$(scripts/discover-queue.sh 30 5)}"
export DEFAULT_MODEL="${DEFAULT_MODEL:-llama-3.3-70b-versatile}"
export POLL_INTERVAL="${POLL_INTERVAL:-3000}"
export RATE_LIMITS="${RATE_LIMITS:-rpm=30,rpd=1000,tpm=12000,tpd=100000}"

if [ -z "$QUEUE_URL" ]; then
  echo "Failed to discover queue server" >&2
  exit 1
fi

exec bun run src/worker.ts
