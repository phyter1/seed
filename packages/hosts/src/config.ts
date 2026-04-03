import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostId } from "./types";

interface SeedConfig {
  host?: {
    default?: HostId;
    heartbeat?: HostId;
  };
  heartbeat?: {
    host?: HostId;
    model?: string;
  };
}

export interface ResolvedHeartbeatConfig {
  host: HostId;
  model?: string;
  configPath?: string;
}

export function resolveHeartbeatConfig(seedDir: string, overrides?: { host?: string; model?: string }): ResolvedHeartbeatConfig {
  const configPath = join(seedDir, "seed.config.json");

  let fileConfig: SeedConfig = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, "utf-8")) as SeedConfig;
    } catch (error) {
      throw new Error(`Failed to parse ${configPath}: ${(error as Error).message}`);
    }
  }

  const host = (overrides?.host as HostId | undefined)
    ?? fileConfig.heartbeat?.host
    ?? fileConfig.host?.heartbeat
    ?? fileConfig.host?.default
    ?? "claude";

  const model = overrides?.model ?? fileConfig.heartbeat?.model;

  return { host, model, configPath: existsSync(configPath) ? configPath : undefined };
}
