import { describe, expect, test } from "bun:test";
import { getHostAdapter } from "../index";
import { geminiAdapter } from "./gemini";

describe("geminiAdapter", () => {
  test("static properties match expected values", () => {
    expect(geminiAdapter.id).toBe("gemini");
    expect(geminiAdapter.displayName).toBe("Gemini CLI");
    expect(geminiAdapter.command).toBe("gemini");
    expect(geminiAdapter.capabilities).toEqual([
      "interactive",
      "headless",
      "heartbeat",
      "mcp",
      "tool_permissions",
      "structured_output",
    ]);
  });

  test("is registered in the host adapter registry", () => {
    const adapter = getHostAdapter("gemini");
    expect(adapter).toBe(geminiAdapter);
  });

  test("runHeadless() returns correct command and args", () => {
    const plan = geminiAdapter.runHeadless({
      prompt: "Say hello",
      model: "gemini-2.0-flash",
      outputFormat: "json",
    });
    expect(plan.command).toBe("gemini");
    expect(plan.args).toContain("-p");
    expect(plan.args).toContain("Say hello");
    expect(plan.args).toContain("--model");
    expect(plan.args).toContain("gemini-2.0-flash");
    expect(plan.args).toContain("--output-format");
    expect(plan.args).toContain("json");
  });

  test("runHeadless() with stream-json output format", () => {
    const plan = geminiAdapter.runHeadless({
      prompt: "stream test",
      outputFormat: "stream-json",
    });
    expect(plan.args).toContain("--output-format");
    expect(plan.args).toContain("stream-json");
  });

  test("runHeadless() with minimal options", () => {
    const plan = geminiAdapter.runHeadless({ prompt: "ping" });
    expect(plan.command).toBe("gemini");
    expect(plan.args).toEqual(["-p", "ping"]);
  });

  test("runInteractive() returns correct plan", () => {
    const plan = geminiAdapter.runInteractive({ model: "gemini-2.0-flash" });
    expect(plan.command).toBe("gemini");
    expect(plan.args).toContain("--model");
    expect(plan.args).toContain("gemini-2.0-flash");
  });

  test("runInteractive() with no options", () => {
    const plan = geminiAdapter.runInteractive();
    expect(plan.command).toBe("gemini");
    expect(plan.args).toEqual([]);
  });

  test("renderBootFile() returns GEMINI.md target", () => {
    const result = geminiAdapter.renderBootFile("BOOT.md");
    expect(result.targetPath).toBe("GEMINI.md");
    expect(result.notes.length).toBeGreaterThan(0);
  });
});
