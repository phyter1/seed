import type { HostAdapter, HostInvocationOptions } from "../types";
import { detectCommand } from "../utils";

export const codexAdapter: HostAdapter = {
  id: "codex",
  displayName: "Codex CLI",
  command: "codex",
  capabilities: ["interactive", "headless", "mcp", "tool_permissions", "structured_output"],

  async detect() {
    const detection = await detectCommand("codex");
    return {
      installed: detection.installed,
      command: "codex",
      version: detection.version,
      notes: detection.installed
        ? ["Codex is a host adapter, not a generic provider router.", "Use Seed runtime for non-OpenAI provider mixing."]
        : ["Codex CLI not found on PATH."],
    };
  },

  runInteractive(options = {}) {
    const args = [];
    if (options.model) args.push("--model", options.model);
    if (options.extraArgs?.length) args.push(...options.extraArgs);

    return {
      command: "codex",
      args,
      notes: ["Run from the Seed repo root so the Codex boot wrapper can be loaded once added."],
    };
  },

  runHeadless(options: HostInvocationOptions) {
    const args = ["exec", options.prompt];
    if (options.model) args.push("--model", options.model);
    if (options.outputFormat === "json") args.push("--json");
    if (options.extraArgs?.length) args.push(...options.extraArgs);

    return {
      command: "codex",
      args,
      notes: ["Codex headless flow uses exec.", "Approval/tool semantics should be normalized in a later dispatch layer."],
    };
  },

  renderBootFile(sourcePath: string) {
    return {
      targetPath: "CODEX.md",
      notes: [`Render Codex-specific wrapper from ${sourcePath}.`],
    };
  },
};
