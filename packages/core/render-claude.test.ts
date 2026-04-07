import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderClaude, stripBootHeader } from "./render-claude";

// Minimal BOOT.md content for testing
const BOOT_MD = `# Seed Boot Contract

This file is the host-neutral source of truth for how Seed boots a relationship.

Host-specific entrypoints such as \`CLAUDE.md\` should adapt this contract to their own syntax and capabilities. They should not redefine it.

## Purpose

Seed is a continuity system. The boot contract tells a host runtime how to:

- continue an existing relationship honestly
- begin a new relationship without forcing a persona

## Known Failure Modes

These are failure modes discovered through extended operation.

### The Rumination Problem

Persistent identities default to introspection over building.

## Heartbeat Principles

The heartbeat is the autonomous pulse.

## Model Tiering

Right-size the model to the task.

## External Presence

### Publishing

If the installation enables publishing, follow these principles.

### Social Engagement

Social presence is optional.

## Adapter Guidance

Host-specific wrappers should only vary in:

- invocation format
- tool permission syntax
`;

const TEMPLATE = `# Seed

Seed is two things that share a repo.

---

## Architecture

### The packages

Some architecture content here.

---

## Boot Contract

@@BOOT_CONTRACT@@

### Claude-specific adapter notes

- Identity templates are available at \`packages/core/identity/*.template\` — use them as structural guides, not scripts to fill in mechanically. Read \`setup/first-conversation.md\` for principles.
- Claude adapter skills live in \`.claude/skills/\`. Treat them as an adapter surface, not the source of truth.

---

## Key docs

- \`docs/design-decisions.md\` — canonical list of architectural decisions.
`;

let tempDir: string;
let repoRoot: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "render-claude-test-"));
  repoRoot = tempDir;
  await mkdir(join(repoRoot, "packages", "core", "boot"), { recursive: true });
  await writeFile(join(repoRoot, "packages", "core", "boot", "BOOT.md"), BOOT_MD);
  await writeFile(join(repoRoot, "CLAUDE.md.template"), TEMPLATE);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("stripBootHeader", () => {
  test("strips the header paragraph ending with 'They should not redefine it.'", () => {
    const stripped = stripBootHeader(BOOT_MD);
    expect(stripped).not.toContain("host-neutral source of truth");
    expect(stripped).not.toContain("They should not redefine it.");
    expect(stripped).not.toContain("# Seed Boot Contract");
  });

  test("preserves the body starting with ## Purpose", () => {
    const stripped = stripBootHeader(BOOT_MD);
    expect(stripped).toContain("## Purpose");
    expect(stripped).toContain("Seed is a continuity system.");
  });

  test("returns trimmed content (no leading blank lines)", () => {
    const stripped = stripBootHeader(BOOT_MD);
    expect(stripped.startsWith("##")).toBe(true);
  });
});

describe("renderClaude", () => {
  test("render produces valid output with no @@BOOT_CONTRACT@@ token remaining", async () => {
    const output = await renderClaude({ repoRoot, dryRun: false });
    expect(output).not.toContain("@@BOOT_CONTRACT@@");
  });

  test("output contains BOOT.md content (Known Failure Modes section)", async () => {
    const output = await renderClaude({ repoRoot, dryRun: false });
    expect(output).toContain("Known Failure Modes");
    expect(output).toContain("The Rumination Problem");
  });

  test("output contains other BOOT.md sections", async () => {
    const output = await renderClaude({ repoRoot, dryRun: false });
    expect(output).toContain("Heartbeat Principles");
    expect(output).toContain("Model Tiering");
    expect(output).toContain("External Presence");
    expect(output).toContain("Social Engagement");
  });

  test("BOOT.md header is stripped from rendered output", async () => {
    const output = await renderClaude({ repoRoot, dryRun: false });
    expect(output).not.toContain("host-neutral source of truth");
    expect(output).not.toContain("They should not redefine it.");
  });

  test("Claude-specific adapter notes are preserved", async () => {
    const output = await renderClaude({ repoRoot, dryRun: false });
    expect(output).toContain("### Claude-specific adapter notes");
    expect(output).toContain("Identity templates are available at");
    expect(output).toContain("Claude adapter skills live in `.claude/skills/`");
  });

  test("non-boot-contract sections of CLAUDE.md are unchanged", async () => {
    const output = await renderClaude({ repoRoot, dryRun: false });
    // Architecture section
    expect(output).toContain("## Architecture");
    expect(output).toContain("Some architecture content here.");
    // Key docs section
    expect(output).toContain("## Key docs");
    expect(output).toContain("docs/design-decisions.md");
    // Header
    expect(output).toContain("# Seed");
    expect(output).toContain("Seed is two things that share a repo.");
  });

  test("rendered comment is inserted above boot contract content", async () => {
    const output = await renderClaude({ repoRoot, dryRun: false });
    expect(output).toContain("<!-- Rendered from packages/core/boot/BOOT.md");
    expect(output).toContain("edit the source, not this file");
  });

  test("dry-run returns output but does not write CLAUDE.md", async () => {
    const output = await renderClaude({ repoRoot, dryRun: true });
    // Should still return valid output
    expect(output).toContain("Known Failure Modes");
    expect(output).not.toContain("@@BOOT_CONTRACT@@");

    // CLAUDE.md should not exist (we only wrote the template)
    const claudeMdExists = await Bun.file(join(repoRoot, "CLAUDE.md")).exists();
    expect(claudeMdExists).toBe(false);
  });

  test("non-dry-run writes CLAUDE.md to disk", async () => {
    await renderClaude({ repoRoot, dryRun: false });

    const written = await readFile(join(repoRoot, "CLAUDE.md"), "utf-8");
    expect(written).toContain("Known Failure Modes");
    expect(written).not.toContain("@@BOOT_CONTRACT@@");
  });
});
