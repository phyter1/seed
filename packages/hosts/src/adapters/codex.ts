import type { HostAdapter, HostInvocationOptions } from "../types";
import { detectCommand } from "../utils";

const activeProbeEnabled = process.env.SEED_HOST_PROBE === "active";

export const codexAdapter: HostAdapter = {
  id: "codex",
  displayName: "Codex CLI",
  command: "codex",
  capabilities: ["interactive", "headless", "heartbeat", "mcp", "tool_permissions", "structured_output"],

  async detect() {
    const detection = await detectCommand("codex", {
      readinessProbe: activeProbeEnabled
        ? {
            args: ["exec", "Reply with OK only.", "--json"],
            timeoutMs: 20_000,
          }
        : undefined,
    });
    return {
      installed: detection.installed,
      ready: detection.ready,
      status: detection.status,
      command: "codex",
      version: detection.version,
      reason: detection.reason,
      notes: detection.installed
        ? [
            "Codex is a host adapter, not a generic provider router.",
            "Use Seed runtime for non-OpenAI provider mixing.",
            activeProbeEnabled ? "Active readiness probe enabled." : "Passive detection only; backend/auth state may still block execution.",
          ]
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
