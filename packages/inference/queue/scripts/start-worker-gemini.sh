#!/bin/bash
# Start a queue worker for Google Gemini
export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")/.."

KEYS_FILE="${KEYS_FILE:-$HOME/.config/queue/keys.json}"
export API_KEY=$(python3 -c "import json; print(json.load(open('$KEYS_FILE'))['gemini']['api_key'])")

export WORKER_ID="${WORKER_ID:-gemini-cloud}"
export CAPABILITY="${CAPABILITY:-any}"
export INFERENCE_URL="${INFERENCE_URL:-https://generativelanguage.googleapis.com/v1beta/openai}"
export QUEUE_URL="${QUEUE_URL:-$(scripts/discover-queue.sh 30 5)}"
export DEFAULT_MODEL="${DEFAULT_MODEL:-gemini-2.5-flash}"
export POLL_INTERVAL="${POLL_INTERVAL:-5000}"
export RATE_LIMITS="${RATE_LIMITS:-rpm=10,rpd=250,tpm=250000}"

if [ -z "$QUEUE_URL" ]; then
  echo "Failed to discover queue server" >&2
  exit 1
fi

exec bun run src/worker.ts
