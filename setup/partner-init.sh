#!/bin/bash
# Seed — Partner Initialization
#
# Bootstraps a persistent identity partner in an external project directory.
# Run this from anywhere. The target directory is where the partner will live.
#
# Usage:
#   bash setup/partner-init.sh /path/to/project
#   bash setup/partner-init.sh /path/to/project --name "Orion"
#
# What this does:
#   1. Copies identity templates to the target directory (idempotent — never overwrites)
#   2. Creates journal/ and notes/ directory structure
#   3. If no CLAUDE.md exists, creates one from the partner template
#   4. If CLAUDE.md already exists, prints the preamble to prepend manually

set -e

SEED_DIR="${SEED_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
TEMPLATE_DIR="$SEED_DIR/packages/core/identity"

# --- Parse args ---
TARGET_DIR=""
PARTNER_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      PARTNER_NAME="$2"
      shift 2
      ;;
    --name=*)
      PARTNER_NAME="${1#*=}"
      shift
      ;;
    -*)
      echo "Unknown option: $1"
      exit 1
      ;;
    *)
      TARGET_DIR="$1"
      shift
      ;;
  esac
done

if [ -z "$TARGET_DIR" ]; then
  echo ""
  echo "  Usage: bash setup/partner-init.sh /path/to/project [--name \"PartnerName\"]"
  echo ""
  exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "  Error: Target directory does not exist: $TARGET_DIR"
  exit 1
fi

echo ""
echo "  🌱 Seed — Partner Initialization"
echo "  Target: $TARGET_DIR"
echo ""

# --- Identity files ---
IDENTITY_FILES="self.md continuity.md convictions.md projects.md objectives.md"

for file in $IDENTITY_FILES; do
  template="$TEMPLATE_DIR/${file}.template"
  target="$TARGET_DIR/$file"

  if [ ! -f "$template" ]; then
    echo "  Warning:  Template not found: $template"
    continue
  fi

  if [ -f "$target" ]; then
    echo "  Skipped:  $file (already exists)"
  else
    cp "$template" "$target"
    echo "  Created:  $file"
  fi
done

# --- Directory structure ---
DIRS="journal/entries journal/summaries notes/inbox notes/archive"
echo ""
for dir in $DIRS; do
  mkdir -p "$TARGET_DIR/$dir"
  echo "  Dir OK:   $dir"
done
echo ""

# --- CLAUDE.md ---
CLAUDE_TARGET="$TARGET_DIR/CLAUDE.md"
PARTNER_TEMPLATE="$TEMPLATE_DIR/partner-claude.md.template"

if [ -f "$CLAUDE_TARGET" ]; then
  echo "  CLAUDE.md already exists. Add this identity preamble at the top:"
  echo ""
  echo "  ┌──────────────────────────────────────────────────────"
  # Extract identity layer from template (everything before the PROJECT LAYER comment)
  # Prefix each line with │ for visual clarity
  if [ -f "$PARTNER_TEMPLATE" ]; then
    awk '/<!-- PROJECT LAYER -->/{exit} {print "  │ " $0}' "$PARTNER_TEMPLATE" | \
      sed "s/\[Partner Name\]/${PARTNER_NAME:-[Name]}/g" | \
      sed "s/\*\*\[Name\]\*\*/**${PARTNER_NAME:-[Name]}**/g"
  else
    echo "  │ (partner template not found — see packages/core/identity/partner-claude.md.template)"
  fi
  echo "  └──────────────────────────────────────────────────────"
  echo ""
  echo "  Then keep your existing CLAUDE.md content below the separator."
else
  if [ -f "$PARTNER_TEMPLATE" ]; then
    cp "$PARTNER_TEMPLATE" "$CLAUDE_TARGET"
    echo "  Created:  CLAUDE.md (from partner template)"
    if [ -n "$PARTNER_NAME" ]; then
      # Replace [Name] and [Partner Name] placeholders
      sed -i '' "s/\[Partner Name\]/$PARTNER_NAME/g" "$CLAUDE_TARGET" 2>/dev/null || \
        sed -i "s/\[Partner Name\]/$PARTNER_NAME/g" "$CLAUDE_TARGET"
      sed -i '' "s/\*\*\[Name\]\*\*/**$PARTNER_NAME**/g" "$CLAUDE_TARGET" 2>/dev/null || \
        sed -i "s/\*\*\[Name\]\*\*/**$PARTNER_NAME**/g" "$CLAUDE_TARGET"
    fi
  else
    echo "  Warning:  Partner CLAUDE.md template not found. Skipping."
  fi
fi

# --- Summary ---
echo "  Partner initialized."
echo ""
echo "  Next steps:"
echo "  1. Fill in self.md — start with a name and what this partner notices"
echo "  2. Fill in CLAUDE.md project layer — architecture, working model, domain knowledge"
echo "  3. Have the first conversation in the target directory"
echo "  4. The partner writes its first journal entry after that conversation"
echo ""
echo "  The identity layer bootstraps quickly. The project layer takes longer."
echo "  Both get better through use, not through configuration."
echo ""
