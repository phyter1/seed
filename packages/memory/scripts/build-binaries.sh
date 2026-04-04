#!/bin/bash
# Seed — Build standalone binaries for the memory service.
#
# Produces 3 binaries (one per supported target) in dist/, along with
# SHA-256 checksums. Binaries are self-contained (Bun runtime embedded)
# and require no external dependencies on the target machine.
#
# Note: sqlite-vec loads as a SQLite extension from a native .dylib/.so
# shipped via the `sqlite-vec-*` npm platform packages. The memory service
# relies on a system sqlite with extension support (brew install sqlite on
# macOS, libsqlite3 on linux). Bun's embedded sqlite does not support
# extensions.
#
# Usage:
#   bash scripts/build-binaries.sh
#
# Output:
#   dist/seed-memory-darwin-arm64
#   dist/seed-memory-darwin-x64
#   dist/seed-memory-linux-x64
#   dist/checksums.txt

set -euo pipefail

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

BUILDS=(
  "src/main.ts:seed-memory"
)

TARGETS=(
  "bun-darwin-arm64:darwin-arm64"
  "bun-darwin-x64:darwin-x64"
  "bun-linux-x64:linux-x64"
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
( cd "$DIST_DIR" && du -h seed-* | sort -k2 )

echo ""
echo "==> Computing SHA-256 checksums"
(
  cd "$DIST_DIR"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 seed-* > checksums.txt
  else
    sha256sum seed-* > checksums.txt
  fi
)
cat "$DIST_DIR/checksums.txt"

# Copy launchd template alongside the binaries
cp "$PKG_DIR/com.seed.memory.plist.template" "$DIST_DIR/"

# Copy sqlite-vec native extensions. Bun-compiled binaries cannot load
# .dylib/.so files from the virtual bunfs, so they must live on disk
# next to the binary and be pointed at via SEED_VEC_PATH.
echo ""
echo "==> Copying sqlite-vec native extensions"
for pkg in sqlite-vec-darwin-arm64 sqlite-vec-darwin-x64 sqlite-vec-linux-x64; do
  src_dir="$PKG_DIR/node_modules/$pkg"
  if [ -d "$src_dir" ]; then
    mkdir -p "$DIST_DIR/$pkg"
    # vec0.{dylib,so} — copy everything useful so installers can pick the right one
    find "$src_dir" -maxdepth 1 -name "vec0.*" -exec cp {} "$DIST_DIR/$pkg/" \;
    echo "    - $pkg/$(ls "$DIST_DIR/$pkg")"
  else
    echo "    - $pkg: not installed (run bun install first)"
  fi
done

echo ""
echo "==> Done. Artifacts in $DIST_DIR"
