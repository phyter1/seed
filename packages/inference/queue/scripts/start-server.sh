#!/bin/bash
# Start the queue server
export PATH="$HOME/.bun/bin:$PATH"
cd "$(dirname "$0")/.."

export QUEUE_PORT="${QUEUE_PORT:-7654}"
export QUEUE_DB="${QUEUE_DB:-queue.db}"

exec bun run src/main.ts
