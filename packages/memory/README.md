# @seed/memory

Persistent memory service for Seed — ingest, query, and knowledge graph backed by SQLite + sqlite-vec.

## Building locally

```bash
cd packages/memory
bun install && bun test && bunx tsc --noEmit
```

## Building binaries

```bash
bash scripts/build-binaries.sh
# Produces: dist/seed-memory-{darwin-arm64,darwin-x64,linux-x64}
```

## Cross-platform sqlite-vec

`sqlite-vec` ships platform-specific native extensions (`.dylib` on macOS, `.so` on Linux). When you run `bun install`, only the extension for your host platform is installed — foreign platform packages are silently skipped. This means building on an ARM Mac will not have the `darwin-x64` or `linux-x64` extensions available, and `build-binaries.sh` will warn about missing extensions for those targets.

CI handles this automatically (see `.github/workflows/release.yml:47-67`). For **local cross-platform builds**, manually install the missing platform packages:

```bash
# From packages/memory/:
VEC_VERSION=$(node -p "require('./node_modules/sqlite-vec/package.json').version")
for platform in darwin-arm64 darwin-x64 linux-x64; do
  pkg="sqlite-vec-${platform}@${VEC_VERSION}"
  target_dir="node_modules/sqlite-vec-${platform}"
  if [ ! -d "$target_dir" ]; then
    npm pack "$pkg" --pack-destination /tmp/ --silent
    mkdir -p "$target_dir"
    tar -xzf "/tmp/sqlite-vec-${platform}-${VEC_VERSION}.tgz" -C "$target_dir" --strip-components=1
  fi
done
```

This uses `npm pack` to download each platform package as a tarball and extracts it into the expected `node_modules/` location. After this, `build-binaries.sh` will find and copy all three platform extensions into `dist/`.

## Runtime requirements

### System SQLite

Bun's embedded SQLite does not support extension loading. The memory service swaps it for a system SQLite via `Database.setCustomSQLite()` (see `src/db.ts`). Target machines need a system SQLite with extension support:

- **macOS (ARM):** `brew install sqlite` — installs to `/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`
- **macOS (Intel):** `brew install sqlite` — installs to `/usr/local/opt/sqlite/lib/libsqlite3.dylib`
- **Linux:** `libsqlite3-dev` (Debian/Ubuntu), `sqlite-devel` (RHEL/Fedora), or equivalent

Override the auto-detected path with the `SEED_SQLITE_PATH` env var if needed.

### sqlite-vec extension path

Bun-compiled binaries use a virtual filesystem that cannot load native `.dylib`/`.so` files. The `vec0` extension must live on disk next to the binary and be referenced via the `SEED_VEC_PATH` env var. The workload artifact's launchd plist template sets this automatically.

When running from source (not a compiled binary), `sqlite-vec` is loaded via its Node.js binding and no env var is needed.

## Building workload artifacts

```bash
bash scripts/build-artifact.sh
# Produces: dist/artifacts/memory-<version>-<target>.tar.gz
```

Each tarball contains a self-contained deployment bundle:

```
manifest.json
bin/seed-memory
lib/vec0.{dylib,so}
templates/launchd.plist.template
```

Run `build-binaries.sh` first — `build-artifact.sh` expects `dist/seed-memory-*` and `dist/sqlite-vec-*/` to already be populated.
