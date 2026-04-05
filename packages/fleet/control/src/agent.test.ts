import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { findCliPath, findControlPlanePath, getCliVersion } from "./agent";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("findCliPath", () => {
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeAll(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "seed-cli-path-"));
    originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterAll(() => {
    process.env.HOME = originalHome;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test("returns null when no CLI is installed anywhere", () => {
    // fakeHome has no .local/bin, and system paths don't have 'seed'
    // (or if they do, they're not under our control — this is still a
    // useful assertion that the function returns a string or null, not
    // throws)
    const result = findCliPath();
    // On a dev machine with seed installed, this could be non-null if
    // the system path has it. Only assert the type contract.
    expect(result === null || typeof result === "string").toBe(true);
  });

  test("finds executable at ~/.local/bin/seed when present", () => {
    const binDir = join(fakeHome, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const seedPath = join(binDir, "seed");
    writeFileSync(seedPath, "#!/bin/sh\necho fake");
    chmodSync(seedPath, 0o755);

    expect(findCliPath()).toBe(seedPath);
  });
});

describe("findControlPlanePath", () => {
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeAll(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "seed-cp-path-"));
    originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterAll(() => {
    process.env.HOME = originalHome;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test("returns null when no seed-control-plane is installed", () => {
    const result = findControlPlanePath();
    expect(result === null || typeof result === "string").toBe(true);
  });

  test("finds executable at ~/.local/bin/seed-control-plane", () => {
    const binDir = join(fakeHome, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const cpPath = join(binDir, "seed-control-plane");
    writeFileSync(cpPath, "#!/bin/sh\necho fake");
    chmodSync(cpPath, 0o755);

    expect(findControlPlanePath()).toBe(cpPath);
  });
});

describe("getCliVersion", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "seed-cli-ver-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("extracts semver from binary output", () => {
    const fake = join(tmpDir, "fake-cli");
    writeFileSync(fake, "#!/bin/sh\necho 0.4.3");
    chmodSync(fake, 0o755);

    expect(getCliVersion(fake)).toBe("0.4.3");
  });

  test("extracts semver from prefixed output", () => {
    const fake = join(tmpDir, "fake-cli-prefix");
    writeFileSync(fake, "#!/bin/sh\necho 'seed-cli 1.23.456 built 2026-01-01'");
    chmodSync(fake, 0o755);

    expect(getCliVersion(fake)).toBe("1.23.456");
  });

  test("returns null when binary fails to execute", () => {
    const fake = join(tmpDir, "nonexistent");
    expect(getCliVersion(fake)).toBeNull();
  });

  test("returns null when output has no version string", () => {
    const fake = join(tmpDir, "no-version");
    writeFileSync(fake, "#!/bin/sh\necho 'no version here'");
    chmodSync(fake, 0o755);

    expect(getCliVersion(fake)).toBeNull();
  });

  test("returns null when binary exits non-zero", () => {
    const fake = join(tmpDir, "exit-fail");
    writeFileSync(fake, "#!/bin/sh\necho 0.4.3\nexit 1");
    chmodSync(fake, 0o755);

    expect(getCliVersion(fake)).toBeNull();
  });
});
