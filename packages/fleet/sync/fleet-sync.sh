#!/bin/bash
# fleet-sync.sh — Sync repos across machines
#
# Reads a fleet-repos.json config and pulls/statuses repos accordingly.
# Supports three sync policies:
#   - bidirectional-auto: uses a repo-local sync script for conflict resolution
#   - ff-only: fast-forward pull only (fails on divergence)
#   - manual: skip (human handles it)
#
# Usage:
#   fleet-sync.sh status   — Show sync status of all repos
#   fleet-sync.sh pull     — Pull all repos according to their sync policy

set -euo pipefail

# Auto-detect SEED_DIR from script location, or use env var
SEED_DIR="${SEED_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
CONFIG_FILE="${FLEET_REPOS_CONFIG:-$SEED_DIR/config/fleet-repos.json}"
ACTION="${1:-status}"

if ! command -v jq >/dev/null 2>&1; then
  echo "fleet-sync.sh requires jq" >&2
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Config not found: $CONFIG_FILE" >&2
  echo "Copy fleet-repos.json.example to fleet-repos.json and fill in your repos." >&2
  exit 1
fi

run_status() {
  jq -c '.repos[]' "$CONFIG_FILE" | while read -r repo; do
    id="$(echo "$repo" | jq -r '.id')"
    path="$(echo "$repo" | jq -r '.path')"
    policy="$(echo "$repo" | jq -r '.sync_policy')"

    if [ ! -d "$path/.git" ]; then
      echo "$id [$policy] MISSING $path"
      continue
    fi

    branch="$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
    dirty="$(git -C "$path" status --short 2>/dev/null | wc -l | tr -d ' ')"
    echo "$id [$policy] branch=$branch dirty=$dirty path=$path"
  done
}

run_pull() {
  jq -c '.repos[]' "$CONFIG_FILE" | while read -r repo; do
    id="$(echo "$repo" | jq -r '.id')"
    path="$(echo "$repo" | jq -r '.path')"
    branch="$(echo "$repo" | jq -r '.branch')"
    policy="$(echo "$repo" | jq -r '.sync_policy')"
    sync_script="$(echo "$repo" | jq -r '.sync_script // empty')"

    if [ ! -d "$path/.git" ]; then
      echo "$id: missing repo at $path" >&2
      continue
    fi

    case "$policy" in
      bidirectional-auto)
        if [ -n "$sync_script" ] && [ -x "$path/$sync_script" ]; then
          "$path/$sync_script"
          echo "$id: ran repo-local auto-sync ($sync_script)"
        else
          echo "$id: bidirectional-auto requires a sync_script in config" >&2
        fi
        ;;
      ff-only)
        if [ -n "$(git -C "$path" status --short 2>/dev/null)" ]; then
          echo "$id: dirty worktree, skipped ff-only pull" >&2
          continue
        fi
        git -C "$path" fetch origin --prune
        git -C "$path" pull --ff-only origin "$branch"
        echo "$id: fast-forwarded $branch"
        ;;
      manual)
        echo "$id: manual policy, skipped"
        ;;
      *)
        echo "$id: unknown sync policy $policy" >&2
        ;;
    esac
  done
}

case "$ACTION" in
  status)
    run_status
    ;;
  pull)
    run_pull
    ;;
  *)
    echo "Usage: $0 [status|pull]" >&2
    exit 1
    ;;
esac
