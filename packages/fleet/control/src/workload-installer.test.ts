import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sha256Hex,
  verifyInstalledChecksums,
  extractTarball,
  installWorkload,
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
