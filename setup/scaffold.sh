#!/bin/bash
# Seed — Identity Scaffolding
# Copies identity templates to root. Idempotent — never overwrites existing files.
set -e

SEED_DIR="${SEED_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
TEMPLATE_DIR="$SEED_DIR/packages/core/identity"

echo ""
echo "  🌱 Seed — Identity Scaffolding"
echo ""

# --- Identity files ---
IDENTITY_FILES="self.md continuity.md convictions.md projects.md objectives.md"

for file in $IDENTITY_FILES; do
  template="$TEMPLATE_DIR/${file}.template"
  target="$SEED_DIR/$file"

  if [ ! -f "$template" ]; then
    echo "  Warning:  Template not found: $template"
    continue
  fi

  if [ -f "$target" ]; then
    echo "  Skipped:  $file (already exists)"
  else
    cp "$template" "$target"
    echo "  Created:  $file (from template)"
  fi
done

# --- Directory structure ---
DIRS="journal/entries journal/summaries notes/inbox notes/archive"

for dir in $DIRS; do
  mkdir -p "$SEED_DIR/$dir"
done

echo ""
echo "  Directories: OK"
echo ""
echo "  Scaffolding complete. These are starting points — fill them in through conversation."
echo ""
