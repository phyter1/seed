#!/bin/bash
# Seed — Build standalone binaries for the fleet agent, CLI, and control plane.
#
# Produces 6 binaries (3 programs x 2 architectures) in dist/, along with
# SHA-256 checksums. Binaries are self-contained (Bun runtime embedded) and
# require no external dependencies on the target machine.
#
# Usage:
#   bash scripts/build-binaries.sh
#
# Output:
#   dist/seed-agent-darwin-arm64
#   dist/seed-agent-darwin-x64
#   dist/seed-cli-darwin-arm64
#   dist/seed-cli-darwin-x64
#   dist/seed-control-plane-darwin-arm64
#   dist/seed-control-plane-darwin-x64
#   dist/checksums.txt

set -euo pipefail

# Resolve paths relative to this script so it works from any CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PKG_DIR/dist"

cd "$PKG_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is not installed. Install from https://bun.sh" >&2
  exit 1
fi

echo "==> Cleaning $DIST_DIR"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Binary matrix: <source-file>:<output-prefix>
BUILDS=(
  "src/agent.ts:seed-agent"
  "src/cli.ts:seed-cli"
  "src/main.ts:seed-control-plane"
)

TARGETS=(
  "bun-darwin-arm64:darwin-arm64"
  "bun-darwin-x64:darwin-x64"
)

echo "==> Building binaries"
for build in "${BUILDS[@]}"; do
  src="${build%%:*}"
  prefix="${build##*:}"

  for target in "${TARGETS[@]}"; do
    bun_target="${target%%:*}"
    arch_suffix="${target##*:}"
    out="$DIST_DIR/${prefix}-${arch_suffix}"

    echo "    - ${prefix}-${arch_suffix}  <-  ${src}"
    if ! bun build --compile --target="$bun_target" --outfile="$out" "$src"; then
      echo "error: build failed for ${prefix}-${arch_suffix}" >&2
      exit 1
    fi
  done
done

echo ""
echo "==> Binary sizes"
# `du -h` is portable across macOS and Linux.
( cd "$DIST_DIR" && du -h seed-* | sort -k2 )

echo ""
echo "==> Computing SHA-256 checksums"
(
  cd "$DIST_DIR"
  # shasum ships with macOS; sha256sum on Linux.
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 seed-* > checksums.txt
  else
    sha256sum seed-* > checksums.txt
  fi
)
cat "$DIST_DIR/checksums.txt"

echo ""
echo "==> Done. Artifacts in $DIST_DIR"
