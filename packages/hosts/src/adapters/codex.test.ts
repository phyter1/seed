import { describe, expect, test } from "bun:test";
import { getHostAdapter } from "../index";
import { codexAdapter } from "./codex";

describe("codexAdapter", () => {
  test("static properties match expected values", () => {
    expect(codexAdapter.id).toBe("codex");
    expect(codexAdapter.displayName).toBe("Codex CLI");
    expect(codexAdapter.command).toBe("codex");
    expect(codexAdapter.capabilities).toEqual([
      "interactive",
      "headless",
      "heartbeat",
      "mcp",
      "tool_permissions",
      "structured_output",
    ]);
  });

  test("is registered in the host adapter registry", () => {
    const adapter = getHostAdapter("codex");
    expect(adapter).toBe(codexAdapter);
  });

  test("runHeadless() returns correct command and args", () => {
    const plan = codexAdapter.runHeadless({
      prompt: "Say hello",
      model: "o3",
      outputFormat: "json",
    });
    expect(plan.command).toBe("codex");
    expect(plan.args).toContain("exec");
    expect(plan.args).toContain("Say hello");
    expect(plan.args).toContain("--model");
    expect(plan.args).toContain("o3");
    expect(plan.args).toContain("--json");
  });

  test("runHeadless() with minimal options", () => {
    const plan = codexAdapter.runHeadless({ prompt: "ping" });
    expect(plan.command).toBe("codex");
    expect(plan.args).toEqual(["exec", "ping"]);
  });

  test("runInteractive() returns correct plan", () => {
    const plan = codexAdapter.runInteractive({ model: "o3" });
    expect(plan.command).toBe("codex");
    expect(plan.args).toContain("--model");
    expect(plan.args).toContain("o3");
  });

  test("runInteractive() with no options", () => {
    const plan = codexAdapter.runInteractive();
    expect(plan.command).toBe("codex");
    expect(plan.args).toEqual([]);
  });

  test("renderBootFile() returns CODEX.md target", () => {
    const result = codexAdapter.renderBootFile("BOOT.md");
    expect(result.targetPath).toBe("CODEX.md");
    expect(result.notes.length).toBeGreaterThan(0);
  });
});
