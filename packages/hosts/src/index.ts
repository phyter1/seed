import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";
import { geminiAdapter } from "./adapters/gemini";
import type { HostAdapter, HostId } from "./types";

export const HOST_ADAPTERS: Record<HostId, HostAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
};

export function getHostAdapter(id: HostId): HostAdapter {
  return HOST_ADAPTERS[id];
}

export function listHostAdapters(): HostAdapter[] {
  return Object.values(HOST_ADAPTERS);
}

export type { HostAdapter, HostCapability, HostDetection, HostId, HostInvocationOptions, HostInvocationPlan } from "./types";
