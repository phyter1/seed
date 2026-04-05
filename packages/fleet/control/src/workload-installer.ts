/**
 * Workload installer — fetches an artifact bundle, verifies it,
 * extracts to disk, renders the supervisor template, and hands off
 * to a SupervisorDriver for bootstrap.
 *
 * Phase 1 scope: file:// URLs, launchd only, happy path. No caching,
 * no resume, no rollback.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  WorkloadManifest,
  WorkloadDeclaration,
  WorkloadInstallRecord,
} from "./types";
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
}

export interface InstallResult {
  manifest: WorkloadManifest;
  record: WorkloadInstallRecord;
  plistPath: string;
}

/**
 * Fetch an artifact tarball from a URL. Phase 1 only supports
 * `file://` URLs — HTTPS is Phase 2.
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

function homeDir(): string {
  const h = process.env.HOME;
  if (!h) throw new Error("HOME not set");
  return h;
}

function defaultInstallRoot(): string {
  return join(homeDir(), ".local/share/seed/workloads");
}

function defaultPlistDir(): string {
  return join(homeDir(), "Library/LaunchAgents");
}

function defaultLogDir(): string {
  return join(homeDir(), "Library/Logs");
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

  // 6. Ensure binary is executable.
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
  const supervisor = manifest.supervisor.launchd;
  if (!supervisor) {
    throw new Error("manifest missing supervisor.launchd — Phase 1 is macOS-only");
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
  const plistPath = join(plistDir, `${supervisor.label}.plist`);
  const tmpPlist = `${plistPath}.tmp`;
  writeFileSync(tmpPlist, renderedPlist, { mode: 0o644 });
  const { renameSync } = await import("node:fs");
  renameSync(tmpPlist, plistPath);

  // 9. Unload first to make this idempotent for same-version reloads,
  //    then bootstrap.
  await opts.driver.unload(supervisor.label);
  await opts.driver.load(supervisor.label, plistPath);

  const record: WorkloadInstallRecord = {
    workload_id: manifest.id,
    version: manifest.version,
    install_dir: installDir,
    supervisor_label: supervisor.label,
    installed_at: new Date().toISOString(),
    state: "loaded",
    failure_reason: null,
    last_probe_at: null,
    last_probe_tier: null,
  };

  return { manifest, record, plistPath };
}
