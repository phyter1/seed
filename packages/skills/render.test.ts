import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseSkillFrontmatter,
  mapCapabilitiesToTools,
  mergeOverrides,
  renderSkillMd,
  renderAll,
} from "./render";

let tempDir: string;
let srcDir: string;
let outDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "skill-render-test-"));
  srcDir = join(tempDir, "packages", "skills");
  outDir = join(tempDir, ".claude", "skills");
  await mkdir(srcDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("parseSkillFrontmatter", () => {
  test("parses valid frontmatter with capabilities", () => {
    const content = `---
name: fleet-status
description: Check fleet health.
category: identity
invocable: false
argument-hint: "[machine | all]"
capabilities:
  - shell
  - read-files
---

# Fleet Status

Body content here.`;

    const result = parseSkillFrontmatter(content);
    expect(result.frontmatter.name).toBe("fleet-status");
    expect(result.frontmatter.description).toBe("Check fleet health.");
    expect(result.frontmatter.category).toBe("identity");
    expect(result.frontmatter.invocable).toBe(false);
    expect(result.frontmatter["argument-hint"]).toBe("[machine | all]");
    expect(result.frontmatter.capabilities).toEqual(["shell", "read-files"]);
    expect(result.body).toBe("\n# Fleet Status\n\nBody content here.");
  });

  test("handles missing optional fields", () => {
    const content = `---
name: test-skill
description: A test.
capabilities:
  - shell
---

Body.`;

    const result = parseSkillFrontmatter(content);
    expect(result.frontmatter.name).toBe("test-skill");
    expect(result.frontmatter.invocable).toBeUndefined();
    expect(result.frontmatter["argument-hint"]).toBeUndefined();
  });
});

describe("mapCapabilitiesToTools", () => {
  test("maps shell to Bash", () => {
    expect(mapCapabilitiesToTools(["shell"])).toEqual(["Bash"]);
  });

  test("maps read-files to Read, Glob, Grep", () => {
    expect(mapCapabilitiesToTools(["read-files"])).toEqual([
      "Read",
      "Glob",
      "Grep",
    ]);
  });

  test("maps write-files to Write, Edit", () => {
    expect(mapCapabilitiesToTools(["write-files"])).toEqual(["Write", "Edit"]);
  });

  test("maps web-search to WebSearch", () => {
    expect(mapCapabilitiesToTools(["web-search"])).toEqual(["WebSearch"]);
  });

  test("maps web-fetch to WebFetch", () => {
    expect(mapCapabilitiesToTools(["web-fetch"])).toEqual(["WebFetch"]);
  });

  test("maps ask-user to AskUserQuestion", () => {
    expect(mapCapabilitiesToTools(["ask-user"])).toEqual(["AskUserQuestion"]);
  });

  test("maps spawn-agents to Agent", () => {
    expect(mapCapabilitiesToTools(["spawn-agents"])).toEqual(["Agent"]);
  });

  test("maps invoke-skills to Skill", () => {
    expect(mapCapabilitiesToTools(["invoke-skills"])).toEqual(["Skill"]);
  });

  test("combines multiple capabilities and deduplicates", () => {
    const tools = mapCapabilitiesToTools(["shell", "read-files", "shell"]);
    expect(tools).toEqual(["Bash", "Read", "Glob", "Grep"]);
  });

  test("throws on unknown capability", () => {
    expect(() => mapCapabilitiesToTools(["unknown-cap"])).toThrow(
      "Unknown capability: unknown-cap"
    );
  });
});

describe("mergeOverrides", () => {
  test("returns base tools when no override", () => {
    const result = mergeOverrides(["Bash", "Read"], undefined);
    expect(result.allowedTools).toBe("Bash, Read");
    expect(result.extraFrontmatter).toEqual({});
  });

  test("replaces tools with allowed-tools-override", () => {
    const override = { "allowed-tools-override": "Bash(seed *)" };
    const result = mergeOverrides(["Bash", "Read"], override);
    expect(result.allowedTools).toBe("Bash(seed *)");
  });

  test("merges extra-frontmatter", () => {
    const override = {
      "extra-frontmatter": { "user-invocable": true },
    };
    const result = mergeOverrides(["Bash"], override);
    expect(result.allowedTools).toBe("Bash");
    expect(result.extraFrontmatter).toEqual({ "user-invocable": true });
  });
});

describe("renderSkillMd", () => {
  test("renders correct Claude SKILL.md", () => {
    const result = renderSkillMd({
      name: "fleet-status",
      description: "Check fleet health.",
      allowedTools: "Bash, Read",
      argumentHint: '[machine | "all"]',
      userInvocable: false,
      body: "\n# Fleet Status\n\nDo the thing.",
      sourcePath: "packages/skills/fleet-status/skill.md",
    });

    expect(result).toContain("---\nname: fleet-status");
    expect(result).toContain("description: Check fleet health.");
    expect(result).toContain("allowed-tools: Bash, Read");
    expect(result).toContain('argument-hint: [machine | "all"]');
    expect(result).not.toContain("user-invocable");
    expect(result).toContain(
      "<!-- Rendered from packages/skills/fleet-status/skill.md"
    );
    expect(result).toContain("# Fleet Status");
    expect(result).toContain("Do the thing.");
  });

  test("includes user-invocable when true", () => {
    const result = renderSkillMd({
      name: "test",
      description: "Test.",
      allowedTools: "Bash",
      userInvocable: true,
      body: "\nBody.",
      sourcePath: "packages/skills/test/skill.md",
    });

    expect(result).toContain("user-invocable: true");
  });
});

describe("renderAll (integration)", () => {
  test("renders a skill from source to output", async () => {
    const skillDir = join(srcDir, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skill.md"),
      `---
name: my-skill
description: Does things.
capabilities:
  - shell
  - read-files
---

# My Skill

Instructions here.`
    );

    const results = await renderAll({ srcDir, outDir, dryRun: false });

    expect(results.rendered).toContain("my-skill");
    expect(results.skipped).toHaveLength(0);
    expect(results.errors).toHaveLength(0);

    const output = await readFile(
      join(outDir, "my-skill", "SKILL.md"),
      "utf-8"
    );
    expect(output).toContain("name: my-skill");
    expect(output).toContain("allowed-tools: Bash, Read, Glob, Grep");
    expect(output).toContain("# My Skill");
    expect(output).toContain("Instructions here.");
    expect(output).toContain("<!-- Rendered from");
  });

  test("dry-run produces no files", async () => {
    const skillDir = join(srcDir, "dry-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skill.md"),
      `---
name: dry-skill
description: Dry run test.
capabilities:
  - shell
---

Body.`
    );

    const results = await renderAll({ srcDir, outDir, dryRun: true });

    expect(results.rendered).toContain("dry-skill");

    const outExists = await Bun.file(
      join(outDir, "dry-skill", "SKILL.md")
    ).exists();
    expect(outExists).toBe(false);
  });

  test("copies supporting files", async () => {
    const skillDir = join(srcDir, "with-extras");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skill.md"),
      `---
name: with-extras
description: Has extra files.
capabilities:
  - shell
---

Body.`
    );
    await writeFile(join(skillDir, "helper.sh"), "#!/bin/bash\necho hi");
    await writeFile(join(skillDir, "config.json"), '{"key": "value"}');

    const results = await renderAll({ srcDir, outDir, dryRun: false });

    expect(results.rendered).toContain("with-extras");

    const helper = await readFile(
      join(outDir, "with-extras", "helper.sh"),
      "utf-8"
    );
    expect(helper).toBe("#!/bin/bash\necho hi");

    const config = await readFile(
      join(outDir, "with-extras", "config.json"),
      "utf-8"
    );
    expect(config).toBe('{"key": "value"}');
  });

  test("skips directories without skill.md", async () => {
    const skillDir = join(srcDir, "empty-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "README.md"), "Not a skill");

    const results = await renderAll({ srcDir, outDir, dryRun: false });

    expect(results.skipped).toContain("empty-skill");
    expect(results.rendered).toHaveLength(0);
  });

  test("applies claude.json overrides", async () => {
    const skillDir = join(srcDir, "overridden");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skill.md"),
      `---
name: overridden
description: Has overrides.
capabilities:
  - shell
---

Body.`
    );
    await writeFile(
      join(skillDir, "claude.json"),
      JSON.stringify({
        "allowed-tools-override": "Bash(seed *)",
        "extra-frontmatter": { "user-invocable": true },
      })
    );

    const results = await renderAll({ srcDir, outDir, dryRun: false });

    expect(results.rendered).toContain("overridden");

    const output = await readFile(
      join(outDir, "overridden", "SKILL.md"),
      "utf-8"
    );
    expect(output).toContain("allowed-tools: Bash(seed *)");
    expect(output).toContain("user-invocable: true");
    // claude.json should NOT be copied to output
    const claudeJsonExists = await Bun.file(
      join(outDir, "overridden", "claude.json")
    ).exists();
    expect(claudeJsonExists).toBe(false);
  });

  test("renders only specified skill with --skill filter", async () => {
    const skill1 = join(srcDir, "skill-a");
    const skill2 = join(srcDir, "skill-b");
    await mkdir(skill1, { recursive: true });
    await mkdir(skill2, { recursive: true });
    await writeFile(
      join(skill1, "skill.md"),
      `---
name: skill-a
description: A.
capabilities:
  - shell
---

A body.`
    );
    await writeFile(
      join(skill2, "skill.md"),
      `---
name: skill-b
description: B.
capabilities:
  - shell
---

B body.`
    );

    const results = await renderAll({
      srcDir,
      outDir,
      dryRun: false,
      skillFilter: "skill-a",
    });

    expect(results.rendered).toEqual(["skill-a"]);

    const aExists = await Bun.file(
      join(outDir, "skill-a", "SKILL.md")
    ).exists();
    expect(aExists).toBe(true);

    const bExists = await Bun.file(
      join(outDir, "skill-b", "SKILL.md")
    ).exists();
    expect(bExists).toBe(false);
  });
});
