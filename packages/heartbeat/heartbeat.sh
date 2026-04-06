#!/bin/bash
# heartbeat.sh — Autonomous pulse
#
# Simple: wake up, think, do what you want.
# Bash handles orchestration. A configured host adapter handles execution.

set -euo pipefail

SEED_DIR="${SEED_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
HEARTBEAT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SEED_DIR/logs"
LOCK_FILE="$HEARTBEAT_DIR/.heartbeat.lock"
BEAT_COUNTER_FILE="$HEARTBEAT_DIR/.beat-counter"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")

mkdir -p "$LOG_DIR"

# Prevent overlapping beats
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "[$TIMESTAMP] Previous heartbeat (PID $LOCK_PID) still running. Skipping."
    exit 0
  else
    rm -f "$LOCK_FILE"
  fi
fi
PROMPT_FILE=""
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE" "$PROMPT_FILE"' EXIT

# PATH setup — launchd doesn't source profiles
export PATH="$HOME/.local/bin:$HOME/.npm/bin:$HOME/.bun/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
for node_bin in "$HOME"/.nvm/versions/node/*/bin; do
  [ -d "$node_bin" ] && export PATH="$node_bin:$PATH"
done

cd "$SEED_DIR"

# Resolve memory service URL
# Order: env var → seed.config.json → control plane → fallback
MEMORY_URL=""
if [ -n "${SEED_MEMORY_URL:-}" ]; then
  MEMORY_URL="$SEED_MEMORY_URL"
elif [ -f "$SEED_DIR/seed.config.json" ]; then
  _cfg_url=$(jq -r '.memory_url // empty' "$SEED_DIR/seed.config.json" 2>/dev/null || true)
  [ -n "$_cfg_url" ] && MEMORY_URL="$_cfg_url"
fi
if [ -z "$MEMORY_URL" ]; then
  _cp_url=$(curl -sf --max-time 3 "http://${SEED_CONTROL_URL:-ren2.local:4310}/v1/services/memory" 2>/dev/null | jq -r '.url // empty' 2>/dev/null || true)
  [ -n "$_cp_url" ] && MEMORY_URL="$_cp_url"
fi
if [ -z "$MEMORY_URL" ]; then
  MEMORY_URL="http://ren1.local:19888"
fi
echo "[$TIMESTAMP] Memory service: $MEMORY_URL"

# Beat counter
BEAT_COUNT=$(cat "$BEAT_COUNTER_FILE" 2>/dev/null || echo "0")
BEAT_COUNT=$((BEAT_COUNT + 1))
echo "$BEAT_COUNT" > "$BEAT_COUNTER_FILE"

LOG_PATH="$LOG_DIR/heartbeat-${TIMESTAMP}.log"

# Snapshot journal entries before the beat
JOURNAL_DIR="$SEED_DIR/journal/entries"
BEFORE_ENTRIES=$(ls "$JOURNAL_DIR"/*.md 2>/dev/null | sort)

echo "[$TIMESTAMP] Beat #$BEAT_COUNT" | tee "$LOG_PATH"

# Build prompt: base + any inbox notes
PROMPT="$(cat "$HEARTBEAT_DIR/heartbeat-prompt.txt")"

INBOX_DIR="$SEED_DIR/notes/inbox"
ARCHIVE_DIR="$SEED_DIR/notes/archive"
INBOX_NOTES=""
for note in "$INBOX_DIR"/*.md; do
  [ -f "$note" ] || continue
  INBOX_NOTES="${INBOX_NOTES}
---
**$(basename "$note" .md):**
$(cat "$note")
"
done

if [ -n "$INBOX_NOTES" ]; then
  PROMPT="${PROMPT}

## Inbox

You have notes waiting. Read them, act on them if you want, or ignore them.
${INBOX_NOTES}"
fi

PROMPT_FILE=$(mktemp "${TMPDIR:-/tmp}/seed-heartbeat-prompt.XXXXXX")
printf "%s" "$PROMPT" > "$PROMPT_FILE"

# Pre-beat memory recall
if [ -n "$MEMORY_URL" ]; then
  MEMORY_CONTEXT=""

  # Semantic search for recent context
  _search=$(curl -sf --max-time 5 "${MEMORY_URL}/search?q=recent+context&project=seed&k=5" 2>/dev/null || true)
  if [ -n "$_search" ]; then
    _summaries=$(echo "$_search" | jq -r '.results[]?.summary // empty' 2>/dev/null || true)
    [ -n "$_summaries" ] && MEMORY_CONTEXT="$_summaries"
  fi

  # Recent memories (complement semantic search)
  _recent=$(curl -sf --max-time 5 "${MEMORY_URL}/memories?project=seed" 2>/dev/null || true)
  if [ -n "$_recent" ]; then
    _rsummaries=$(echo "$_recent" | jq -r '[.memories[]?.summary // empty] | .[0:5] | .[]' 2>/dev/null || true)
    if [ -n "$_rsummaries" ]; then
      [ -n "$MEMORY_CONTEXT" ] && MEMORY_CONTEXT="${MEMORY_CONTEXT}
${_rsummaries}" || MEMORY_CONTEXT="$_rsummaries"
    fi
  fi

  # Deduplicate and append to prompt
  if [ -n "$MEMORY_CONTEXT" ]; then
    _deduped=$(echo "$MEMORY_CONTEXT" | awk '!seen[$0]++')
    _numbered=""
    _i=1
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      _numbered="${_numbered}${_i}. ${line}
"
      _i=$((_i + 1))
    done <<< "$_deduped"

    if [ -n "$_numbered" ]; then
      printf "\n\n## Memory Context\n\nRecalled from previous beats and sessions:\n\n%s" "$_numbered" >> "$PROMPT_FILE"
      echo "[$TIMESTAMP] Injected memory context ($_i memories)" | tee -a "$LOG_PATH"
    fi
  fi
fi

HOST_ARGS=()
[ -n "${HEARTBEAT_HOST:-}" ] && HOST_ARGS+=(--host "$HEARTBEAT_HOST")
[ -n "${HEARTBEAT_MODEL:-}" ] && HOST_ARGS+=(--model "$HEARTBEAT_MODEL")

# Run the configured host adapter
# Configuration resolution order:
#   1. HEARTBEAT_HOST / HEARTBEAT_MODEL env vars
#   2. seed.config.json heartbeat.host / heartbeat.model
#   3. seed.config.json host.heartbeat / host.default
#   4. default host: claude
timeout 1500 bun run "$SEED_DIR/packages/hosts/src/run-headless.ts" \
  --seed-dir "$SEED_DIR" \
  --prompt-file "$PROMPT_FILE" \
  "${HOST_ARGS[@]}" \
  2>&1 | tee -a "$LOG_PATH"

EXIT_CODE=${PIPESTATUS[0]}

if [ "$EXIT_CODE" -eq 124 ]; then
  echo "[$TIMESTAMP] Beat #$BEAT_COUNT TIMED OUT" | tee -a "$LOG_PATH"
elif [ "$EXIT_CODE" -ne 0 ]; then
  echo "[$TIMESTAMP] Beat #$BEAT_COUNT exited with code $EXIT_CODE" | tee -a "$LOG_PATH"
fi

# Archive inbox notes — they've been read this beat
for note in "$INBOX_DIR"/*.md; do
  [ -f "$note" ] && mv "$note" "$ARCHIVE_DIR/" 2>/dev/null || true
done

# Ingest new journal entries into memory service
if [ -n "$MEMORY_URL" ]; then
  AFTER_ENTRIES=$(ls "$JOURNAL_DIR"/*.md 2>/dev/null | sort)
  NEW_ENTRIES=$(comm -13 <(echo "$BEFORE_ENTRIES") <(echo "$AFTER_ENTRIES"))
  if [ -n "$NEW_ENTRIES" ]; then
    while IFS= read -r entry; do
      [ -z "$entry" ] && continue
      _text=$(cat "$entry" 2>/dev/null || true)
      [ -z "$_text" ] && continue
      _payload=$(jq -n --arg text "$_text" --arg source "heartbeat" --arg project "seed" --arg origin "internal" \
        '{text: $text, source: $source, project: $project, origin: $origin}')
      _resp=$(curl -sf --max-time 10 -X POST "${MEMORY_URL}/ingest" \
        -H "Content-Type: application/json" \
        -d "$_payload" 2>/dev/null || true)
      if [ -n "$_resp" ]; then
        echo "[$TIMESTAMP] Ingested $(basename "$entry")" | tee -a "$LOG_PATH"
      else
        echo "[$TIMESTAMP] Failed to ingest $(basename "$entry")" | tee -a "$LOG_PATH"
      fi
    done <<< "$NEW_ENTRIES"
  fi
fi

# Keep only last 100 logs
ls -t "$LOG_DIR"/heartbeat-*.log 2>/dev/null | tail -n +101 | xargs rm -f 2>/dev/null || true
