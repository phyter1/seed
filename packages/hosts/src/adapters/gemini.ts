import type { HostAdapter, HostInvocationOptions } from "../types";
import { detectCommand } from "../utils";

const activeProbeEnabled = process.env.SEED_HOST_PROBE === "active";

export const geminiAdapter: HostAdapter = {
  id: "gemini",
  displayName: "Gemini CLI",
  command: "gemini",
  capabilities: ["interactive", "headless", "heartbeat", "mcp", "tool_permissions", "structured_output"],

  async detect() {
    const detection = await detectCommand("gemini", {
      readinessProbe: activeProbeEnabled
        ? {
            args: ["-p", "Reply with OK only.", "--output-format", "json"],
            timeoutMs: 20_000,
          }
        : undefined,
    });
    return {
      installed: detection.installed,
      ready: detection.ready,
      status: detection.status,
      command: "gemini",
      version: detection.version,
      reason: detection.reason,
      notes: detection.installed
        ? [
            "Gemini supports headless prompts and structured output modes.",
            activeProbeEnabled ? "Active readiness probe enabled." : "Passive detection only; auth state may still block execution.",
          ]
        : ["Gemini CLI not found on PATH."],
    };
  },

  runInteractive(options = {}) {
    const args = [];
    if (options.model) args.push("--model", options.model);
    if (options.extraArgs?.length) args.push(...options.extraArgs);

    return {
      command: "gemini",
      args,
      notes: ["Run from the Seed repo root so the Gemini boot wrapper can be loaded once added."],
    };
  },

  runHeadless(options: HostInvocationOptions) {
    const args = ["-p", options.prompt];
    if (options.model) args.push("--model", options.model);
    if (options.outputFormat === "json") args.push("--output-format", "json");
    if (options.outputFormat === "stream-json") args.push("--output-format", "stream-json");
    if (options.extraArgs?.length) args.push(...options.extraArgs);

    return {
      command: "gemini",
      args,
      notes: ["Gemini headless flow uses -p.", "Sub-agent model overrides need separate handling in later runtime layers."],
    };
  },

  renderBootFile(sourcePath: string) {
    return {
      targetPath: "GEMINI.md",
      notes: [`Render Gemini-specific wrapper from ${sourcePath}.`],
    };
  },
};
