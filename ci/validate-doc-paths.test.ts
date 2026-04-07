import { describe, test, expect } from "bun:test";
import { access, constants } from "node:fs/promises";
import path from "node:path";

const SCRIPT_PATH = path.resolve(import.meta.dir, "validate-doc-paths.sh");

describe("validate-doc-paths.sh", () => {
  test("script is executable", async () => {
    // access() resolves without throwing when the file has the requested permissions
    const result = await access(SCRIPT_PATH, constants.X_OK);
    expect(result).toBeFalsy();
  });

  test("exits 0 on the current repo (all paths valid)", async () => {
    const proc = Bun.spawn(["bash", SCRIPT_PATH], {
      cwd: path.resolve(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("All documentation paths validated successfully.");
  });

  test("catches broken path references", async () => {
    const tmpDir = await Bun.file("/dev/null").text().catch(() => "");
    const testDir = path.join(import.meta.dir, "..", ".test-validate-paths");

    // Set up a minimal repo structure with a broken reference
    const { mkdir, writeFile, rm } = await import("node:fs/promises");
    await mkdir(path.join(testDir, "docs"), { recursive: true });
    await writeFile(
      path.join(testDir, "README.md"),
      "Check `docs/nonexistent.md` for details.\n"
    );
    await writeFile(path.join(testDir, "CLAUDE.md"), "");
    // Copy the script so its parent-dir resolution works
    const scriptContent = await Bun.file(SCRIPT_PATH).text();
    await mkdir(path.join(testDir, "ci"), { recursive: true });
    const testScript = path.join(testDir, "ci", "validate-doc-paths.sh");
    await writeFile(testScript, scriptContent, { mode: 0o755 });

    try {
      const proc = Bun.spawn(["bash", testScript], {
        cwd: testDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      expect(exitCode).toBe(1);
      expect(stdout).toContain("docs/nonexistent.md");
      expect(stdout).toContain("not found");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
