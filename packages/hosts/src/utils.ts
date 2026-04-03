import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function detectCommand(command: string): Promise<{ installed: boolean; version?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ["--version"]);
    const version = (stdout || stderr).split("\n").find(Boolean)?.trim();
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}
