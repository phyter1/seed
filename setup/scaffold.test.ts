import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, copyFileSync, mkdirSync } from "fs";

const IDENTITY_FILES = [
  "self.md",
  "continuity.md",
  "convictions.md",
  "projects.md",
  "objectives.md",
];

const TEMPLATE_DIR = "packages/core/identity";

const DIRECTORIES = [
  "journal/entries",
  "journal/summaries",
  "notes/inbox",
  "notes/archive",
];

async function copyTemplates(seedDir: string): Promise<void> {
  const templateSrc = join(
    import.meta.dir,
    "..",
    TEMPLATE_DIR,
  );
  const templateDest = join(seedDir, TEMPLATE_DIR);
  mkdirSync(templateDest, { recursive: true });

  for (const file of IDENTITY_FILES) {
    copyFileSync(
      join(templateSrc, `${file}.template`),
      join(templateDest, `${file}.template`),
    );
  }
}

async function runScaffold(seedDir: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const scriptSrc = join(import.meta.dir, "scaffold.sh");
  const proc = Bun.spawn(["bash", scriptSrc], {
    env: { ...process.env, SEED_DIR: seedDir },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

describe("scaffold.sh", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "seed-scaffold-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("creates all 5 identity files from templates", async () => {
    await copyTemplates(tempDir);
    const result = await runScaffold(tempDir);

    expect(result.exitCode).toBe(0);

    for (const file of IDENTITY_FILES) {
      const filePath = join(tempDir, file);
      expect(existsSync(filePath)).toBe(true);

      const content = await readFile(filePath, "utf-8");
      const templateContent = await readFile(
        join(tempDir, TEMPLATE_DIR, `${file}.template`),
        "utf-8",
      );
      expect(content).toBe(templateContent);
    }
  });

  test("creates required directory structure", async () => {
    await copyTemplates(tempDir);
    const result = await runScaffold(tempDir);

    expect(result.exitCode).toBe(0);

    for (const dir of DIRECTORIES) {
      const dirPath = join(tempDir, dir);
      expect(existsSync(dirPath)).toBe(true);
    }
  });

  test("is idempotent — does not overwrite existing files", async () => {
    await copyTemplates(tempDir);

    // First run — creates files
    const first = await runScaffold(tempDir);
    expect(first.exitCode).toBe(0);

    // Modify self.md to verify it's preserved
    const selfPath = join(tempDir, "self.md");
    const customContent = "# My Real Identity\n\nThis is mine now.\n";
    await writeFile(selfPath, customContent);

    // Second run — should skip existing files
    const second = await runScaffold(tempDir);
    expect(second.exitCode).toBe(0);

    // Verify self.md was NOT overwritten
    const afterContent = await readFile(selfPath, "utf-8");
    expect(afterContent).toBe(customContent);

    // Verify the output mentions "Skipped" for self.md
    expect(second.stdout).toContain("Skipped");
    expect(second.stdout).toContain("self.md");
  });

  test("reports created vs skipped files", async () => {
    await copyTemplates(tempDir);

    // Pre-create convictions.md
    await writeFile(join(tempDir, "convictions.md"), "# My Convictions\n");

    const result = await runScaffold(tempDir);
    expect(result.exitCode).toBe(0);

    // Should report Created for the 4 new files
    expect(result.stdout).toContain("Created");
    expect(result.stdout).toContain("self.md");

    // Should report Skipped for the pre-existing one
    expect(result.stdout).toContain("Skipped");
    expect(result.stdout).toContain("convictions.md");
  });

  test("exits 0 on success", async () => {
    await copyTemplates(tempDir);
    const result = await runScaffold(tempDir);
    expect(result.exitCode).toBe(0);
  });
});
