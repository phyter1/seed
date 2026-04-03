export type HostId = "claude" | "codex" | "gemini";

export type HostCapability =
  | "interactive"
  | "headless"
  | "heartbeat"
  | "mcp"
  | "tool_permissions"
  | "structured_output";

export interface HostDetection {
  installed: boolean;
  command: string;
  version?: string;
  notes?: string[];
}

export interface HostInvocationOptions {
  prompt: string;
  model?: string;
  workingDirectory?: string;
  outputFormat?: "text" | "json" | "stream-json";
  allowTools?: string[];
  extraArgs?: string[];
}

export interface HostInvocationPlan {
  command: string;
  args: string[];
  notes?: string[];
}

export interface HostAdapter {
  id: HostId;
  displayName: string;
  command: string;
  capabilities: HostCapability[];
  detect(): Promise<HostDetection>;
  runInteractive(options?: { model?: string; workingDirectory?: string; extraArgs?: string[] }): HostInvocationPlan;
  runHeadless(options: HostInvocationOptions): HostInvocationPlan;
  renderBootFile(sourcePath: string): { targetPath: string; notes: string[] };
}
