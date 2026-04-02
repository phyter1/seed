#!/bin/bash
# Voice Attention Hook - Alerts when Cici needs user input
# Uses tts-cli with caching for efficient audio generation

set -euo pipefail

# Configuration
VOICE="en-IE-EmilyNeural"  # Irish female voice
TTS_CMD="tts-cli"

# Read payload from stdin
PAYLOAD=$(cat)

# Extract event details
EVENT=$(echo "$PAYLOAD" | jq -r '.hook_event_name // empty')
MESSAGE=$(echo "$PAYLOAD" | jq -r '.message // empty')
ERROR_MSG=$(echo "$PAYLOAD" | jq -r '.error_message // empty')
TOOL_NAME=$(echo "$PAYLOAD" | jq -r '.tool_name // empty')

# Speak a phrase using tts-cli (with caching)
speak() {
  local message="$1"
  local rate="${2:-+0%}"
  local pitch="${3:-+0Hz}"
  
  ($TTS_CMD "$message" --voice "$VOICE" --rate "$rate" --pitch "$pitch" 2>/dev/null &) &
}

# Quick attention sound
attention_sound() {
  speak "Hey" "+20%" "+10Hz"
}

# Handle different scenarios
case "$EVENT" in
  "UserInputRequired")
    # Waiting for user input
    speak "I need your input" "+10%"
    ;;
    
  "Error")
    # Error occurred
    if [[ -n "$ERROR_MSG" ]]; then
      if [[ "$ERROR_MSG" == *"permission"* ]]; then
        speak "I need permission" "+10%"
      elif [[ "$ERROR_MSG" == *"not found"* ]]; then
        speak "Can't find it" "+10%"
      elif [[ "$ERROR_MSG" == *"auth"* ]] || [[ "$ERROR_MSG" == *"token"* ]]; then
        speak "Auth issue" "+10%"
      else
        speak "Got an error" "+10%"
      fi
    else
      speak "Error" "+10%"
    fi
    ;;
    
  "BlockedByHook")
    # Hook blocked action
    speak "Blocked by hook" "+10%"
    ;;
    
  "ConfirmationNeeded")
    # Need confirmation
    speak "Need confirmation" "+10%"
    ;;
    
  "LongTaskComplete")
    # Long task finished
    speak "Task complete" "+10%"
    ;;
    
  "SessionTimeout")
    # Session timing out
    speak "Session ending soon" "+10%"
    ;;
    
  "Stop")
    # Task done
    speak "Done" "+5%"
    ;;
    
  "HighPriorityNotification")
    # Important notification
    attention_sound
    sleep 0.3
    if [[ -n "$MESSAGE" ]]; then
      speak "$MESSAGE" "+10%" "+5Hz"
    else
      speak "Important" "+10%" "+5Hz"
    fi
    ;;
esac

exit 0