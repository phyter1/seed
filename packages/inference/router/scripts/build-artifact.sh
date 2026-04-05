#!/bin/bash
# Build a workload artifact bundle for @seed/router.
#
# Produces: dist/artifacts/fleet-router-<version>-<platform>-<arch>.tar.gz
#
# Each tarball contains:
#   manifest.json
#   bin/fleet-router              (compiled bun binary)
#   bin/start-mlx-server.py       (python sidecar spawned by router)
#   seed.config.json              (fleet topology; override with SEED_CONFIG)
#   templates/launchd.plist.template
#
# Bun --compile produces a self-contained executable (bun runtime
# embedded). All filesystem paths must be passed via env vars because
# `import.meta.dir` resolves to the virtual bunfs root inside compiled
# binaries — the manifest env pins MLX_STARTER_PATH and SEED_CONFIG
# to absolute install_dir paths.
#
# Usage:
#   bash scripts/build-artifact.sh [--version <ver>]
#   bash scripts/build-artifact.sh --targets "darwin-arm64"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../../.." && pwd)"
DIST_DIR="$PKG_DIR/dist"
ARTIFACTS_DIR="$DIST_DIR/artifacts"

VERSION=""
TARGETS="darwin-arm64"

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

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is not installed. Install from https://bun.sh" >&2
  exit 1
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
  bun_target="bun-$target"

  binary="$DIST_DIR/fleet-router-$target"
  echo "==> Compiling $binary"
  ( cd "$PKG_DIR" && bun build --compile --target="$bun_target" --outfile="$binary" src/router.ts )

  stage="$ARTIFACTS_DIR/stage-$target"
  rm -rf "$stage"
  mkdir -p "$stage/bin" "$stage/templates"

  cp "$binary" "$stage/bin/fleet-router"
  chmod +x "$stage/bin/fleet-router"
  cp "$PKG_DIR/src/start-mlx-server.py" "$stage/bin/start-mlx-server.py"
  cp "$PKG_DIR/workload/launchd.plist.template" "$stage/templates/launchd.plist.template"
  # Fallback copy of seed.config.json so a router install can still boot
  # before fleet-topology is installed on a given machine. The manifest
  # env points SEED_CONFIG at the fleet-topology-current symlink; when
  # that path doesn't exist yet, the router's loadRouterConfig() falls
  # through to the legacy in-install-dir path (see router/src/config.ts).
  cp "$SEED_CONFIG_SRC" "$stage/seed.config.json"

  bin_sha=$(shasum -a 256 "$stage/bin/fleet-router" | awk '{print $1}')
  starter_sha=$(shasum -a 256 "$stage/bin/start-mlx-server.py" | awk '{print $1}')
  config_sha=$(shasum -a 256 "$stage/seed.config.json" | awk '{print $1}')

  cat > "$stage/manifest.json" <<EOF
{
  "id": "fleet-router",
  "version": "$VERSION",
  "description": "Rule-based fleet router with MLX lifecycle and jury aggregation",
  "platform": "$platform",
  "arch": "$arch",
  "binary": "bin/fleet-router",
  "sidecars": [
    {"src":"bin/start-mlx-server.py","dest_rel":"bin/start-mlx-server.py"},
    {"src":"seed.config.json","dest_rel":"seed.config.json"}
  ],
  "env": {
    "ROUTER_PORT": "3000",
    "MLX_HOST": "localhost:8080",
    "MLX_MODEL": "mlx-community/Qwen3.5-9B-MLX-4bit",
    "MLX_PYTHON_PATH": "/opt/homebrew/bin/python3.11",
    "MLX_STARTER_PATH": "{{install_dir}}/bin/start-mlx-server.py",
    "SEED_CONFIG": "{{install_root}}/fleet-topology-current/seed.config.json",
    "SEED_CONFIG_FALLBACK": "{{install_dir}}/seed.config.json",
    "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  },
  "required_env": [],
  "port": 3000,
  "probe": { "type": "http", "path": "/health" },
  "supervisor": {
    "launchd": {
      "label": "com.seed.fleet-router",
      "template": "templates/launchd.plist.template",
      "log_path_rel": "Library/Logs/com.seed.fleet-router.log"
    }
  },
  "checksums": {
    "bin/fleet-router": "sha256:$bin_sha",
    "bin/start-mlx-server.py": "sha256:$starter_sha",
    "seed.config.json": "sha256:$config_sha"
  }
}
EOF

  tarball="$ARTIFACTS_DIR/fleet-router-$VERSION-$target.tar.gz"
  ( cd "$stage" && tar -czf "$tarball" . )
  rm -rf "$stage"
  echo "  + $tarball"
done

echo ""
echo "==> Artifact checksums"
( cd "$ARTIFACTS_DIR" && shasum -a 256 fleet-router-*.tar.gz )

echo ""
echo "==> Done."
