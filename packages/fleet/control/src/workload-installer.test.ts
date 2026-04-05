import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sha256Hex,
  verifyInstalledChecksums,
  extractTarball,
  installWorkload,
  pruneOldInstalls,
  compareSemver,
  pathSize,
  parseArtifactVersion,
  pruneArtifactTarballs,
  sweepTmpOrphans,
  gcWorkload,
} from "./workload-installer";
import type { WorkloadManifest, WorkloadDeclaration } from "./types";
import type { SupervisorDriver } from "./supervisors/launchd";

/**
 * Helper: build a fake workload tarball on disk and return its path.
 * Simulates the artifact bundle produced by a real workload package.
 */
function buildFakeArtifact(stageDir: string, manifest: WorkloadManifest): string {
  mkdirSync(stageDir, { recursive: true });
  mkdirSync(join(stageDir, "bin"), { recursive: true });
  mkdirSync(join(stageDir, "templates"), { recursive: true });

  // Fake binary — just an exec-able script that echoes.
  const binaryContent = "#!/bin/sh\necho fake workload\n";
  writeFileSync(join(stageDir, manifest.binary), binaryContent, { mode: 0o755 });

  // Fake launchd template with every token the installer renders.
  writeFileSync(
    join(stageDir, manifest.supervisor.launchd!.template),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist><dict>
<key>Label</key><string>@@LABEL@@</string>
<key>Program</key><string>@@BINARY@@</string>
<key>InstallDir</key><string>@@INSTALL_DIR@@</string>
<key>LogPath</key><string>@@LOG_PATH@@</string>
<key>Env</key><dict>@@ENV@@</dict>
</dict></plist>`
  );

  writeFileSync(join(stageDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const tarball = join(stageDir, "..", "fake.tar.gz");
  // Use system tar to package
  const proc = Bun.spawnSync(["tar", "-czf", tarball, "-C", stageDir, "."]);
  if (proc.exitCode !== 0) {
    throw new Error(
      "tar failed: " + new TextDecoder().decode(proc.stderr ?? new Uint8Array())
    );
  }
  return tarball;
}

/** Minimal mock driver — records what's been loaded/unloaded. */
function mockDriver(): SupervisorDriver & { loaded: Map<string, string>; calls: string[] } {
  const loaded = new Map<string, string>();
  const calls: string[] = [];
  return {
    loaded,
    calls,
    async load(label: string, plist: string) {
      calls.push(`load ${label}`);
      loaded.set(label, plist);
    },
    async unload(label: string) {
      calls.push(`unload ${label}`);
      loaded.delete(label);
    },
    async isLoaded(label: string) {
      return loaded.has(label);
    },
    async status(label: string) {
      return { loaded: loaded.has(label), pid: null, last_exit: null };
    },
  };
}

describe("sha256Hex", () => {
  test("computes sha256 of known input", () => {
    const h = sha256Hex(new TextEncoder().encode("hello"));
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});

describe("verifyInstalledChecksums", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "verify-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("passes when files match", () => {
    writeFileSync(join(tmp, "a.txt"), "hello");
    const manifest = {
      id: "x",
      version: "1",
      platform: "darwin" as const,
      arch: "arm64" as const,
      binary: "a.txt",
      supervisor: {},
      checksums: {
        "a.txt": "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      },
    } as unknown as WorkloadManifest;
    expect(() => verifyInstalledChecksums(manifest, tmp)).not.toThrow();
  });

  test("throws on mismatch", () => {
    writeFileSync(join(tmp, "a.txt"), "wrong content");
    const manifest = {
      id: "x", version: "1", platform: "darwin" as const, arch: "arm64" as const,
      binary: "a.txt", supervisor: {},
      checksums: { "a.txt": "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" },
    } as unknown as WorkloadManifest;
    expect(() => verifyInstalledChecksums(manifest, tmp)).toThrow(/checksum mismatch/);
  });

  test("throws when file is missing", () => {
    const manifest = {
      id: "x", version: "1", platform: "darwin" as const, arch: "arm64" as const,
      binary: "a.txt", supervisor: {},
      checksums: { "a.txt": "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" },
    } as unknown as WorkloadManifest;
    expect(() => verifyInstalledChecksums(manifest, tmp)).toThrow(/checksum target missing/);
  });

  test("no-op when manifest has no checksums", () => {
    const manifest = {
      id: "x", version: "1", platform: "darwin" as const, arch: "arm64" as const,
      binary: "a.txt", supervisor: {},
    } as unknown as WorkloadManifest;
    expect(() => verifyInstalledChecksums(manifest, tmp)).not.toThrow();
  });
});

describe("extractTarball", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "extract-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("extracts a tarball into a directory", async () => {
    const src = join(tmp, "src");
    mkdirSync(src);
    writeFileSync(join(src, "file.txt"), "content");
    const tarball = join(tmp, "archive.tar.gz");
    const proc = Bun.spawnSync(["tar", "-czf", tarball, "-C", src, "."]);
    expect(proc.exitCode).toBe(0);

    const dest = join(tmp, "dest");
    await extractTarball(tarball, dest);
    expect(existsSync(join(dest, "file.txt"))).toBe(true);
    expect(readFileSync(join(dest, "file.txt"), "utf-8")).toBe("content");
  });

  test("throws on malformed tarball", async () => {
    const bad = join(tmp, "bad.tar.gz");
    writeFileSync(bad, "not a tarball");
    await expect(extractTarball(bad, join(tmp, "dest"))).rejects.toThrow();
  });
});

describe("installWorkload (full flow with mock driver)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "install-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("happy path: fetches file:// artifact, extracts, renders, loads", async () => {
    const stageDir = join(tmp, "stage");
    const manifest: WorkloadManifest = {
      id: "test-workload",
      version: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      binary: "bin/worker",
      env: { TEST_VAR: "{{install_dir}}/data" },
      supervisor: {
        launchd: {
          label: "com.test.worker",
          template: "templates/launchd.plist.template",
        },
      },
    };
    const tarball = buildFakeArtifact(stageDir, manifest);

    const decl: WorkloadDeclaration = {
      id: "test-workload",
      version: "0.1.0",
      artifact_url: `file://${tarball}`,
      env: { EXTRA: "from_operator" },
    };

    const driver = mockDriver();
    const installRoot = join(tmp, "installs");
    const plistDir = join(tmp, "plists");
    const logDir = join(tmp, "logs");

    const result = await installWorkload(decl, {
      driver,
      installRoot,
      plistDir,
      logDir,
    });

    // Returned record reflects a successful install.
    expect(result.record.workload_id).toBe("test-workload");
    expect(result.record.version).toBe("0.1.0");
    expect(result.record.state).toBe("loaded");
    expect(result.record.supervisor_label).toBe("com.test.worker");

    // Install directory exists, binary is present, template rendered.
    expect(existsSync(result.record.install_dir)).toBe(true);
    expect(existsSync(join(result.record.install_dir, "bin/worker"))).toBe(true);

    // Plist was written to plistDir.
    expect(existsSync(result.plistPath)).toBe(true);
    const rendered = readFileSync(result.plistPath, "utf-8");
    // Tokens resolved correctly
    expect(rendered).toContain("<string>com.test.worker</string>");
    expect(rendered).toContain(result.record.install_dir);
    // Env has both manifest and declaration entries, {{install_dir}} expanded
    expect(rendered).toContain("<key>TEST_VAR</key>");
    expect(rendered).toContain(`${result.record.install_dir}/data`);
    expect(rendered).toContain("<key>EXTRA</key>");
    expect(rendered).toContain("<string>from_operator</string>");

    // Driver was asked to unload (idempotent prep) then load.
    expect(driver.calls).toEqual([
      "unload com.test.worker",
      "load com.test.worker",
    ]);
    expect(driver.loaded.get("com.test.worker")).toBe(result.plistPath);
  });

  test("rejects manifest with mismatched id", async () => {
    const stageDir = join(tmp, "stage");
    const manifest: WorkloadManifest = {
      id: "actual-id",
      version: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      binary: "bin/worker",
      supervisor: { launchd: { label: "com.x", template: "templates/launchd.plist.template" } },
    };
    const tarball = buildFakeArtifact(stageDir, manifest);
    const decl: WorkloadDeclaration = {
      id: "expected-id",
      version: "0.1.0",
      artifact_url: `file://${tarball}`,
    };
    await expect(
      installWorkload(decl, {
        driver: mockDriver(),
        installRoot: join(tmp, "installs"),
        plistDir: join(tmp, "plists"),
        logDir: join(tmp, "logs"),
      })
    ).rejects.toThrow(/manifest id mismatch/);
  });

  test("rejects unsupported artifact URL scheme", async () => {
    const decl: WorkloadDeclaration = {
      id: "x",
      version: "0.1.0",
      artifact_url: "ftp://nope/nope.tar.gz",
    };
    await expect(
      installWorkload(decl, {
        driver: mockDriver(),
        installRoot: join(tmp, "installs"),
        plistDir: join(tmp, "plists"),
        logDir: join(tmp, "logs"),
      })
    ).rejects.toThrow(/unsupported artifact URL scheme/);
  });
});

describe("compareSemver", () => {
  test("orders patch versions numerically", () => {
    expect(compareSemver("0.4.2", "0.4.10")).toBeLessThan(0);
    expect(compareSemver("0.4.10", "0.4.2")).toBeGreaterThan(0);
  });

  test("orders minor and major versions", () => {
    expect(compareSemver("0.5.0", "0.4.99")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });

  test("equal versions return 0", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });

  test("handles missing components as zero", () => {
    expect(compareSemver("1", "1.0.0")).toBe(0);
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
  });
});

describe("pruneOldInstalls", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "seed-prune-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const seed = (names: string[]): void => {
    for (const n of names) {
      mkdirSync(join(root, n), { recursive: true });
      writeFileSync(join(root, n, "marker"), "x");
    }
  };

  test("keeps current + N prior, removes the rest", () => {
    seed([
      "memory-0.1.0",
      "memory-0.2.0",
      "memory-0.4.2",
      "memory-0.4.8",
      "memory-0.4.9",
    ]);
    const removed = pruneOldInstalls(root, "memory", "0.4.9", 1);
    expect(removed.sort()).toEqual(
      ["memory-0.1.0", "memory-0.2.0", "memory-0.4.2"].sort()
    );
    expect(existsSync(join(root, "memory-0.4.9"))).toBe(true);
    expect(existsSync(join(root, "memory-0.4.8"))).toBe(true);
    expect(existsSync(join(root, "memory-0.4.2"))).toBe(false);
  });

  test("keepPrior=0 removes every non-current version", () => {
    seed(["memory-0.4.8", "memory-0.4.9"]);
    const removed = pruneOldInstalls(root, "memory", "0.4.9", 0);
    expect(removed).toEqual(["memory-0.4.8"]);
    expect(existsSync(join(root, "memory-0.4.8"))).toBe(false);
  });

  test("keepPrior=-1 disables pruning", () => {
    seed(["memory-0.1.0", "memory-0.4.8", "memory-0.4.9"]);
    const removed = pruneOldInstalls(root, "memory", "0.4.9", -1);
    expect(removed).toEqual([]);
    expect(existsSync(join(root, "memory-0.1.0"))).toBe(true);
  });

  test("ignores dirs from other workloads", () => {
    seed(["memory-0.4.9", "memory-0.4.8", "fleet-router-1.0.0", "fleet-router-0.3.0"]);
    const removed = pruneOldInstalls(root, "memory", "0.4.9", 0);
    expect(removed).toEqual(["memory-0.4.8"]);
    expect(existsSync(join(root, "fleet-router-1.0.0"))).toBe(true);
    expect(existsSync(join(root, "fleet-router-0.3.0"))).toBe(true);
  });

  test("no-op when no prior versions exist", () => {
    seed(["memory-0.4.9"]);
    const removed = pruneOldInstalls(root, "memory", "0.4.9", 1);
    expect(removed).toEqual([]);
  });

  test("no-op on non-existent installRoot", () => {
    rmSync(root, { recursive: true, force: true });
    const removed = pruneOldInstalls(root, "memory", "0.4.9", 1);
    expect(removed).toEqual([]);
  });

  test("ignores regular files matching the pattern", () => {
    seed(["memory-0.4.8"]);
    writeFileSync(join(root, "memory-0.4.7-darwin-x64.tar.gz"), "tarball");
    const removed = pruneOldInstalls(root, "memory", "0.4.9", 0);
    expect(removed).toEqual(["memory-0.4.8"]);
    expect(existsSync(join(root, "memory-0.4.7-darwin-x64.tar.gz"))).toBe(true);
  });

  test("sorts by semver not lexical (multi-digit safe)", () => {
    seed(["memory-0.4.2", "memory-0.4.10", "memory-0.4.9"]);
    // current=0.4.10, keepPrior=1 → keep 0.4.9, drop 0.4.2
    const removed = pruneOldInstalls(root, "memory", "0.4.10", 1);
    expect(removed).toEqual(["memory-0.4.2"]);
    expect(existsSync(join(root, "memory-0.4.9"))).toBe(true);
  });
});

describe("pathSize", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "seed-size-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("returns 0 for missing path", () => {
    expect(pathSize(join(root, "nope"))).toBe(0);
  });

  test("returns byte size of a single file", () => {
    const f = join(root, "x.txt");
    writeFileSync(f, "hello world"); // 11 bytes
    expect(pathSize(f)).toBe(11);
  });

  test("sums file sizes recursively", () => {
    mkdirSync(join(root, "a/b"), { recursive: true });
    writeFileSync(join(root, "top.txt"), "1234"); // 4
    writeFileSync(join(root, "a/mid.txt"), "abcdef"); // 6
    writeFileSync(join(root, "a/b/deep.txt"), "z"); // 1
    expect(pathSize(root)).toBe(11);
  });
});

describe("parseArtifactVersion", () => {
  test("extracts version from well-formed artifact name", () => {
    expect(parseArtifactVersion("memory-0.4.9-darwin-x64.tar.gz", "memory"))
      .toBe("0.4.9");
    expect(parseArtifactVersion("memory-0.4.10-linux-x64.tar.gz", "memory"))
      .toBe("0.4.10");
    expect(parseArtifactVersion("memory-0.4.9-rc1-darwin-arm64.tar.gz", "memory"))
      .toBe("0.4.9-rc1");
  });

  test("returns null for non-matching names", () => {
    expect(parseArtifactVersion("memory-0.4.9.tar.gz", "memory")).toBe(null);
    expect(parseArtifactVersion("memory-darwin-x64.tar.gz", "memory")).toBe(null);
    expect(parseArtifactVersion("other-0.4.9-darwin-x64.tar.gz", "memory")).toBe(null);
    expect(parseArtifactVersion("memory-0.4.9-darwin-x64.zip", "memory")).toBe(null);
  });

  test("workloadId must match prefix exactly", () => {
    expect(parseArtifactVersion("memory-service-0.4.9-darwin-x64.tar.gz", "memory"))
      .toBe(null);
  });
});

describe("pruneArtifactTarballs", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "seed-artifacts-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const seedTarballs = (names: string[]): void => {
    for (const n of names) writeFileSync(join(root, n), "tarball-contents");
  };

  test("removes tarballs whose version is not retained", () => {
    seedTarballs([
      "memory-0.4.2-darwin-x64.tar.gz",
      "memory-0.4.8-darwin-x64.tar.gz",
      "memory-0.4.9-darwin-x64.tar.gz",
    ]);
    const { removed, bytesFreed } = pruneArtifactTarballs(
      root,
      "memory",
      new Set(["0.4.9"]),
      false
    );
    expect(removed.sort()).toEqual([
      "memory-0.4.2-darwin-x64.tar.gz",
      "memory-0.4.8-darwin-x64.tar.gz",
    ]);
    expect(bytesFreed).toBeGreaterThan(0);
    expect(existsSync(join(root, "memory-0.4.9-darwin-x64.tar.gz"))).toBe(true);
    expect(existsSync(join(root, "memory-0.4.8-darwin-x64.tar.gz"))).toBe(false);
  });

  test("dryRun reports without deleting", () => {
    seedTarballs(["memory-0.4.2-darwin-x64.tar.gz", "memory-0.4.9-darwin-x64.tar.gz"]);
    const { removed } = pruneArtifactTarballs(
      root,
      "memory",
      new Set(["0.4.9"]),
      true
    );
    expect(removed).toEqual(["memory-0.4.2-darwin-x64.tar.gz"]);
    expect(existsSync(join(root, "memory-0.4.2-darwin-x64.tar.gz"))).toBe(true);
  });

  test("ignores files for other workloads", () => {
    seedTarballs([
      "memory-0.4.2-darwin-x64.tar.gz",
      "fleet-router-0.4.2-darwin-x64.tar.gz",
    ]);
    const { removed } = pruneArtifactTarballs(
      root,
      "memory",
      new Set(["0.4.9"]),
      false
    );
    expect(removed).toEqual(["memory-0.4.2-darwin-x64.tar.gz"]);
    expect(existsSync(join(root, "fleet-router-0.4.2-darwin-x64.tar.gz"))).toBe(true);
  });

  test("ignores unrelated files in artifact root", () => {
    seedTarballs(["memory-0.4.2-darwin-x64.tar.gz"]);
    writeFileSync(join(root, "README.md"), "docs");
    writeFileSync(join(root, "memory-latest.txt"), "pointer");
    const { removed } = pruneArtifactTarballs(
      root,
      "memory",
      new Set(),
      false
    );
    expect(removed).toEqual(["memory-0.4.2-darwin-x64.tar.gz"]);
    expect(existsSync(join(root, "README.md"))).toBe(true);
    expect(existsSync(join(root, "memory-latest.txt"))).toBe(true);
  });

  test("no-op on non-existent root", () => {
    rmSync(root, { recursive: true, force: true });
    const { removed, bytesFreed } = pruneArtifactTarballs(
      root,
      "memory",
      new Set(),
      false
    );
    expect(removed).toEqual([]);
    expect(bytesFreed).toBe(0);
  });
});

describe("sweepTmpOrphans", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "seed-tmp-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("removes semver-shaped tarballs and seed-owned dbs", () => {
    writeFileSync(join(root, "memory-0.1.0-darwin-x64.tar.gz"), "old");
    writeFileSync(join(root, "memory-0.2.0-darwin-x64.tar.gz"), "older");
    writeFileSync(join(root, "seed-memory-seed.db"), "db");
    writeFileSync(join(root, "seed-memory-seed.db-wal"), "wal");
    const { removed } = sweepTmpOrphans(root, "memory", false);
    expect(removed.sort()).toEqual(
      [
        "memory-0.1.0-darwin-x64.tar.gz",
        "memory-0.2.0-darwin-x64.tar.gz",
        "seed-memory-seed.db",
        "seed-memory-seed.db-wal",
      ].sort()
    );
  });

  test("does not touch unrelated files", () => {
    writeFileSync(join(root, "user-notes.txt"), "mine");
    writeFileSync(join(root, "memory-thoughts.txt"), "mine too"); // no semver
    writeFileSync(join(root, "memory.tar.gz"), "archive"); // no version
    writeFileSync(join(root, "seed-other-seed.db"), "wrong workload");
    const { removed } = sweepTmpOrphans(root, "memory", false);
    expect(removed).toEqual([]);
    expect(existsSync(join(root, "user-notes.txt"))).toBe(true);
    expect(existsSync(join(root, "memory-thoughts.txt"))).toBe(true);
    expect(existsSync(join(root, "seed-other-seed.db"))).toBe(true);
  });

  test("dryRun reports without deleting", () => {
    writeFileSync(join(root, "memory-0.1.0-darwin-x64.tar.gz"), "contents");
    const { removed } = sweepTmpOrphans(root, "memory", true);
    expect(removed).toEqual(["memory-0.1.0-darwin-x64.tar.gz"]);
    expect(existsSync(join(root, "memory-0.1.0-darwin-x64.tar.gz"))).toBe(true);
  });

  test("no-op on non-existent root", () => {
    rmSync(root, { recursive: true, force: true });
    const { removed } = sweepTmpOrphans(root, "memory", false);
    expect(removed).toEqual([]);
  });
});

describe("gcWorkload", () => {
  let root: string;
  let installRoot: string;
  let artifactRoot: string;
  let tmpRoot: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "seed-gc-"));
    installRoot = join(root, "workloads");
    artifactRoot = join(root, "artifacts");
    tmpRoot = join(root, "tmp");
    mkdirSync(installRoot, { recursive: true });
    mkdirSync(artifactRoot, { recursive: true });
    mkdirSync(tmpRoot, { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const seedInstallDirs = (names: string[]) => {
    for (const n of names) {
      mkdirSync(join(installRoot, n), { recursive: true });
      writeFileSync(join(installRoot, n, "marker"), "data-data");
    }
  };

  test("retains current + keepPrior, removes older install-dirs and matching artifacts", () => {
    seedInstallDirs([
      "memory-0.4.2",
      "memory-0.4.7",
      "memory-0.4.8",
      "memory-0.4.9",
    ]);
    for (const v of ["0.4.2", "0.4.7", "0.4.8", "0.4.9"]) {
      writeFileSync(
        join(artifactRoot, `memory-${v}-darwin-x64.tar.gz`),
        "tarball-contents"
      );
    }

    const report = gcWorkload("memory", "0.4.9", {
      installRoot,
      artifactRoot,
      tmpRoot,
      keepPrior: 1,
      dryRun: false,
    });

    expect(report.installDirs.removed.sort()).toEqual([
      "memory-0.4.2",
      "memory-0.4.7",
    ]);
    expect(report.artifacts.removed.sort()).toEqual([
      "memory-0.4.2-darwin-x64.tar.gz",
      "memory-0.4.7-darwin-x64.tar.gz",
    ]);
    // Current + 1 prior retained:
    expect(existsSync(join(installRoot, "memory-0.4.9"))).toBe(true);
    expect(existsSync(join(installRoot, "memory-0.4.8"))).toBe(true);
    expect(existsSync(join(installRoot, "memory-0.4.7"))).toBe(false);
    // Retained install-dirs' artifacts stay:
    expect(existsSync(join(artifactRoot, "memory-0.4.9-darwin-x64.tar.gz"))).toBe(true);
    expect(existsSync(join(artifactRoot, "memory-0.4.8-darwin-x64.tar.gz"))).toBe(true);
    // bytesFreed accounts for both:
    expect(report.bytesFreed).toBeGreaterThan(0);
    expect(report.bytesFreed).toBe(
      report.installDirs.bytesFreed + report.artifacts.bytesFreed
    );
  });

  test("keepPrior=0 removes every non-current version", () => {
    seedInstallDirs(["memory-0.4.8", "memory-0.4.9"]);
    const report = gcWorkload("memory", "0.4.9", {
      installRoot,
      artifactRoot,
      tmpRoot,
      keepPrior: 0,
      dryRun: false,
    });
    expect(report.installDirs.removed).toEqual(["memory-0.4.8"]);
    expect(existsSync(join(installRoot, "memory-0.4.9"))).toBe(true);
  });

  test("dryRun reports intended removals without touching disk", () => {
    seedInstallDirs(["memory-0.4.8", "memory-0.4.9"]);
    const report = gcWorkload("memory", "0.4.9", {
      installRoot,
      artifactRoot,
      tmpRoot,
      keepPrior: 0,
      dryRun: true,
    });
    expect(report.installDirs.removed).toEqual(["memory-0.4.8"]);
    expect(existsSync(join(installRoot, "memory-0.4.8"))).toBe(true);
    expect(report.installDirs.bytesFreed).toBeGreaterThan(0);
  });

  test("currentVersion=null treats every install-dir as stale (keepPrior retains N most recent)", () => {
    seedInstallDirs(["memory-0.4.7", "memory-0.4.8", "memory-0.4.9"]);
    const report = gcWorkload("memory", null, {
      installRoot,
      artifactRoot,
      tmpRoot,
      keepPrior: 1,
      dryRun: false,
    });
    // keepPrior=1 + no current = keep the single most-recent version
    expect(report.installDirs.removed.sort()).toEqual([
      "memory-0.4.7",
      "memory-0.4.8",
    ]);
    expect(existsSync(join(installRoot, "memory-0.4.9"))).toBe(true);
  });

  test("keepPrior=-1 retains everything", () => {
    seedInstallDirs(["memory-0.4.2", "memory-0.4.8", "memory-0.4.9"]);
    const report = gcWorkload("memory", "0.4.9", {
      installRoot,
      artifactRoot,
      tmpRoot,
      keepPrior: -1,
      dryRun: false,
    });
    expect(report.installDirs.removed).toEqual([]);
    expect(existsSync(join(installRoot, "memory-0.4.2"))).toBe(true);
  });

  test("includeTmp=true sweeps tmp orphans", () => {
    seedInstallDirs(["memory-0.4.9"]);
    writeFileSync(join(tmpRoot, "memory-0.1.0-darwin-x64.tar.gz"), "old");
    writeFileSync(join(tmpRoot, "seed-memory-seed.db"), "db");
    const report = gcWorkload("memory", "0.4.9", {
      installRoot,
      artifactRoot,
      tmpRoot,
      keepPrior: 1,
      includeTmp: true,
      dryRun: false,
    });
    expect(report.tmpOrphans.removed.sort()).toEqual([
      "memory-0.1.0-darwin-x64.tar.gz",
      "seed-memory-seed.db",
    ]);
  });

  test("includeTmp=false (default) leaves tmp alone", () => {
    seedInstallDirs(["memory-0.4.9"]);
    writeFileSync(join(tmpRoot, "memory-0.1.0-darwin-x64.tar.gz"), "old");
    const report = gcWorkload("memory", "0.4.9", {
      installRoot,
      artifactRoot,
      tmpRoot,
      keepPrior: 1,
      dryRun: false,
    });
    expect(report.tmpOrphans.removed).toEqual([]);
    expect(existsSync(join(tmpRoot, "memory-0.1.0-darwin-x64.tar.gz"))).toBe(true);
  });

  test("no-op when nothing to clean", () => {
    seedInstallDirs(["memory-0.4.9"]);
    const report = gcWorkload("memory", "0.4.9", {
      installRoot,
      artifactRoot,
      tmpRoot,
      keepPrior: 1,
      dryRun: false,
    });
    expect(report.installDirs.removed).toEqual([]);
    expect(report.artifacts.removed).toEqual([]);
    expect(report.tmpOrphans.removed).toEqual([]);
    expect(report.bytesFreed).toBe(0);
  });
});
