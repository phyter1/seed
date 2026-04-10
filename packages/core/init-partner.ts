import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join, basename } from "node:path";
import { parseArgs } from "node:util";

const PARTNER_GITIGNORE_MARKER = "# Seed partner — identity files (local only)";

const PARTNER_GITIGNORE_BLOCK = `${PARTNER_GITIGNORE_MARKER}
self.md
continuity.md
convictions.md
projects.md
objectives.md
journal/entries/*.md
journal/summaries/*.md
!journal/entries/.gitkeep
!journal/summaries/.gitkeep
!journal/summaries/index.md
notes/inbox/*.md
notes/archive/*.md
!notes/inbox/.gitkeep
!notes/archive/.gitkeep
`;

export interface InitPartnerOptions {
  projectPath: string;
  partnerName: string;
  projectName: string;
  force: boolean;
  dryRun: boolean;
}

export interface InitPartnerResult {
  claudeMd: string;
  createdPaths: string[];
  gitignoreUpdated: boolean;
}

/**
 * Substitute name tokens in the partner template.
 * Replaces [Partner Name], [Name], and [Project Name].
 */
export function substituteTokens(
  template: string,
  partnerName: string,
  projectName: string
): string {
  return template
    .replaceAll("[Partner Name]", partnerName)
    .replaceAll("[Name]", partnerName)
    .replaceAll("[Project Name]", projectName);
}

/**
 * Merge Seed partner .gitignore entries into an existing .gitignore.
 * If the marker already exists, leaves it alone. Otherwise appends.
 * Returns the new content.
 */
export function mergeGitignore(existing: string): string {
  if (existing.includes(PARTNER_GITIGNORE_MARKER)) {
    return existing; // Already added
  }
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  return existing + separator + PARTNER_GITIGNORE_BLOCK;
}

/**
 * Initialize a Seed partner in a target project directory.
 */
export async function initPartner(
  options: InitPartnerOptions
): Promise<InitPartnerResult> {
  const { projectPath, partnerName, projectName, force, dryRun } = options;

  const templatePath = join(
    import.meta.dir,
    "identity",
    "partner-claude.md.template"
  );
  const outputClaudeMd = join(projectPath, "CLAUDE.md");

  // Check if CLAUDE.md already exists
  const claudeMdExists = await access(outputClaudeMd)
    .then(() => true)
    .catch(() => false);

  if (claudeMdExists && !force) {
    throw new Error(
      `CLAUDE.md already exists at ${outputClaudeMd}. Use --force to overwrite.`
    );
  }

  // Read and render the template
  const template = await readFile(templatePath, "utf-8");
  const rendered = substituteTokens(template, partnerName, projectName);

  const createdPaths: string[] = [];
  let gitignoreUpdated = false;

  if (!dryRun) {
    // Ensure project directory exists
    await mkdir(projectPath, { recursive: true });

    // Write CLAUDE.md
    await writeFile(outputClaudeMd, rendered, "utf-8");
    createdPaths.push(outputClaudeMd);

    // Create directory scaffolding
    const dirs = [
      join(projectPath, "journal", "entries"),
      join(projectPath, "journal", "summaries"),
      join(projectPath, "notes", "inbox"),
      join(projectPath, "notes", "archive"),
    ];

    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
      const gitkeep = join(dir, ".gitkeep");
      const gitkeepExists = await access(gitkeep)
        .then(() => true)
        .catch(() => false);
      if (!gitkeepExists) {
        await writeFile(gitkeep, "", "utf-8");
        createdPaths.push(gitkeep);
      }
    }

    // Also create journal/summaries/index.md if it doesn't exist
    const summariesIndex = join(
      projectPath,
      "journal",
      "summaries",
      "index.md"
    );
    const indexExists = await access(summariesIndex)
      .then(() => true)
      .catch(() => false);
    if (!indexExists) {
      await writeFile(
        summariesIndex,
        `# Journal Summaries\n\nNo entries yet. Summaries are written here as the journal grows.\n`,
        "utf-8"
      );
      createdPaths.push(summariesIndex);
    }

    // Merge .gitignore
    const gitignorePath = join(projectPath, ".gitignore");
    const gitignoreExists = await access(gitignorePath)
      .then(() => true)
      .catch(() => false);

    if (gitignoreExists) {
      const existing = await readFile(gitignorePath, "utf-8");
      if (!existing.includes(PARTNER_GITIGNORE_MARKER)) {
        await writeFile(gitignorePath, mergeGitignore(existing), "utf-8");
        gitignoreUpdated = true;
      }
    } else {
      await writeFile(
        gitignorePath,
        PARTNER_GITIGNORE_BLOCK,
        "utf-8"
      );
      createdPaths.push(gitignorePath);
      gitignoreUpdated = true;
    }
  }

  return { claudeMd: rendered, createdPaths, gitignoreUpdated };
}

// --- CLI entry point ---

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "project-path": { type: "string" },
      name: { type: "string" },
      "project-name": { type: "string" },
      force: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const projectPath = values["project-path"];
  if (!projectPath) {
    console.error("Error: --project-path is required");
    process.exit(1);
  }

  const projectName = values["project-name"] ?? basename(projectPath);
  const partnerName = values["name"] ?? "[TBD]";
  const force = values["force"] ?? false;
  const dryRun = values["dry-run"] ?? false;

  try {
    const result = await initPartner({
      projectPath,
      partnerName,
      projectName,
      force,
      dryRun,
    });

    if (dryRun) {
      console.log("--- CLAUDE.md (dry run) ---");
      console.log(result.claudeMd);
    } else {
      console.log(`✓ Partner initialized in ${projectPath}`);
      console.log(`  Name: ${partnerName}`);
      console.log(`  Project: ${projectName}`);
      console.log("");
      console.log("Created:");
      for (const p of result.createdPaths) {
        console.log(`  ${p}`);
      }
      if (result.gitignoreUpdated) {
        console.log("  .gitignore — updated with identity file exclusions");
      }
      console.log("");
      console.log("Next step:");
      console.log(`  cd ${projectPath} && claude`);
      console.log(
        "  The partner has no identity yet. Open a conversation and introduce yourself."
      );
      console.log(
        "  By the end, it will have written self.md and a first journal entry."
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
