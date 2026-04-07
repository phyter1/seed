import { describe, expect, test } from "bun:test";
import { getHostAdapter } from "../index";
import { claudeAdapter } from "./claude";

describe("claudeAdapter", () => {
  test("static properties match expected values", () => {
    expect(claudeAdapter.id).toBe("claude");
    expect(claudeAdapter.displayName).toBe("Claude Code");
    expect(claudeAdapter.command).toBe("claude");
    expect(claudeAdapter.capabilities).toEqual([
      "interactive",
      "headless",
      "heartbeat",
      "mcp",
      "tool_permissions",
      "structured_output",
    ]);
  });

  test("is registered in the host adapter registry", () => {
    const adapter = getHostAdapter("claude");
    expect(adapter).toBe(claudeAdapter);
  });

  test("runHeadless() returns correct command and args", () => {
    const plan = claudeAdapter.runHeadless({
      prompt: "Say hello",
      model: "opus",
      outputFormat: "json",
      allowTools: ["Read", "Write"],
    });
    expect(plan.command).toBe("claude");
    expect(plan.args).toContain("-p");
    expect(plan.args).toContain("Say hello");
    expect(plan.args).toContain("--model");
    expect(plan.args).toContain("opus");
    expect(plan.args).toContain("--output-format");
    expect(plan.args).toContain("json");
    expect(plan.args).toContain("--allowedTools");
    expect(plan.args).toContain("Read,Write");
  });

  test("runHeadless() with minimal options", () => {
    const plan = claudeAdapter.runHeadless({ prompt: "ping" });
    expect(plan.command).toBe("claude");
    expect(plan.args).toEqual(["-p", "ping"]);
  });

  test("runInteractive() returns correct plan", () => {
    const plan = claudeAdapter.runInteractive({ model: "sonnet" });
    expect(plan.command).toBe("claude");
    expect(plan.args).toContain("--model");
    expect(plan.args).toContain("sonnet");
  });

  test("runInteractive() with no options", () => {
    const plan = claudeAdapter.runInteractive();
    expect(plan.command).toBe("claude");
    expect(plan.args).toEqual([]);
  });

  test("renderBootFile() returns CLAUDE.md target", () => {
    const result = claudeAdapter.renderBootFile("BOOT.md");
    expect(result.targetPath).toBe("CLAUDE.md");
    expect(result.notes.length).toBeGreaterThan(0);
  });
});
