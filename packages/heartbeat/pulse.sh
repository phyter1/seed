#!/bin/bash
# pulse.sh — Control the heartbeat daemon
#
# Usage:
#   ./pulse.sh start    — Install and start the heartbeat
#   ./pulse.sh stop     — Stop and uninstall the heartbeat
#   ./pulse.sh status   — Check if heartbeat is running
#   ./pulse.sh beat     — Trigger one heartbeat manually right now
#   ./pulse.sh logs     — Tail the most recent heartbeat log
#   ./pulse.sh interval — Change the interval (e.g., ./pulse.sh interval 3600)

set -euo pipefail

HEARTBEAT_DIR="$(cd "$(dirname "$0")" && pwd)"
SEED_DIR="${SEED_DIR:-$(cd "$HEARTBEAT_DIR/../.." && pwd)}"
PLIST_NAME="com.seed.heartbeat"
PLIST_SOURCE="$HEARTBEAT_DIR/com.seed.heartbeat.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
LOG_DIR="$SEED_DIR/logs"

case "${1:-help}" in
  start)
    mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

    # Generate plist from template if it doesn't exist
    if [ ! -f "$PLIST_SOURCE" ]; then
      TEMPLATE="$HEARTBEAT_DIR/com.seed.heartbeat.plist.template"
      if [ -f "$TEMPLATE" ]; then
        sed -e "s|SEED_DIR|$SEED_DIR|g" -e "s|HOME_DIR|$HOME|g" "$TEMPLATE" > "$PLIST_SOURCE"
        echo "Generated plist from template."
      else
        echo "No plist or template found. Create com.seed.heartbeat.plist.template first." >&2
        exit 1
      fi
    fi

    cp "$PLIST_SOURCE" "$PLIST_DEST"
    launchctl load "$PLIST_DEST"
    echo "Heartbeat started. Pulse every 30 minutes."
    echo "First beat will happen now (RunAtLoad)."
    ;;

  stop)
    launchctl unload "$PLIST_DEST" 2>/dev/null || true
    rm -f "$PLIST_DEST"
    echo "Heartbeat stopped."
    ;;

  status)
    if launchctl list | grep -q "$PLIST_NAME"; then
      echo "Heartbeat is ALIVE"
      launchctl list "$PLIST_NAME" 2>/dev/null || true
    else
      echo "Heartbeat is NOT running"
    fi
    ;;

  beat)
    echo "Triggering manual heartbeat..."
    bash "$HEARTBEAT_DIR/heartbeat.sh"
    ;;

  logs)
    LATEST=$(ls -t "$LOG_DIR"/heartbeat-*.log 2>/dev/null | head -1)
    if [ -n "$LATEST" ]; then
      echo "=== Most recent heartbeat: $LATEST ==="
      cat "$LATEST"
    else
      echo "No heartbeat logs yet."
    fi
    ;;

  interval)
    SECONDS="${2:?Usage: ./pulse.sh interval <seconds>}"
    # Update the plist with new interval
    if [ -f "$PLIST_SOURCE" ]; then
      sed -i '' "s|<integer>[0-9]*</integer><!-- interval -->|<integer>${SECONDS}</integer><!-- interval -->|" "$PLIST_SOURCE"
    fi
    # Reload if running
    if launchctl list | grep -q "$PLIST_NAME"; then
      launchctl unload "$PLIST_DEST" 2>/dev/null || true
      cp "$PLIST_SOURCE" "$PLIST_DEST"
      launchctl load "$PLIST_DEST"
      echo "Interval updated to ${SECONDS}s and reloaded."
    else
      echo "Interval updated to ${SECONDS}s. Start with: ./pulse.sh start"
    fi
    ;;

  *)
    echo "Usage: ./pulse.sh <command>"
    echo ""
    echo "Commands:"
    echo "  start          — Start the heartbeat daemon"
    echo "  stop           — Stop the heartbeat daemon"
    echo "  status         — Check heartbeat status"
    echo "  beat           — Trigger one manual heartbeat"
    echo "  logs           — Show latest heartbeat log"
    echo "  interval <s>   — Change heartbeat interval"
    ;;
esac
