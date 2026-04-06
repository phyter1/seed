/**
 * launchd supervisor driver.
 *
 * Wraps the modern `launchctl bootstrap` / `launchctl bootout` commands.
 * `launchctl load` / `unload` are deprecated on modern macOS — this
 * driver uses the per-user GUI domain so workloads inherit the user's
 * environment without needing LaunchDaemon privileges.
 */

import type { Subprocess } from "bun";

export interface SupervisorDriver {
  /** Load a plist into the supervisor (bootstrap). Idempotent. */
  load(label: string, plistPath: string): Promise<void>;
  /** Unload a service by label (bootout). Idempotent. */
  unload(label: string): Promise<void>;
  /** Return `true` if a service with `label` is currently loaded. */
  isLoaded(label: string): Promise<boolean>;
  /** Return launchctl's view of a loaded service. */
  status(
    label: string
  ): Promise<{ loaded: boolean; pid: number | null; last_exit: number | null }>;
}

async function runLaunchctl(
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["launchctl", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  }) as Subprocess<"ignore", "pipe", "pipe">;
  await proc.exited;
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: proc.exitCode ?? -1, stdout, stderr };
}

function guiDomain(): string {
  const uid = process.getuid?.() ?? 501;
  return `gui/${uid}`;
}

/**
 * Check if a service is present in the launchd domain using `launchctl print`.
 * Unlike `launchctl list`, `print` sees services during domain transitions
 * (e.g. right after a bootout when bootstrap returns exit 5).
 */
async function isInDomain(domain: string, label: string): Promise<boolean> {
  const r = await runLaunchctl(["print", `${domain}/${label}`]);
  return r.code === 0;
}

export function createLaunchdDriver(): SupervisorDriver {
  const domain = guiDomain();

  return {
    async load(label: string, plistPath: string): Promise<void> {
      // `launchctl bootstrap` may fail with exit 5 (EIO) or 37 when the
      // service is already in the domain — treat as idempotent if the
      // service is confirmed present via `launchctl print`.
      const r = await runLaunchctl(["bootstrap", domain, plistPath]);
      if (r.code === 0) return;
      // Idempotency: use `launchctl print` which has broader visibility
      // than `list` during domain transitions (e.g. after a recent bootout).
      if (await isInDomain(domain, label)) return;
      throw new Error(
        `launchctl bootstrap ${domain} ${plistPath} failed (${r.code}): ${
          r.stderr.trim() || r.stdout.trim() || "unknown error"
        }`
      );
    },

    async unload(label: string): Promise<void> {
      // `launchctl bootout` returns 113 if the target doesn't exist —
      // treat that as idempotent (nothing to unload).
      const r = await runLaunchctl(["bootout", `${domain}/${label}`]);
      if (r.code === 0 || r.code === 113) return;
      // Fallback: confirm it's gone
      const loaded = await this.isLoaded(label);
      if (!loaded) return;
      throw new Error(
        `launchctl bootout ${domain}/${label} failed (${r.code}): ${
          r.stderr.trim() || r.stdout.trim() || "unknown error"
        }`
      );
    },

    async isLoaded(label: string): Promise<boolean> {
      const r = await runLaunchctl(["list", label]);
      // `launchctl list <label>` returns 0 if loaded, non-zero otherwise.
      return r.code === 0;
    },

    async status(
      label: string
    ): Promise<{
      loaded: boolean;
      pid: number | null;
      last_exit: number | null;
    }> {
      const r = await runLaunchctl(["list", label]);
      if (r.code !== 0) return { loaded: false, pid: null, last_exit: null };
      // Output is a plist-ish dict; parse `"PID" = N;` and
      // `"LastExitStatus" = N;` directly — no need for a full parser.
      const pidMatch = r.stdout.match(/"PID"\s*=\s*(\d+)/);
      const exitMatch = r.stdout.match(/"LastExitStatus"\s*=\s*(-?\d+)/);
      return {
        loaded: true,
        pid: pidMatch ? parseInt(pidMatch[1], 10) : null,
        last_exit: exitMatch ? parseInt(exitMatch[1], 10) : null,
      };
    },
  };
}
