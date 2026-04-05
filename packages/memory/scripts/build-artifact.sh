#!/bin/bash
# Build a workload artifact bundle for seed-memory.
#
# Produces: dist/artifacts/memory-<version>-<platform>-<arch>.tar.gz
#
# Each tarball contains:
#   manifest.json
#   bin/seed-memory
#   lib/vec0.{dylib,so}
#   templates/launchd.plist.template
#
# Run after `bash scripts/build-binaries.sh` (needs dist/seed-memory-*
# and dist/sqlite-vec-*/ populated).
#
# Usage:
#   bash scripts/build-artifact.sh [--version <ver>]
#   bash scripts/build-artifact.sh --targets "darwin-arm64 darwin-x64"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PKG_DIR/dist"
ARTIFACTS_DIR="$DIST_DIR/artifacts"

VERSION=""
TARGETS="darwin-arm64 darwin-x64 linux-x64"

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --targets) TARGETS="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | head -20; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('$PKG_DIR/package.json').version")
fi

mkdir -p "$ARTIFACTS_DIR"

for target in $TARGETS; do
  binary="$DIST_DIR/seed-memory-$target"
  if [ ! -f "$binary" ]; then
    echo "skip $target: $binary not found (run build-binaries.sh first)" >&2
    continue
  fi
  # Locate sqlite-vec extension
  vec_dir="$DIST_DIR/sqlite-vec-$target"
  vec_file=""
  if [ -d "$vec_dir" ]; then
    vec_file=$(find "$vec_dir" -maxdepth 1 -name "vec0.*" -print -quit)
  fi

  platform="${target%-*}"  # e.g. darwin from darwin-arm64
  arch="${target##*-}"     # e.g. arm64 from darwin-arm64
  ext_name=""
  if [ -n "$vec_file" ]; then
    ext_name="vec0.$(basename "$vec_file" | sed 's/vec0\.//')"
  fi

  stage="$ARTIFACTS_DIR/stage-$target"
  rm -rf "$stage"
  mkdir -p "$stage/bin" "$stage/lib" "$stage/templates"
  cp "$binary" "$stage/bin/seed-memory"
  chmod +x "$stage/bin/seed-memory"
  if [ -n "$vec_file" ]; then
    cp "$vec_file" "$stage/lib/$ext_name"
  fi
  cp "$PKG_DIR/workload/launchd.plist.template" "$stage/templates/launchd.plist.template"

  # Compute checksums for manifest.
  bin_sha=$(shasum -a 256 "$stage/bin/seed-memory" | awk '{print $1}')
  if [ -n "$vec_file" ]; then
    vec_sha=$(shasum -a 256 "$stage/lib/$ext_name" | awk '{print $1}')
    vec_checksum_line=",\"lib/$ext_name\": \"sha256:$vec_sha\""
    sidecars_line="[{\"src\":\"lib/$ext_name\",\"dest_rel\":\"lib/$ext_name\"}]"
    vec_env_line=",\"SEED_VEC_PATH\":\"{{install_dir}}/lib/$ext_name\""
  else
    vec_checksum_line=""
    sidecars_line="[]"
    vec_env_line=""
  fi

  cat > "$stage/manifest.json" <<EOF
{
  "id": "memory",
  "version": "$VERSION",
  "description": "Seed memory service (ingest, query, knowledge graph)",
  "platform": "$platform",
  "arch": "$arch",
  "binary": "bin/seed-memory",
  "sidecars": $sidecars_line,
  "env": {
    "MEMORY_PORT": "19888",
    "MEMORY_DB": "{{home}}/.local/share/seed/memory.db",
    "SEED_EMBED_URL": "http://localhost:11434",
    "SEED_LLM_URL": "http://ren3.local:3000",
    "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"$vec_env_line
  },
  "required_env": [],
  "port": 19888,
  "probe": { "type": "http", "path": "/status" },
  "supervisor": {
    "launchd": {
      "label": "com.seed.memory",
      "template": "templates/launchd.plist.template",
      "log_path_rel": "Library/Logs/com.seed.memory.log"
    }
  },
  "checksums": {
    "bin/seed-memory": "sha256:$bin_sha"$vec_checksum_line
  }
}
EOF

  tarball="$ARTIFACTS_DIR/memory-$VERSION-$target.tar.gz"
  (cd "$stage" && tar -czf "$tarball" .)
  rm -rf "$stage"
  echo "  + $tarball"
done

echo ""
echo "==> Artifact checksums"
( cd "$ARTIFACTS_DIR" && shasum -a 256 memory-*.tar.gz )

echo ""
echo "==> Done."
