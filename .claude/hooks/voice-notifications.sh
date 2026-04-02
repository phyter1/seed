#!/bin/bash
# Voice Notification Hook for Cici
# Uses tts-cli with caching for efficient audio generation

set -euo pipefail

# Configuration
VOICE="en-IE-EmilyNeural"  # Irish female voice
RATE="+10%"  # Slightly faster speech
TTS_CMD="tts-cli"

# Read payload from stdin
PAYLOAD=$(cat)

# Extract hook event and relevant data
EVENT=$(echo "$PAYLOAD" | jq -r '.hook_event_name // empty')
TOOL_NAME=$(echo "$PAYLOAD" | jq -r '.tool_name // empty')
SUBAGENT=$(echo "$PAYLOAD" | jq -r '.tool_input.subagent_type // empty')
SESSION_ID=$(echo "$PAYLOAD" | jq -r '.session_id // empty')

# Log action to stderr (for debugging)
log_action() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Voice Hook: $1" >&2
}


# Speak using tts-cli (with caching)
speak() {
  local message="$1"
  local pitch="${2:-+0Hz}"
  
  # Run TTS in background to avoid blocking
  ($TTS_CMD "$message" --voice "$VOICE" --rate "$RATE" --pitch "$pitch" 2>/dev/null &) &
}

# Determine what to say based on event
case "$EVENT" in
  "SessionEnd")
    speak "Bye"
    log_action "Announced session end"
    ;;
    
  "Stop")
    speak "All done"
    log_action "Announced task completion"
    ;;
    
  "SubagentStop")
    if [[ -n "$SUBAGENT" ]]; then
      case "$SUBAGENT" in
        "general-purpose")
          speak "Research done"
          ;;
        "typescript-developer")
          speak "Code done"
          ;;
        "task-planner")
          speak "Plan ready"
          ;;
        "docs-researcher")
          speak "Docs found"
          ;;
        *)
          speak "Agent done"
          ;;
      esac
    else
      speak "Task done"
    fi
    log_action "Announced subagent completion: $SUBAGENT"
    ;;
    
  "PreToolUse")
    # Only announce certain important tools
    case "$TOOL_NAME" in
      "Task")
        speak "Starting"
        ;;
      "Bash")
        # Don't announce every bash command - too noisy
        ;;
      "Write"|"MultiEdit")
        # Optionally announce file writes
        # speak "Writing"
        ;;
    esac
    ;;
    
  "PostToolUse")
    # Announce completion of long-running tools
    case "$TOOL_NAME" in
      "Task")
        speak "Task complete"
        ;;
    esac
    ;;
    
  "Notification")
    # Read notification message if available
    MESSAGE=$(echo "$PAYLOAD" | jq -r '.message // empty')
    if [[ -n "$MESSAGE" ]]; then
      # Truncate long messages
      if [[ ${#MESSAGE} -gt 50 ]]; then
        MESSAGE="${MESSAGE:0:47}..."
      fi
      speak "$MESSAGE"
      log_action "Announced notification"
    fi
    ;;
    
  "Error")
    speak "Oops"
    log_action "Announced error"
    ;;
esac

exit 0