#!/usr/bin/env bash
#
# validate-doc-paths.sh — check that path references in documentation
# actually exist in the repo. Catches silent documentation rot when
# files or directories are renamed or removed.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# --- Allow-list: gitignored identity files that are absent in CI ---
ALLOWLIST=(
  "self.md"
  "continuity.md"
  "convictions.md"
  "projects.md"
  "objectives.md"
  "seed.config.json"
)

is_allowlisted() {
  local path="$1"
  for allowed in "${ALLOWLIST[@]}"; do
    if [[ "$path" == "$allowed" ]]; then
      return 0
    fi
  done
  return 1
}

# --- Extract backtick-delimited path references from doc files ---
extract_paths() {
  local file="$1"

  # 1. Strip fenced code blocks (```...```) — those contain shell commands, not path refs
  #    We use awk to skip lines between ``` fences.
  # 2. From the remaining lines, extract backtick-delimited strings
  # 3. Filter to things that look like paths (contain / or end with known extensions)
  awk '
    /^```/ { in_block = !in_block; next }
    !in_block { print }
  ' "$file" \
  | grep -oE '`[^`]+`' \
  | sed 's/^`//;s/`$//' \
  | grep -E '(/|\.(md|ts|sh|json|yml|toml|template)$)' \
  | while IFS= read -r ref; do
      # Skip absolute paths, home dirs, env vars, URLs, slash commands
      [[ "$ref" == ~* ]] && continue
      [[ "$ref" == \$* ]] && continue
      [[ "$ref" == /* ]] && continue
      [[ "$ref" == http://* ]] && continue
      [[ "$ref" == https://* ]] && continue
      [[ "$ref" == file://* ]] && continue

      # Skip shell commands that snuck through (contain spaces)
      [[ "$ref" == *" "* ]] && continue

      # Skip glob patterns
      [[ "$ref" == *"*"* ]] && continue

      # Skip action-style references (service.start/stop/..., agent.update/restart)
      [[ "$ref" =~ ^[a-z]+\.[a-z]+/.+ ]] && continue

      # Skip version-templated or parameterized paths
      [[ "$ref" == *"<"* ]] && continue

      # Print the cleaned path
      echo "$ref"
    done
}

# --- Main ---
errors=()

for doc in README.md CLAUDE.md CLAUDE.md.template; do
  [[ -f "$doc" ]] || continue

  while IFS= read -r path; do
    [[ -z "$path" ]] && continue

    # Strip trailing / for existence checks
    clean="${path%/}"

    # Allow-listed?
    if is_allowlisted "$clean"; then
      continue
    fi

    # Bare filename (no /) — these are contextual references within described
    # directory structures (e.g. "agent.ts" listed under packages/fleet/control/src/).
    # We can only reliably validate paths that include directory components.
    if [[ "$clean" != */* ]]; then
      continue
    fi

    # Only validate paths whose first segment is a known top-level directory.
    # Paths like "supervisors/launchd.ts" are contextual sub-references within
    # a described parent directory — they can't be resolved from the repo root.
    first_segment="${clean%%/*}"
    if [[ ! -d "$first_segment" && ! -f "$first_segment" ]]; then
      continue
    fi

    # Path with / — check as file or directory
    if [[ "$path" == */ ]]; then
      # Explicit directory reference
      if [[ ! -d "$clean" ]]; then
        errors+=("$doc: $path (directory not found)")
      fi
    elif [[ -f "$clean" || -d "$clean" ]]; then
      # Exists as file or directory
      :
    else
      errors+=("$doc: $path (not found)")
    fi
  done < <(extract_paths "$doc")
done

if [[ ${#errors[@]} -gt 0 ]]; then
  echo "ERROR: Documentation references paths that don't exist in the repo:"
  echo ""
  for err in "${errors[@]}"; do
    echo "  - $err"
  done
  echo ""
  echo "Fix the documentation or add the missing file/directory."
  exit 1
fi

echo "All documentation paths validated successfully."
exit 0
