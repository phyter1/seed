import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { getHostAdapter } from "./index";
import { resolveHeartbeatConfig } from "./config";
import type { HostId } from "./types";

interface CliArgs {
  seedDir: string;
  promptFile: string;
  host?: string;
  model?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: Partial<CliArgs> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--seed-dir" && next) {
      parsed.seedDir = next;
      i += 1;
    } else if (arg === "--prompt-file" && next) {
      parsed.promptFile = next;
      i += 1;
    } else if (arg === "--host" && next) {
      parsed.host = next;
      i += 1;
    } else if (arg === "--model" && next) {
      parsed.model = next;
      i += 1;
    }
  }

  if (!parsed.seedDir) {
    throw new Error("--seed-dir is required");
  }
  if (!parsed.promptFile) {
    throw new Error("--prompt-file is required");
  }

  return parsed as CliArgs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seedDir = resolve(args.seedDir);
  const prompt = readFileSync(resolve(args.promptFile), "utf-8");
  const resolved = resolveHeartbeatConfig(seedDir, { host: args.host, model: args.model });
  const adapter = getHostAdapter(resolved.host as HostId);
  const detection = await adapter.detect();

  if (detection.status === "missing") {
    throw new Error(`Configured host "${resolved.host}" is not installed on PATH`);
  }

  if (!detection.ready) {
    const reason = detection.reason ? `: ${detection.reason}` : "";
    throw new Error(`Configured host "${resolved.host}" is installed but not ready${reason}`);
  }

  if (!adapter.capabilities.includes("heartbeat")) {
    throw new Error(`Configured host "${resolved.host}" does not support heartbeat mode`);
  }

  const plan = adapter.runHeadless({
    prompt,
    model: resolved.model,
    workingDirectory: seedDir,
  });

  if (resolved.configPath) {
    console.error(`[seed-hosts] using config ${resolved.configPath}`);
  }
  console.error(`[seed-hosts] host=${resolved.host}${resolved.model ? ` model=${resolved.model}` : ""}`);
  if (plan.notes?.length) {
    for (const note of plan.notes) {
      console.error(`[seed-hosts] ${note}`);
    }
  }

  const child = spawn(plan.command, plan.args, {
    cwd: seedDir,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(`[seed-hosts] failed to start host "${resolved.host}": ${error.message}`);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(`[seed-hosts] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
