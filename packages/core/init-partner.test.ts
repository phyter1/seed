import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { substituteTokens, mergeGitignore, initPartner } from "./init-partner";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "init-partner-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("substituteTokens", () => {
  test("replaces [Partner Name] with partner name", () => {
    const result = substituteTokens("Hello [Partner Name]!", "Aria", "Matrix");
    expect(result).toBe("Hello Aria!");
  });

  test("replaces [Name] with partner name", () => {
    const result = substituteTokens("You are **[Name]**.", "Aria", "Matrix");
    expect(result).toBe("You are **Aria**.");
  });

  test("replaces [Project Name] with project name", () => {
    const result = substituteTokens("# [Partner Name] — [Project Name]", "Aria", "Matrix");
    expect(result).toBe("# Aria — Matrix");
  });

  test("replaces all occurrences", () => {
    const template = "[Partner Name] works on [Project Name]. [Name] is the partner.";
    const result = substituteTokens(template, "Aria", "Matrix");
    expect(result).toBe("Aria works on Matrix. Aria is the partner.");
  });

  test("leaves other placeholder-style text intact", () => {
    const result = substituteTokens("[Some Other Token]", "Aria", "Matrix");
    expect(result).toBe("[Some Other Token]");
  });
});

describe("mergeGitignore", () => {
  test("appends partner block to existing .gitignore", () => {
    const existing = "node_modules/\n.DS_Store\n";
    const result = mergeGitignore(existing);
    expect(result).toContain("node_modules/");
    expect(result).toContain(".DS_Store");
    expect(result).toContain("self.md");
    expect(result).toContain("continuity.md");
  });

  test("does not duplicate if marker already present", () => {
    const existing = "node_modules/\n# Seed partner — identity files (local only)\nself.md\n";
    const result = mergeGitignore(existing);
    const markerCount = (result.match(/# Seed partner/g) ?? []).length;
    expect(markerCount).toBe(1);
  });

  test("handles empty .gitignore", () => {
    const result = mergeGitignore("");
    expect(result).toContain("self.md");
  });

  test("journal/entries preserved with .gitkeep exception", () => {
    const result = mergeGitignore("");
    expect(result).toContain("journal/entries/*.md");
    expect(result).toContain("!journal/entries/.gitkeep");
  });
});

describe("initPartner", () => {
  test("fails if CLAUDE.md exists and force is false", async () => {
    await writeFile(join(tempDir, "CLAUDE.md"), "existing content");
    await expect(
      initPartner({
        projectPath: tempDir,
        partnerName: "Aria",
        projectName: "TestProject",
        force: false,
        dryRun: false,
      })
    ).rejects.toThrow("already exists");
  });

  test("succeeds with force=true when CLAUDE.md exists", async () => {
    await writeFile(join(tempDir, "CLAUDE.md"), "existing content");
    // Should not throw
    await initPartner({
      projectPath: tempDir,
      partnerName: "Aria",
      projectName: "TestProject",
      force: true,
      dryRun: false,
    });
    const claudeMd = await readFile(join(tempDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("Aria");
  });

  test("writes CLAUDE.md with substituted tokens", async () => {
    await initPartner({
      projectPath: tempDir,
      partnerName: "Aria",
      projectName: "Matrix",
      force: false,
      dryRun: false,
    });
    const claudeMd = await readFile(join(tempDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("Aria");
    expect(claudeMd).toContain("Matrix");
    expect(claudeMd).not.toContain("[Partner Name]");
    expect(claudeMd).not.toContain("[Project Name]");
  });

  test("creates journal directory structure with .gitkeep files", async () => {
    await initPartner({
      projectPath: tempDir,
      partnerName: "Aria",
      projectName: "Matrix",
      force: false,
      dryRun: false,
    });

    const paths = [
      "journal/entries/.gitkeep",
      "journal/summaries/.gitkeep",
      "notes/inbox/.gitkeep",
      "notes/archive/.gitkeep",
    ];

    for (const p of paths) {
      const exists = await access(join(tempDir, p))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    }
  });

  test("creates journal/summaries/index.md", async () => {
    await initPartner({
      projectPath: tempDir,
      partnerName: "Aria",
      projectName: "Matrix",
      force: false,
      dryRun: false,
    });
    const index = await readFile(join(tempDir, "journal/summaries/index.md"), "utf-8");
    expect(index).toContain("Journal Summaries");
  });

  test("creates .gitignore when none exists", async () => {
    await initPartner({
      projectPath: tempDir,
      partnerName: "Aria",
      projectName: "Matrix",
      force: false,
      dryRun: false,
    });
    const gitignore = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("self.md");
  });

  test("merges into existing .gitignore", async () => {
    await writeFile(join(tempDir, ".gitignore"), "node_modules/\n");
    await initPartner({
      projectPath: tempDir,
      partnerName: "Aria",
      projectName: "Matrix",
      force: false,
      dryRun: false,
    });
    const gitignore = await readFile(join(tempDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain("self.md");
  });

  test("dry-run does not write any files", async () => {
    const result = await initPartner({
      projectPath: tempDir,
      partnerName: "Aria",
      projectName: "Matrix",
      force: false,
      dryRun: true,
    });

    // Should return rendered content
    expect(result.claudeMd).toContain("Aria");

    // But CLAUDE.md should not exist
    const claudeMdExists = await access(join(tempDir, "CLAUDE.md"))
      .then(() => true)
      .catch(() => false);
    expect(claudeMdExists).toBe(false);

    // createdPaths should be empty in dry-run
    expect(result.createdPaths).toHaveLength(0);
  });

  test("gitignoreUpdated is false when .gitignore already has marker", async () => {
    const alreadyPatched = "node_modules/\n# Seed partner — identity files (local only)\nself.md\n";
    await writeFile(join(tempDir, ".gitignore"), alreadyPatched);
    const result = await initPartner({
      projectPath: tempDir,
      partnerName: "Aria",
      projectName: "Matrix",
      force: false,
      dryRun: false,
    });
    expect(result.gitignoreUpdated).toBe(false);
  });

  test("does not overwrite existing journal .gitkeep files", async () => {
    // Run twice — second run should not error on existing .gitkeep files
    await initPartner({
      projectPath: tempDir,
      partnerName: "Aria",
      projectName: "Matrix",
      force: false,
      dryRun: false,
    });
    await initPartner({
      projectPath: tempDir,
      partnerName: "Aria",
      projectName: "Matrix",
      force: true,
      dryRun: false,
    });

    // Still valid
    const claudeMd = await readFile(join(tempDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("Aria");
  });
});
