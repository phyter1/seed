import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HostReadinessStatus } from "./types";

const execFileAsync = promisify(execFile);

interface CommandProbeOptions {
  args: string[];
  timeoutMs?: number;
}

interface DetectCommandOptions {
  versionArgs?: string[];
  readinessProbe?: CommandProbeOptions;
}

interface CommandCheckResult {
  installed: boolean;
  ready: boolean;
  status: HostReadinessStatus;
  version?: string;
  reason?: string;
}

async function runCommand(command: string, args: string[], timeoutMs: number = 10_000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: timeoutMs,
    });

    return {
      ok: true as const,
      output: [stdout, stderr].filter(Boolean).join("\n").trim(),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
      signal?: string;
      killed?: boolean;
    };

    return {
      ok: false as const,
      code: err.code,
      output: [err.stdout, err.stderr].filter(Boolean).join("\n").trim(),
      message: err.message,
    };
  }
}

function summarizeFailure(result: { code?: string | number; output?: string; message?: string }): string {
  const detail = result.output || result.message || "probe failed";
  return typeof result.code === "undefined" ? detail : `${String(result.code)}: ${detail}`;
}

export async function detectCommand(
  command: string,
  options: DetectCommandOptions = {}
): Promise<CommandCheckResult> {
  const versionResult = await runCommand(command, options.versionArgs ?? ["--version"]);

  if (!versionResult.ok) {
    if (versionResult.code === "ENOENT") {
      return {
        installed: false,
        ready: false,
        status: "missing",
        reason: "command not found on PATH",
      };
    }

    return {
      installed: true,
      ready: false,
      status: "unavailable",
      reason: summarizeFailure(versionResult),
    };
  }

  const version = versionResult.output.split("\n").find(Boolean)?.trim();

  if (!options.readinessProbe) {
    return {
      installed: true,
      ready: true,
      status: "ready",
      version,
    };
  }

  const readinessResult = await runCommand(
    command,
    options.readinessProbe.args,
    options.readinessProbe.timeoutMs
  );

  if (!readinessResult.ok) {
    return {
      installed: true,
      ready: false,
      status: "unavailable",
      version,
      reason: summarizeFailure(readinessResult),
    };
  }

  return {
    installed: true,
    ready: true,
    status: "ready",
    version,
  };
}
