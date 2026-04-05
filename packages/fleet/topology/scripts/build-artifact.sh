#!/bin/bash
# Build a static workload artifact bundle for @seed/fleet-topology.
#
# Produces: dist/artifacts/fleet-topology-<version>-<platform>-<arch>.tar.gz
#
# Each tarball contains:
#   manifest.json (kind: "static")
#   seed.config.json
#
# The installer extracts this bundle to
# ~/.local/share/seed/workloads/fleet-topology-<version>/ and updates
# the fleet-topology-current symlink. Consumers (fleet-router, etc.)
# read through the symlink for a stable path that follows the latest
# installed version.
#
# Platform/arch are recorded in the manifest but have no effect — the
# payload is a JSON file. Tarballs are built per-platform to match
# the WorkloadDeclaration resolution convention used by the control
# plane's artifact server, not because the content differs.
#
# Usage:
#   bash scripts/build-artifact.sh [--version <ver>]
#   bash scripts/build-artifact.sh --targets "darwin-arm64 linux-x64"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../../.." && pwd)"
DIST_DIR="$PKG_DIR/dist"
ARTIFACTS_DIR="$DIST_DIR/artifacts"

VERSION=""
TARGETS="darwin-arm64 darwin-x64 linux-x64"

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --targets) TARGETS="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | head -25; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('$PKG_DIR/package.json').version")
fi

SEED_CONFIG_SRC="${SEED_CONFIG_SRC:-$REPO_ROOT/seed.config.json}"
if [ ! -f "$SEED_CONFIG_SRC" ]; then
  echo "error: seed.config.json not found at $SEED_CONFIG_SRC" >&2
  echo "  (it is gitignored — copy it from the primary worktree, or set SEED_CONFIG_SRC)" >&2
  exit 1
fi

mkdir -p "$ARTIFACTS_DIR"

for target in $TARGETS; do
  platform="${target%-*}"
  arch="${target##*-}"

  stage="$ARTIFACTS_DIR/stage-$target"
  rm -rf "$stage"
  mkdir -p "$stage"

  cp "$SEED_CONFIG_SRC" "$stage/seed.config.json"

  config_sha=$(shasum -a 256 "$stage/seed.config.json" | awk '{print $1}')

  cat > "$stage/manifest.json" <<EOF
{
  "id": "fleet-topology",
  "version": "$VERSION",
  "kind": "static",
  "description": "Fleet topology (machines, providers, models) — seed.config.json as a standalone workload",
  "platform": "$platform",
  "arch": "$arch",
  "checksums": {
    "seed.config.json": "sha256:$config_sha"
  }
}
EOF

  tarball="$ARTIFACTS_DIR/fleet-topology-$VERSION-$target.tar.gz"
  ( cd "$stage" && tar -czf "$tarball" . )
  rm -rf "$stage"
  echo "  + $tarball"
done

echo ""
echo "==> Artifact checksums"
( cd "$ARTIFACTS_DIR" && shasum -a 256 fleet-topology-*.tar.gz )

echo ""
echo "==> Done."
