/**
 * Workload installer — fetches an artifact bundle, verifies it,
 * extracts to disk, renders the supervisor template, and hands off
 * to a SupervisorDriver for bootstrap.
 *
 * Phase 1 scope: file:// URLs, launchd only, happy path. No caching,
 * no resume, no rollback.
 */

import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  WorkloadManifest,
  WorkloadDeclaration,
  WorkloadInstallRecord,
} from "./types";
import { isStaticWorkload } from "./types";
import type { SupervisorDriver } from "./supervisors/launchd";
import { renderTemplate, resolveEnv, renderPlistEnvDict } from "./templates";

export interface InstallerOptions {
  driver: SupervisorDriver;
  /** Root directory for workload installs. Each workload lives in a
   *  version-scoped subdirectory. Defaults to
   *  `~/.local/share/seed/workloads`. */
  installRoot?: string;
  /** Directory where launchd plists are written so user launchd picks
   *  them up on bootstrap. Defaults to `~/Library/LaunchAgents`. */
  plistDir?: string;
  /** Directory for workload stdout/stderr logs.
   *  Defaults to `~/Library/Logs`. */
  logDir?: string;
  /** Number of prior install dirs (non-current) to retain after a
   *  successful install, for rollback headroom. Defaults to 1.
   *  Use 0 for aggressive GC, -1 to disable pruning entirely. */
  keepPrior?: number;
  /** Root directory where pre-staged artifact tarballs live. Defaults
   *  to `~/.local/share/seed/workload-artifacts`. Used for automatic
   *  tarball cleanup after a successful install. */
  artifactRoot?: string;
}

export interface InstallResult {
  manifest: WorkloadManifest;
  record: WorkloadInstallRecord;
  plistPath: string;
}

/**
 * Fetch an artifact tarball from a URL. Supports `file://`, `http://`,
 * and `https://` schemes.
 */
export async function fetchArtifact(url: string): Promise<Uint8Array> {
  if (url.startsWith("file://")) {
    const path = url.slice("file://".length);
    const buf = readFileSync(path);
    return new Uint8Array(buf);
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`artifact fetch ${url} failed: ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error(`unsupported artifact URL scheme: ${url}`);
}

/** Compute sha256 hex of a byte array. */
export function sha256Hex(bytes: Uint8Array): string {
  const h = createHash("sha256");
  h.update(bytes);
  return h.digest("hex");
}

/**
 * Extract a .tar.gz (or .tgz) archive into `destDir`. Uses the system
 * `tar` — no pure-JS dependency. destDir is created if missing.
 */
export async function extractTarball(
  tarballPath: string,
  destDir: string
): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  const proc = Bun.spawn(["tar", "-xzf", tarballPath, "-C", destDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`tar extract failed: ${stderr.trim()}`);
  }
}

/**
 * Verify every `manifest.checksums` entry against the files on disk
 * under `installDir`. Throws on mismatch, missing file, or empty
 * digest. If the manifest has no checksums, this is a no-op.
 */
export function verifyInstalledChecksums(
  manifest: WorkloadManifest,
  installDir: string
): void {
  if (!manifest.checksums) return;
  for (const [relPath, expected] of Object.entries(manifest.checksums)) {
    const filePath = join(installDir, relPath);
    if (!existsSync(filePath)) {
      throw new Error(`checksum target missing: ${relPath}`);
    }
    const actual = sha256Hex(new Uint8Array(readFileSync(filePath)));
    const want = expected.replace(/^sha256:/, "").toLowerCase();
    if (actual !== want) {
      throw new Error(
        `checksum mismatch for ${relPath}: expected ${want}, got ${actual}`
      );
    }
  }
}

/**
 * Compare two semver strings numerically. Returns negative if a<b,
 * positive if a>b, zero if equal. Unknown suffix characters after
 * the major.minor.patch triple are compared lexically.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (s: string): number[] => {
    const core = s.split(/[-+]/)[0];
    return core.split(".").map((p) => Number(p) || 0);
  };
  const ap = parse(a);
  const bp = parse(b);
  const len = Math.max(ap.length, bp.length, 3);
  for (let i = 0; i < len; i++) {
    const diff = (ap[i] ?? 0) - (bp[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Remove install dirs under `installRoot` matching the pattern
 * `${workloadId}-*`, retaining the current version plus `keepPrior`
 * most-recent non-current versions. Returns the list of removed dir
 * names.
 *
 * Safe to call even when no prior installs exist. Passing keepPrior=-1
 * disables pruning entirely. A non-existent installRoot is a no-op.
 */
export function pruneOldInstalls(
  installRoot: string,
  workloadId: string,
  currentVersion: string,
  keepPrior: number
): string[] {
  if (keepPrior < 0) return [];
  if (!existsSync(installRoot)) return [];
  const entries = readdirSync(installRoot, { withFileTypes: true });
  const prefix = `${workloadId}-`;
  const currentName = `${workloadId}-${currentVersion}`;

  const prior = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => name.startsWith(prefix) && name !== currentName)
    .sort((a, b) => {
      const va = a.slice(prefix.length);
      const vb = b.slice(prefix.length);
      // Descending: most-recent first.
      return compareSemver(vb, va);
    });

  const toRemove = prior.slice(keepPrior);
  for (const name of toRemove) {
    rmSync(join(installRoot, name), { recursive: true, force: true });
  }
  return toRemove;
}

/**
 * Recursively compute the total byte size of a file or directory tree.
 * Follows no symlinks, tolerates missing paths (returns 0), and does
 * not descend into paths it cannot stat.
 */
export function pathSize(p: string): number {
  if (!existsSync(p)) return 0;
  let total = 0;
  const stack = [p];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let st;
    try {
      st = statSync(cur);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      let entries: string[];
      try {
        entries = readdirSync(cur);
      } catch {
        continue;
      }
      for (const e of entries) stack.push(join(cur, e));
    } else if (st.isFile()) {
      total += st.size;
    }
  }
  return total;
}

/**
 * Extract the semver version from a workload artifact tarball filename.
 * Expected shape: `${workloadId}-${version}-${platform}-${arch}.tar.gz`.
 * Returns null if the name doesn't match that shape.
 */
export function parseArtifactVersion(
  name: string,
  workloadId: string
): string | null {
  const prefix = `${workloadId}-`;
  if (!name.startsWith(prefix) || !name.endsWith(".tar.gz")) return null;
  const middle = name.slice(prefix.length, -".tar.gz".length);
  // Match leading semver (e.g. "0.4.9" or "0.4.9-rc1") followed by -<platform>-<arch>
  const m = middle.match(/^(\d+\.\d+\.\d+(?:[-+][\w.]+)?)-[\w.]+-[\w.]+$/);
  return m ? m[1] : null;
}

/**
 * Prune stale pre-staged artifact tarballs from `artifactRoot`, keeping
 * only those whose version is in `retainVersions`. Returns the list of
 * removed filenames. Non-existent `artifactRoot` is a no-op.
 *
 * Matches files shaped like `${workloadId}-${semver}-${platform}-${arch}.tar.gz`.
 * Files that don't match this shape are ignored — they belong to
 * something else.
 */
export function pruneArtifactTarballs(
  artifactRoot: string,
  workloadId: string,
  retainVersions: Set<string>,
  dryRun: boolean
): { removed: string[]; bytesFreed: number } {
  if (!existsSync(artifactRoot)) return { removed: [], bytesFreed: 0 };
  const removed: string[] = [];
  let bytesFreed = 0;
  for (const entry of readdirSync(artifactRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const version = parseArtifactVersion(entry.name, workloadId);
    if (version === null) continue;
    if (retainVersions.has(version)) continue;
    const full = join(artifactRoot, entry.name);
    bytesFreed += pathSize(full);
    if (!dryRun) rmSync(full, { force: true });
    removed.push(entry.name);
  }
  return { removed, bytesFreed };
}

/**
 * Sweep pre-v0.4 bootstrap debris from `/tmp` (or `tmpRoot`): tarballs
 * shaped like `${workloadId}-${semver}-*.tar.gz` and seed-owned sqlite
 * files shaped like `seed-${workloadId}-*.db` / `seed-${workloadId}-*.db-shm`
 * / `seed-${workloadId}-*.db-wal`.
 *
 * Conservative — only matches files whose name starts with an expected
 * prefix AND encodes a semver, so normal user files aren't caught.
 * Opt-in via the GC caller (includeTmp flag).
 */
export function sweepTmpOrphans(
  tmpRoot: string,
  workloadId: string,
  dryRun: boolean
): { removed: string[]; bytesFreed: number } {
  if (!existsSync(tmpRoot)) return { removed: [], bytesFreed: 0 };
  const removed: string[] = [];
  let bytesFreed = 0;
  const tarPrefix = `${workloadId}-`;
  const dbPrefix = `seed-${workloadId}-`;
  const tarRegex = /^\d+\.\d+\.\d+(?:[-+][\w.]+)?-[\w.]+-[\w.]+\.tar\.gz$/;
  const dbRegex = /^[\w.-]+\.db(-shm|-wal)?$/;
  for (const entry of readdirSync(tmpRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    let matches = false;
    if (entry.name.startsWith(tarPrefix)) {
      matches = tarRegex.test(entry.name.slice(tarPrefix.length));
    } else if (entry.name.startsWith(dbPrefix)) {
      matches = dbRegex.test(entry.name.slice(dbPrefix.length));
    }
    if (!matches) continue;
    const full = join(tmpRoot, entry.name);
    bytesFreed += pathSize(full);
    if (!dryRun) rmSync(full, { force: true });
    removed.push(entry.name);
  }
  return { removed, bytesFreed };
}

export interface GcWorkloadReport {
  workloadId: string;
  currentVersion: string | null;
  installDirs: { removed: string[]; bytesFreed: number };
  artifacts: { removed: string[]; bytesFreed: number };
  tmpOrphans: { removed: string[]; bytesFreed: number };
  bytesFreed: number;
}

export interface GcOptions {
  /** Root directory for workload installs. Defaults to
   *  `~/.local/share/seed/workloads`. */
  installRoot?: string;
  /** Root directory where pre-staged artifact tarballs live. Defaults
   *  to `~/.local/share/seed/workload-artifacts`. */
  artifactRoot?: string;
  /** Directory to sweep for /tmp orphans. Defaults to `/tmp`. Only
   *  swept when `includeTmp=true`. */
  tmpRoot?: string;
  /** Number of non-current install-dir versions to retain. Mirrors
   *  InstallerOptions.keepPrior. Defaults to 1. */
  keepPrior?: number;
  /** If true, also sweep pre-v0.4 bootstrap debris from tmpRoot. */
  includeTmp?: boolean;
  /** If true, compute the report but remove nothing. */
  dryRun?: boolean;
}

/**
 * Garbage-collect on-disk workload state for a single workload:
 *
 *  1. Prune install-dirs under installRoot, keeping current + keepPrior.
 *  2. Prune pre-staged artifact tarballs that don't match a retained
 *     install-dir version.
 *  3. (Opt-in) Sweep pre-v0.4 bootstrap debris from tmpRoot.
 *
 * `currentVersion` is the installed version per the caller's workload
 * DB. If null, every install-dir for this workload is treated as
 * stale (the workload is not installed here). dryRun reports what
 * would be removed without touching disk.
 */
export function gcWorkload(
  workloadId: string,
  currentVersion: string | null,
  opts: GcOptions = {}
): GcWorkloadReport {
  const installRoot = opts.installRoot ?? defaultInstallRoot();
  const artifactRoot = opts.artifactRoot ?? defaultArtifactRoot();
  const tmpRoot = opts.tmpRoot ?? "/tmp";
  const keepPrior = opts.keepPrior ?? 1;
  const dryRun = opts.dryRun ?? false;

  // Determine which install-dir versions we plan to retain BEFORE
  // pruning, so we can mirror the retention policy on artifact tarballs.
  const installDirVersions = listInstalledVersions(installRoot, workloadId);
  const retainedVersions = computeRetainedVersions(
    installDirVersions,
    currentVersion,
    keepPrior
  );

  // --- 1. install dirs ---
  let installDirsRemoved: string[] = [];
  let installDirsBytes = 0;
  for (const version of installDirVersions) {
    if (retainedVersions.has(version)) continue;
    const name = `${workloadId}-${version}`;
    const full = join(installRoot, name);
    installDirsBytes += pathSize(full);
    if (!dryRun) rmSync(full, { recursive: true, force: true });
    installDirsRemoved.push(name);
  }

  // --- 2. artifact tarballs ---
  const artifacts = pruneArtifactTarballs(
    artifactRoot,
    workloadId,
    retainedVersions,
    dryRun
  );

  // --- 3. /tmp orphans (opt-in) ---
  const tmpOrphans = opts.includeTmp
    ? sweepTmpOrphans(tmpRoot, workloadId, dryRun)
    : { removed: [], bytesFreed: 0 };

  return {
    workloadId,
    currentVersion,
    installDirs: { removed: installDirsRemoved, bytesFreed: installDirsBytes },
    artifacts,
    tmpOrphans,
    bytesFreed:
      installDirsBytes + artifacts.bytesFreed + tmpOrphans.bytesFreed,
  };
}

/**
 * List all installed versions of a workload under `installRoot`, by
 * enumerating directory names matching `${workloadId}-*`. Returns
 * bare version strings (no workloadId prefix), unsorted.
 */
function listInstalledVersions(
  installRoot: string,
  workloadId: string
): string[] {
  if (!existsSync(installRoot)) return [];
  const prefix = `${workloadId}-`;
  const versions: string[] = [];
  for (const entry of readdirSync(installRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(prefix)) continue;
    versions.push(entry.name.slice(prefix.length));
  }
  return versions;
}

/**
 * Determine which install-dir versions to retain: the current version
 * (if it is present on disk) plus the `keepPrior` most-recent non-current
 * versions by semver. When currentVersion is null, retain only the
 * `keepPrior` most-recent versions on disk.
 */
function computeRetainedVersions(
  available: string[],
  currentVersion: string | null,
  keepPrior: number
): Set<string> {
  const retain = new Set<string>();
  if (keepPrior < 0) {
    // Disabling retention means: retain everything (nothing gets pruned).
    for (const v of available) retain.add(v);
    if (currentVersion) retain.add(currentVersion);
    return retain;
  }
  if (currentVersion && available.includes(currentVersion)) {
    retain.add(currentVersion);
  }
  const priors = available
    .filter((v) => v !== currentVersion)
    .sort((a, b) => compareSemver(b, a));
  for (const v of priors.slice(0, keepPrior)) retain.add(v);
  return retain;
}

/**
 * Maintain the `${workloadId}-current` symlink pointing at the
 * install dir for `currentVersion`. Atomic: writes to `.tmp` and
 * renames over any existing symlink. A non-existent installRoot is
 * a no-op. Safe to call repeatedly.
 *
 * Consumers (routers, other workloads, operators) can read through
 * `${installRoot}/${workloadId}-current/...` for a path that follows
 * the latest install without encoding the version.
 */
export function updateCurrentSymlink(
  installRoot: string,
  workloadId: string,
  currentVersion: string
): void {
  if (!existsSync(installRoot)) return;
  const linkPath = join(installRoot, `${workloadId}-current`);
  const target = `${workloadId}-${currentVersion}`; // relative target
  const { symlinkSync, renameSync, lstatSync } = require("node:fs") as typeof import("node:fs");
  const tmpLink = `${linkPath}.tmp`;
  // Clean up any stale tmp link.
  try {
    lstatSync(tmpLink);
    rmSync(tmpLink, { force: true });
  } catch {
    // not present, continue
  }
  symlinkSync(target, tmpLink);
  renameSync(tmpLink, linkPath);
}

function homeDir(): string {
  const h = process.env.HOME;
  if (!h) throw new Error("HOME not set");
  return h;
}

function defaultInstallRoot(): string {
  return join(homeDir(), ".local/share/seed/workloads");
}

function defaultArtifactRoot(): string {
  return join(homeDir(), ".local/share/seed/workload-artifacts");
}

function defaultPlistDir(): string {
  return join(homeDir(), "Library/LaunchAgents");
}

function defaultLogDir(): string {
  return join(homeDir(), "Library/Logs");
}

/**
 * Check if a port is declared in any workload's env. Scans for keys
 * matching PORT or *_PORT (case-insensitive).
 */
export function isPortDeclared(
  workloads: WorkloadDeclaration[],
  port: number
): boolean {
  for (const decl of workloads) {
    if (!decl.env) continue;
    for (const [key, val] of Object.entries(decl.env)) {
      const k = key.toUpperCase();
      if (k === "PORT" || k.endsWith("_PORT")) {
        if (String(val) === String(port)) return true;
      }
    }
  }
  return false;
}

export interface FencePortOptions {
  /** Poll interval in milliseconds. Defaults to 500. */
  pollMs?: number;
  /** Maximum time to wait for port to clear in milliseconds. Defaults to 5000. */
  timeoutMs?: number;
}

/**
 * Ensure a TCP port is free before a supervisor swap. If a detached
 * child (not owned by the launchd label) holds the port, `lsof` finds
 * it, `kill` removes it, and we poll until the port is clear or a
 * timeout fires.
 */
export async function fencePort(
  port: number,
  workloadId: string,
  opts?: FencePortOptions
): Promise<void> {
  const pollMs = opts?.pollMs ?? 500;
  const timeoutMs = opts?.timeoutMs ?? 5000;

  /** Run a command and return trimmed stdout. */
  async function run(cmd: string[]): Promise<{ stdout: string; exitCode: number }> {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    return { stdout: stdout.trim(), exitCode };
  }

  /** Get PIDs holding the port via lsof. */
  async function getPids(): Promise<string[]> {
    const { stdout, exitCode } = await run(["lsof", "-ti", `:${port}`]);
    if (exitCode !== 0 || stdout === "") return [];
    return stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  const pids = await getPids();

  if (pids.length === 0) {
    console.log(`[installer] port-fence: port ${port} clear for ${workloadId}`);
    return;
  }

  // Kill each PID holding the port.
  for (const pid of pids) {
    await run(["kill", pid]);
    console.log(
      `[installer] port-fence: killed PID ${pid} holding port ${port} for ${workloadId}`
    );
  }

  // Poll until port is free or timeout.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const remaining = await getPids();
    if (remaining.length === 0) {
      console.log(`[installer] port-fence: port ${port} clear for ${workloadId}`);
      return;
    }
  }

  // Final check after timeout.
  const still = await getPids();
  if (still.length > 0) {
    throw new Error(
      `port ${port} still held by PID(s) ${still.join(", ")} after fence timeout — manual cleanup required`
    );
  }
}

/**
 * Fully install a workload: fetch → extract → verify → render template
 * → write plist → bootstrap. Returns the install record.
 *
 * This is the "happy path" installer — if any step fails, the caller
 * is responsible for cleanup (or tolerating a partial install).
 */
export async function installWorkload(
  declaration: WorkloadDeclaration,
  opts: InstallerOptions
): Promise<InstallResult> {
  const installRoot = opts.installRoot ?? defaultInstallRoot();
  const plistDir = opts.plistDir ?? defaultPlistDir();
  const logDir = opts.logDir ?? defaultLogDir();

  // 1. Fetch the tarball to a temp file.
  const bytes = await fetchArtifact(declaration.artifact_url);
  mkdirSync(installRoot, { recursive: true });
  const tarballPath = join(
    installRoot,
    `.${declaration.id}-${declaration.version}.tar.gz.tmp`
  );
  writeFileSync(tarballPath, bytes);

  // 2. Extract into a version-scoped install dir.
  const installDir = resolve(
    installRoot,
    `${declaration.id}-${declaration.version}`
  );
  if (existsSync(installDir)) rmSync(installDir, { recursive: true, force: true });
  await extractTarball(tarballPath, installDir);
  rmSync(tarballPath, { force: true });

  // 3. Read the manifest.
  const manifestPath = join(installDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${installDir}`);
  }
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf-8")
  ) as WorkloadManifest;

  // 4. Manifest sanity: version + id must match declaration.
  if (manifest.id !== declaration.id) {
    throw new Error(
      `manifest id mismatch: ${manifest.id} !== ${declaration.id}`
    );
  }
  if (manifest.version !== declaration.version) {
    throw new Error(
      `manifest version mismatch: ${manifest.version} !== ${declaration.version}`
    );
  }

  // 5. Verify checksums of extracted files.
  verifyInstalledChecksums(manifest, installDir);

  // Static workloads branch here: no binary, no supervisor, no plist.
  // The install phase itself IS the workload — files are extracted to
  // installDir and the `${id}-current` symlink is moved to point at
  // it, and that's the whole lifecycle. Consumers read through the
  // stable symlink path.
  let plistPath = "";
  let supervisorLabel = "";
  let state: WorkloadInstallRecord["state"] = "loaded";

  if (isStaticWorkload(manifest)) {
    state = "installed";
    // Static workloads may still include sidecar chmod hints (e.g. for
    // scripts), but there is no main binary to chmod.
    if (manifest.sidecars) {
      const { chmodSync } = await import("node:fs");
      for (const s of manifest.sidecars) {
        const sp = join(installDir, s.dest_rel);
        if (existsSync(sp)) chmodSync(sp, 0o755);
      }
    }
  } else {
    // 6. Ensure binary is executable.
    if (!manifest.binary) {
      throw new Error(
        `manifest missing binary (required for kind="service")`
      );
    }
    const binaryPath = join(installDir, manifest.binary);
    if (!existsSync(binaryPath)) {
      throw new Error(`binary ${manifest.binary} not found in install dir`);
    }
    const { chmodSync } = await import("node:fs");
    chmodSync(binaryPath, 0o755);
    if (manifest.sidecars) {
      for (const s of manifest.sidecars) {
        const sp = join(installDir, s.dest_rel);
        if (existsSync(sp)) chmodSync(sp, 0o755);
      }
    }

    // 7. Render the launchd template.
    const supervisor = manifest.supervisor?.launchd;
    if (!supervisor) {
      throw new Error(
        "manifest missing supervisor.launchd — Phase 1 is macOS-only"
      );
    }
    const templatePath = join(installDir, supervisor.template);
    if (!existsSync(templatePath)) {
      throw new Error(`supervisor template not found: ${supervisor.template}`);
    }
    const template = readFileSync(templatePath, "utf-8");

    const logPath = join(logDir, `${supervisor.label}.log`);
    const tokens: Record<string, string> = {
      BINARY: binaryPath,
      INSTALL_DIR: installDir,
      INSTALL_ROOT: installRoot,
      HOME: homeDir(),
      LABEL: supervisor.label,
      LOG_PATH: logPath,
    };

    // Resolve env (manifest defaults ← declaration overrides, then expand
    // {{install_dir}}-style placeholders against our token map).
    const env = resolveEnv(manifest.env, declaration.env, tokens);
    tokens.ENV = renderPlistEnvDict(env);

    const renderedPlist = renderTemplate(template, tokens);

    // 8. Write the plist atomically.
    mkdirSync(plistDir, { recursive: true });
    mkdirSync(dirname(logPath), { recursive: true });
    plistPath = join(plistDir, `${supervisor.label}.plist`);
    const tmpPlist = `${plistPath}.tmp`;
    writeFileSync(tmpPlist, renderedPlist, { mode: 0o644 });
    const { renameSync } = await import("node:fs");
    renameSync(tmpPlist, plistPath);

    // 8.5. Port-fence: if the workload declares a port via env, ensure
    //      it's free before swapping supervisors. Detached children from
    //      the old process may hold the port after bootout.
    const portKey = Object.keys(env).find(
      (k) => k.toUpperCase() === "PORT" || k.toUpperCase().endsWith("_PORT")
    );
    if (portKey) {
      const portVal = Number(env[portKey]);
      if (!Number.isNaN(portVal) && portVal > 0) {
        await fencePort(portVal, declaration.id);
      }
    }

    // 9. Unload first to make this idempotent for same-version reloads,
    //    then bootstrap.
    await opts.driver.unload(supervisor.label);
    await opts.driver.load(supervisor.label, plistPath);

    supervisorLabel = supervisor.label;
  }

  // Move the `${id}-current` symlink to point at this install. Both
  // static and service workloads maintain this so consumers on the
  // same machine can read through a stable path that does not encode
  // the version (routers referring to a shared config, operators
  // inspecting latest install, etc.).
  updateCurrentSymlink(installRoot, manifest.id, manifest.version);

  const record: WorkloadInstallRecord = {
    workload_id: manifest.id,
    version: manifest.version,
    install_dir: installDir,
    supervisor_label: supervisorLabel,
    installed_at: new Date().toISOString(),
    state,
    failure_reason: null,
    last_probe_at: null,
    last_probe_tier: null,
  };

  // 10. Prune older install dirs for this workload. Default keepPrior=1
  //     leaves one rollback target. Runs only on the happy path so a
  //     failed install never destroys working prior state.
  const keepPrior = opts.keepPrior ?? 1;
  const pruned = pruneOldInstalls(
    installRoot,
    manifest.id,
    manifest.version,
    keepPrior
  );
  if (pruned.length > 0) {
    console.log(
      `[installer] pruned ${pruned.length} prior install dir(s): ${pruned.join(", ")}`
    );
  }

  // 11. Prune stale artifact tarballs. Build the retained versions set
  //     from install dirs still on disk (current + whatever keepPrior
  //     preserved above). Wrapped in try/catch — tarball cleanup is
  //     best-effort; a failure here must never fail the install itself.
  try {
    const artifactRoot = opts.artifactRoot ?? defaultArtifactRoot();
    const retainedVersions = new Set<string>();
    retainedVersions.add(manifest.version);
    if (existsSync(installRoot)) {
      const prefix = `${manifest.id}-`;
      for (const entry of readdirSync(installRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith(prefix)) continue;
        retainedVersions.add(entry.name.slice(prefix.length));
      }
    }
    const tarballResult = pruneArtifactTarballs(
      artifactRoot,
      manifest.id,
      retainedVersions,
      false
    );
    if (tarballResult.removed.length > 0) {
      console.log(
        `[installer] pruned ${tarballResult.removed.length} stale artifact tarball(s): ${tarballResult.removed.join(", ")}`
      );
    }
  } catch (err) {
    console.warn(
      `[installer] artifact tarball cleanup failed (non-fatal): ${err instanceof Error ? err.message : err}`
    );
  }

  return { manifest, record, plistPath };
}
