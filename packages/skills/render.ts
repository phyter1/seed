import { readdir, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

// --- Capability → Claude Code tool mapping ---

const CAPABILITY_MAP: Record<string, string[]> = {
  shell: ["Bash"],
  "read-files": ["Read", "Glob", "Grep"],
  "write-files": ["Write", "Edit"],
  "web-search": ["WebSearch"],
  "web-fetch": ["WebFetch"],
  "ask-user": ["AskUserQuestion"],
  "spawn-agents": ["Agent"],
  "invoke-skills": ["Skill"],
};

export function mapCapabilitiesToTools(capabilities: string[]): string[] {
  const tools: string[] = [];
  for (const cap of capabilities) {
    const mapped = CAPABILITY_MAP[cap];
    if (!mapped) throw new Error(`Unknown capability: ${cap}`);
    for (const tool of mapped) {
      if (!tools.includes(tool)) tools.push(tool);
    }
  }
  return tools;
}

// --- Frontmatter parsing ---

interface SkillFrontmatter {
  name: string;
  description: string;
  category?: string;
  invocable?: boolean;
  "argument-hint"?: string;
  capabilities: string[];
  [key: string]: unknown;
}

export function parseSkillFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error("No frontmatter found");

  const raw = match[1];
  const body = match[2];

  // Simple YAML parser — handles our subset (scalars, lists, booleans)
  const fm: Record<string, unknown> = {};
  let currentKey = "";
  let currentList: string[] | null = null;

  for (const line of raw.split("\n")) {
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && currentKey) {
      if (!currentList) currentList = [];
      currentList.push(listItem[1]);
      continue;
    }

    // Flush previous list
    if (currentList) {
      fm[currentKey] = currentList;
      currentList = null;
    }

    const kv = line.match(/^([a-z-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      if (val === "") {
        // Possibly a list follows
        continue;
      }
      // Parse booleans
      if (val === "true") fm[currentKey] = true;
      else if (val === "false") fm[currentKey] = false;
      // Strip surrounding quotes
      else if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      )
        fm[currentKey] = val.slice(1, -1);
      else fm[currentKey] = val;
    }
  }

  // Flush final list
  if (currentList) {
    fm[currentKey] = currentList;
  }

  return { frontmatter: fm as unknown as SkillFrontmatter, body };
}

// --- Override merging ---

interface ClaudeOverride {
  "allowed-tools-override"?: string;
  "extra-frontmatter"?: Record<string, unknown>;
}

export function mergeOverrides(
  baseTools: string[],
  override: ClaudeOverride | undefined
): { allowedTools: string; extraFrontmatter: Record<string, unknown> } {
  if (!override) {
    return { allowedTools: baseTools.join(", "), extraFrontmatter: {} };
  }

  const allowedTools =
    override["allowed-tools-override"] ?? baseTools.join(", ");
  const extraFrontmatter = override["extra-frontmatter"] ?? {};

  return { allowedTools, extraFrontmatter };
}

// --- Render a single SKILL.md ---

interface RenderInput {
  name: string;
  description: string;
  allowedTools: string;
  argumentHint?: string;
  userInvocable?: boolean;
  body: string;
  sourcePath: string;
}

export function renderSkillMd(input: RenderInput): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${input.name}`);
  lines.push(`description: ${input.description}`);
  if (input.argumentHint) {
    lines.push(`argument-hint: ${input.argumentHint}`);
  }
  lines.push(`allowed-tools: ${input.allowedTools}`);
  if (input.userInvocable) {
    lines.push(`user-invocable: true`);
  }
  lines.push("---");
  lines.push("");
  lines.push(
    `<!-- Rendered from ${input.sourcePath} — edit the source, not this file -->`
  );
  lines.push(input.body);

  return lines.join("\n");
}

// --- Main render pipeline ---

interface RenderOptions {
  srcDir: string;
  outDir: string;
  dryRun: boolean;
  skillFilter?: string;
}

interface RenderResults {
  rendered: string[];
  skipped: string[];
  errors: string[];
}

export async function renderAll(options: RenderOptions): Promise<RenderResults> {
  const { srcDir, outDir, dryRun, skillFilter } = options;
  const results: RenderResults = { rendered: [], skipped: [], errors: [] };

  let entries: string[];
  try {
    entries = await readdir(srcDir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (skillFilter && entry !== skillFilter) continue;

    const skillSrcDir = join(srcDir, entry);
    const stat = await Bun.file(join(skillSrcDir, "skill.md")).exists();

    if (!stat) {
      // Check if it's actually a directory
      try {
        await readdir(skillSrcDir);
        results.skipped.push(entry);
      } catch {
        // Not a directory, skip silently
      }
      continue;
    }

    try {
      const sourceContent = await readFile(
        join(skillSrcDir, "skill.md"),
        "utf-8"
      );
      const { frontmatter, body } = parseSkillFrontmatter(sourceContent);

      const tools = mapCapabilitiesToTools(frontmatter.capabilities);

      // Check for claude.json override
      let override: ClaudeOverride | undefined;
      const claudeJsonPath = join(skillSrcDir, "claude.json");
      if (await Bun.file(claudeJsonPath).exists()) {
        override = JSON.parse(await readFile(claudeJsonPath, "utf-8"));
      }

      const { allowedTools, extraFrontmatter } = mergeOverrides(
        tools,
        override
      );

      const rendered = renderSkillMd({
        name: frontmatter.name,
        description: frontmatter.description,
        allowedTools,
        argumentHint: frontmatter["argument-hint"],
        userInvocable:
          (extraFrontmatter["user-invocable"] as boolean) ??
          (frontmatter.invocable === true ? true : undefined),
        body,
        sourcePath: `packages/skills/${entry}/skill.md`,
      });

      if (!dryRun) {
        const outSkillDir = join(outDir, entry);
        await mkdir(outSkillDir, { recursive: true });
        await writeFile(join(outSkillDir, "SKILL.md"), rendered);

        // Copy supporting files (everything except skill.md and claude.json)
        const files = await readdir(skillSrcDir);
        for (const file of files) {
          if (file === "skill.md" || file === "claude.json") continue;
          await copyFile(join(skillSrcDir, file), join(outSkillDir, file));
        }
      }

      results.rendered.push(entry);
    } catch (err) {
      results.errors.push(
        `${entry}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return results;
}

// --- CLI entry point ---

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "dry-run": { type: "boolean", default: false },
      skill: { type: "string" },
    },
  });

  // Resolve paths relative to repo root (two levels up from this file)
  const repoRoot = join(import.meta.dir, "..", "..");
  const srcDir = join(repoRoot, "packages", "skills");
  const outDir = join(repoRoot, ".claude", "skills");

  const dryRun = values["dry-run"] ?? false;
  const skillFilter = values.skill;

  if (dryRun) {
    console.log("Dry run — no files will be written.\n");
  }

  const results = await renderAll({ srcDir, outDir, dryRun, skillFilter });

  // Summary
  if (results.rendered.length > 0) {
    console.log(
      `Rendered (${results.rendered.length}): ${results.rendered.join(", ")}`
    );
  }
  if (results.skipped.length > 0) {
    console.log(
      `Skipped (${results.skipped.length}): ${results.skipped.join(", ")}`
    );
  }
  if (results.errors.length > 0) {
    console.log(`Errors (${results.errors.length}):`);
    for (const err of results.errors) {
      console.log(`  ${err}`);
    }
    process.exit(1);
  }

  if (results.rendered.length === 0 && results.skipped.length === 0) {
    console.log("No skills found.");
  }
}

// Only run CLI when executed directly
if (import.meta.main) {
  main();
}
