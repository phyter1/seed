import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

const TOKEN = "@@BOOT_CONTRACT@@";
const RENDERED_COMMENT =
  "<!-- Rendered from packages/core/boot/BOOT.md — edit the source, not this file -->";

/**
 * Strip the BOOT.md header: the title, blank lines, and the introductory
 * paragraph ending with "They should not redefine it." — these are
 * meta-instructions for template authors, not boot instructions.
 */
export function stripBootHeader(bootContent: string): string {
  // Find the first ## heading — everything before it is header
  const firstSection = bootContent.indexOf("\n## ");
  if (firstSection === -1) {
    // No sections found — return as-is (shouldn't happen with real BOOT.md)
    return bootContent;
  }
  return bootContent.slice(firstSection).trimStart();
}

interface RenderOptions {
  repoRoot: string;
  dryRun: boolean;
}

/**
 * Render CLAUDE.md from CLAUDE.md.template + BOOT.md.
 * Returns the rendered content. Writes to CLAUDE.md unless dryRun is true.
 */
export async function renderClaude(options: RenderOptions): Promise<string> {
  const { repoRoot, dryRun } = options;

  const templatePath = join(repoRoot, "CLAUDE.md.template");
  const bootPath = join(repoRoot, "packages", "core", "boot", "BOOT.md");
  const outputPath = join(repoRoot, "CLAUDE.md");

  const [template, bootRaw] = await Promise.all([
    readFile(templatePath, "utf-8"),
    readFile(bootPath, "utf-8"),
  ]);

  const bootBody = stripBootHeader(bootRaw);
  const rendered = template.replace(
    TOKEN,
    `${RENDERED_COMMENT}\n\n${bootBody}`
  );

  if (!dryRun) {
    await writeFile(outputPath, rendered);
  }

  return rendered;
}

// --- CLI entry point ---

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "dry-run": { type: "boolean", default: false },
    },
  });

  const dryRun = values["dry-run"] ?? false;
  // Resolve repo root: this file lives at packages/core/render-claude.ts
  const repoRoot = join(import.meta.dir, "..", "..");

  const output = await renderClaude({ repoRoot, dryRun });

  if (dryRun) {
    console.log(output);
  } else {
    console.log("Rendered CLAUDE.md from CLAUDE.md.template + BOOT.md");
  }
}

if (import.meta.main) {
  main();
}
