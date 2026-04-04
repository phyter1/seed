/**
 * Self-update machinery shared between `seed-agent`, `seed-cli`, and
 * `seed-control-plane` binaries.
 *
 * Flow:
 *   1. Detect the current target triple (darwin-arm64 / darwin-x64 / linux-x64)
 *   2. Resolve the desired release (latest, or a specific `vX.Y.Z` tag)
 *   3. Skip if already at target version (unless `force`)
 *   4. Download the replacement binary to a temp file next to the destination
 *   5. Verify SHA-256 against the published `checksums.txt`
 *   6. `chmod +x` and atomically rename over the destination
 *
 * Atomic rename is what lets us overwrite a running binary: the old inode
 * stays alive for the running process while new invocations pick up the
 * new file. On both macOS and Linux this is safe.
 *
 * No dependencies beyond Bun + node:fs — this module is imported by the
 * compiled binaries so it must stay standalone.
 */

import { SEED_REPO } from "./version";

export type TargetTriple = "darwin-arm64" | "darwin-x64" | "linux-x64";
export type BinaryName = "seed-agent" | "seed-cli" | "seed-control-plane";

const BINARY_NAMES: readonly BinaryName[] = [
  "seed-agent",
  "seed-cli",
  "seed-control-plane",
];

/** Detect the target triple for the current process. */
export function detectTargetTriple(): TargetTriple {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  throw new Error(
    `unsupported platform for self-update: ${platform}/${arch}`
  );
}

export interface ReleaseInfo {
  tag: string; // "v0.2.1"
  version: string; // "0.2.1" (tag without leading "v")
}

/** Fetch release metadata from the GitHub API. */
export async function fetchRelease(
  tag: string | "latest",
  repo: string = SEED_REPO
): Promise<ReleaseInfo> {
  const path = tag === "latest" ? "releases/latest" : `releases/tags/${tag}`;
  const url = `https://api.github.com/repos/${repo}/${path}`;
  const headers: Record<string, string> = {
    "User-Agent": "seed-self-update",
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(
      `GitHub API ${res.status}: ${await res.text()} (${url})`
    );
  }
  const body = (await res.json()) as { tag_name?: string };
  const resolvedTag = body.tag_name;
  if (!resolvedTag) throw new Error(`release metadata missing tag_name`);
  return {
    tag: resolvedTag,
    version: resolvedTag.replace(/^v/, ""),
  };
}

/**
 * Parse a `checksums.txt` file into { filename -> sha256 hex } map.
 *
 * Format is the output of `shasum -a 256`:
 *   <hex>  <filename>
 */
export function parseChecksums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // shasum uses 2 spaces; sha256sum uses 2 spaces or "  " / " *".
    const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (!match) continue;
    map.set(match[2], match[1].toLowerCase());
  }
  return map;
}

/** Download a URL to a file path. Throws on non-200. */
async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url, {
    headers: { "User-Agent": "seed-self-update" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`download failed ${res.status}: ${url}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  await Bun.write(dest, buf);
}

async function sha256Hex(path: string): Promise<string> {
  const file = Bun.file(path);
  const buf = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface SelfUpdateOptions {
  /** Binary to replace. Defaults to the name of the current executable. */
  binary?: BinaryName;
  /** Target version tag (e.g. "v0.3.0") or "latest". */
  version?: string;
  /** Current version string for the skip-if-same check. */
  currentVersion: string;
  /** If true, update even if the version already matches. */
  force?: boolean;
  /** Override the destination path (for testing). */
  destPath?: string;
  /** Override the GitHub repo (for testing). */
  repo?: string;
  /** Logger for progress. */
  log?: (msg: string) => void;
}

export interface SelfUpdateResult {
  updated: boolean;
  fromVersion: string;
  toVersion: string;
  destPath: string;
  reason?: string;
}

/** Detect the binary name from the current executable path. */
export function detectBinaryName(execPath: string): BinaryName | null {
  const base = execPath.split("/").pop() ?? "";
  for (const name of BINARY_NAMES) {
    if (base === name) return name;
  }
  return null;
}

/**
 * Run a self-update. Returns a result describing what happened.
 *
 * The caller is responsible for exiting the process after this resolves —
 * we don't call `process.exit` here so tests can observe the result.
 */
export async function runSelfUpdate(
  opts: SelfUpdateOptions
): Promise<SelfUpdateResult> {
  const fs = require("fs");
  const log = opts.log ?? ((m: string) => console.log(m));
  const repo = opts.repo ?? SEED_REPO;
  const binary = opts.binary ?? detectBinaryName(process.execPath);
  if (!binary) {
    throw new Error(
      `cannot determine which binary to update (execPath=${process.execPath})`
    );
  }
  const destPath = opts.destPath ?? process.execPath;
  const triple = detectTargetTriple();

  // Resolve the target release.
  const release = await fetchRelease(opts.version ?? "latest", repo);
  log(
    `[self-update] target ${binary} ${release.tag} (${triple}), current ${opts.currentVersion}`
  );

  if (release.version === opts.currentVersion && !opts.force) {
    log(`[self-update] already at ${release.tag}, nothing to do`);
    return {
      updated: false,
      fromVersion: opts.currentVersion,
      toVersion: release.version,
      destPath,
      reason: "already at target version",
    };
  }

  const assetName = `${binary}-${triple}`;
  const baseUrl = `https://github.com/${repo}/releases/download/${release.tag}`;
  const binaryUrl = `${baseUrl}/${assetName}`;
  const checksumsUrl = `${baseUrl}/checksums.txt`;

  // Download checksums first — cheap, and lets us fail early if the
  // asset we want isn't listed.
  log(`[self-update] fetching ${checksumsUrl}`);
  const checksumsRes = await fetch(checksumsUrl, {
    headers: { "User-Agent": "seed-self-update" },
    redirect: "follow",
  });
  if (!checksumsRes.ok) {
    throw new Error(
      `checksums download failed ${checksumsRes.status}: ${checksumsUrl}`
    );
  }
  const checksums = parseChecksums(await checksumsRes.text());
  const expected = checksums.get(assetName);
  if (!expected) {
    throw new Error(`no checksum entry for ${assetName} in ${checksumsUrl}`);
  }

  // Download to a sibling temp path — same directory guarantees the
  // rename is atomic (no cross-device copy).
  const tmpPath = `${destPath}.new.${process.pid}`;
  log(`[self-update] downloading ${binaryUrl}`);
  await downloadTo(binaryUrl, tmpPath);

  const actual = await sha256Hex(tmpPath);
  if (actual !== expected) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    throw new Error(
      `checksum mismatch for ${assetName}: expected ${expected}, got ${actual}`
    );
  }
  log(`[self-update] checksum ok (${actual.slice(0, 12)}…)`);

  fs.chmodSync(tmpPath, 0o755);
  fs.renameSync(tmpPath, destPath);

  log(
    `[self-update] ${binary} updated ${opts.currentVersion} -> ${release.version}`
  );
  return {
    updated: true,
    fromVersion: opts.currentVersion,
    toVersion: release.version,
    destPath,
  };
}
