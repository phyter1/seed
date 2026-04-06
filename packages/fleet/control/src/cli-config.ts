/**
 * CLI config resolution — extracted from cli.ts for testability.
 *
 * Resolution cascade:
 *   getControlUrl():    env var → cli.json → agent.json → DEFAULT
 *   getOperatorToken(): env var → cli.json → undefined
 *
 * Agent tokens and operator tokens are different auth contexts —
 * the operator token is never read from agent.json.
 */

import { readFileSync } from "fs";
import { join } from "path";

export const DEFAULT_CONTROL_URL = "http://localhost:4310";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function cliConfigPath(): string {
  return (
    process.env.SEED_CLI_CONFIG ??
    join(process.env.HOME ?? "", ".config/seed-fleet/cli.json")
  );
}

export function agentConfigPath(): string {
  return (
    process.env.SEED_AGENT_CONFIG ??
    join(process.env.HOME ?? "", ".config/seed-fleet/agent.json")
  );
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export interface CliConfigFile {
  control_url?: string;
  operator_token?: string;
}

export function readCliConfig(): CliConfigFile {
  try {
    const text = readFileSync(cliConfigPath(), "utf-8");
    const parsed = JSON.parse(text);
    return {
      control_url: parsed.control_url,
      operator_token: parsed.operator_token,
    };
  } catch {
    return {};
  }
}

/** Normalize a control URL to http(s) for REST calls. */
export function toHttpUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "");
  if (/^wss:\/\//i.test(trimmed)) return "https://" + trimmed.slice(6);
  if (/^ws:\/\//i.test(trimmed)) return "http://" + trimmed.slice(5);
  return trimmed;
}

export function readAgentControlUrl(): string | undefined {
  try {
    const text = readFileSync(agentConfigPath(), "utf-8");
    const parsed = JSON.parse(text);
    return parsed.control_url ? toHttpUrl(parsed.control_url) : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public resolution functions
// ---------------------------------------------------------------------------

export function getControlUrl(): string {
  return (
    process.env.SEED_CONTROL_URL ??
    readCliConfig().control_url ??
    readAgentControlUrl() ??
    DEFAULT_CONTROL_URL
  );
}

export function getOperatorToken(): string | undefined {
  return process.env.SEED_OPERATOR_TOKEN ?? readCliConfig().operator_token;
}
