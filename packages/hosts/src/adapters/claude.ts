import type { HostAdapter, HostInvocationOptions } from "../types";
import { detectCommand } from "../utils";

export const claudeAdapter: HostAdapter = {
  id: "claude",
  displayName: "Claude Code",
  command: "claude",
  capabilities: ["interactive", "headless", "heartbeat", "mcp", "tool_permissions", "structured_output"],

  async detect() {
    const detection = await detectCommand("claude");
    return {
      installed: detection.installed,
      command: "claude",
      version: detection.version,
      notes: detection.installed
        ? ["Primary Seed adapter today.", "Supports headless execution and tool permissions."]
        : ["Claude Code CLI not found on PATH."],
    };
  },

  runInteractive(options = {}) {
    const args = [];
    if (options.model) args.push("--model", options.model);
    if (options.extraArgs?.length) args.push(...options.extraArgs);

    return {
      command: "claude",
      args,
      notes: ["Run from the Seed repo root so CLAUDE.md is loaded by the host."],
    };
  },

  runHeadless(options: HostInvocationOptions) {
    const args = ["-p", options.prompt];
    if (options.model) args.push("--model", options.model);
    if (options.allowTools?.length) args.push("--allowedTools", options.allowTools.join(","));
    if (options.outputFormat === "json") args.push("--output-format", "json");
    if (options.extraArgs?.length) args.push(...options.extraArgs);

    return {
      command: "claude",
      args,
      notes: ["Claude supports direct headless invocation and explicit tool permission syntax."],
    };
  },

  renderBootFile(sourcePath: string) {
    return {
      targetPath: "CLAUDE.md",
      notes: [`Render Claude-specific wrapper from ${sourcePath}.`],
    };
  },
};
