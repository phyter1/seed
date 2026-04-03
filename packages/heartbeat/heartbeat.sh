#!/bin/bash
# heartbeat.sh — Autonomous pulse
#
# Simple: wake up, think, do what you want.
# Claude handles all decisions. Bash just launches it.

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
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# PATH setup — launchd doesn't source profiles
export PATH="$HOME/.local/bin:$HOME/.npm/bin:$HOME/.bun/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
for node_bin in "$HOME"/.nvm/versions/node/*/bin; do
  [ -d "$node_bin" ] && export PATH="$node_bin:$PATH"
done

cd "$SEED_DIR"

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

# Run the agent
# Adjust --model to your preferred tier:
#   Quick beats: claude-sonnet-4-6 or claude-haiku-4-5
#   Deep beats: claude-opus-4-6
timeout 1500 claude -p "$PROMPT" \
  --model claude-sonnet-4-6 \
  --allowedTools "Read,Write,Edit,Glob,Grep,Bash,WebSearch,WebFetch,Agent" \
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

# Ingest any new journal entries (if you have a memory agent, uncomment and adjust)
# AFTER_ENTRIES=$(ls "$JOURNAL_DIR"/*.md 2>/dev/null | sort)
# NEW_ENTRIES=$(comm -13 <(echo "$BEFORE_ENTRIES") <(echo "$AFTER_ENTRIES"))
# if [ -n "$NEW_ENTRIES" ]; then
#   for entry in $NEW_ENTRIES; do
#     "$SEED_DIR/tools/ingest-entry.sh" "$entry" 2>&1 || true
#   done
# fi

# Keep only last 100 logs
ls -t "$LOG_DIR"/heartbeat-*.log 2>/dev/null | tail -n +101 | xargs rm -f 2>/dev/null || true
