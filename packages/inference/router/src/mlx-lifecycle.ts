/**
 * MLX server lifecycle — spawning, readiness probes, and health monitoring.
 *
 * Manages the MLX server process via MlxSupervisor. Functions that need
 * system calls (spawnSync, spawn) are kept here; pure testable functions
 * (waitMlxPortFree, waitForMlxReady) accept their dependencies.
 */

import { spawnSync, spawn } from "node:child_process";
import net from "node:net";
import { MlxSupervisor } from "./mlx-supervisor";

// ── MLX State ─────────────────────────────────────────────────────────────

export interface MlxState {
  /** Last requested thinking-mode (informational — actual mode is per-request). */
  thinking: boolean;
  pid: number | null;
}

// ── Kill / Cleanup ────────────────────────────────────────────────────────

export function killMlxServers(mlxState: MlxState): void {
  // Bootout launchd service if present (prevents auto-restart on macOS)
  const uid = String(process.getuid?.() ?? 501);
  spawnSync("/bin/launchctl", ["bootout", `gui/${uid}/com.ren-jury.mlx-server`], { encoding: "utf8", timeout: 5000 });
  // Kill any remaining mlx_vlm processes (also mlx_lm, for migration-era cleanup)
  spawnSync("pkill", ["-f", "mlx_vlm.server"], { encoding: "utf8", timeout: 5000 });
  spawnSync("pkill", ["-f", "mlx_lm.server"], { encoding: "utf8", timeout: 5000 });
  console.log("[mlx] killed existing server(s)");
  mlxState.pid = null;
}

// ── Port Wait ─────────────────────────────────────────────────────────────

/**
 * TCP connect-probe: resolves (with ms waited) once the MLX port refuses
 * connections, or rejects on timeout. Addresses issue #38 — the dying MLX
 * child can hold :8080 briefly after pkill returns, racing the replacement
 * child's bind() and producing EADDRINUSE log noise.
 */
export function waitMlxPortFree(mlxHost: string, timeoutMs = 5000, intervalMs = 100): Promise<number> {
  const [hostPart, portPart] = mlxHost.split(":");
  const host = hostPart || "127.0.0.1";
  const port = Number.parseInt(portPart ?? "8080", 10);
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host, port });
      let settled = false;
      const cleanup = () => { settled = true; socket.removeAllListeners(); socket.destroy(); };

      socket.setTimeout(200);
      socket.once("connect", () => {
        if (settled) return;
        cleanup();
        // Port still bound. Retry or give up.
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`port ${port} still bound after ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, intervalMs);
      });
      socket.once("error", () => {
        if (settled) return;
        cleanup();
        resolve(Date.now() - start); // ECONNREFUSED — port free
      });
      socket.once("timeout", () => {
        if (settled) return;
        cleanup();
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`port ${port} probe timeout after ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, intervalMs);
      });
    };
    attempt();
  });
}

// ── Supervisor Construction ───────────────────────────────────────────────

export function createMlxSupervisor(
  mlxHost: string,
  mlxPythonPath: string,
  mlxStarter: string,
  mlxModel: string,
): MlxSupervisor {
  return new MlxSupervisor({
    // The supervisor passes `thinking` for respawn consistency; mlx-vlm controls
    // thinking per-request so the flag is ignored here.
    spawn: (_thinking: boolean) => {
      const args = [
        mlxStarter,
        "--model", mlxModel,
        "--port", mlxHost.split(":")[1] ?? "8080",
      ];
      console.log("[mlx] starting server");
      const proc = spawn(mlxPythonPath, args, {
        stdio: "inherit",
        detached: true,
      });
      proc.unref();
      return proc;
    },
    log: (m) => console.log(`[mlx-sup] ${m}`),
    waitPortFree: () => waitMlxPortFree(mlxHost),
  });
}

// ── Readiness Probe ───────────────────────────────────────────────────────

export async function waitForMlxReady(mlxHost: string, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${mlxHost}/v1/models`);
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await Bun.sleep(500);
  }
  return false;
}

// ── Ensure Alive ──────────────────────────────────────────────────────────

/**
 * Ensure the MLX server is reachable. If it isn't, spawn it through the
 * supervisor and wait until /v1/models responds. Concurrent callers serialize
 * through a single lock so we never race on spawn.
 *
 * Thinking-mode is controlled per-request in mlx-vlm — no server restart
 * needed, so this function is a liveness check rather than a state-toggle.
 */
export async function ensureMlxAlive(
  mlxHost: string,
  supervisor: MlxSupervisor,
  mlxState: MlxState,
  getLock: () => Promise<void>,
  setLock: (p: Promise<void>) => void,
): Promise<void> {
  try {
    const res = await fetch(`http://${mlxHost}/v1/models`);
    if (res.ok) return;
  } catch { /* server down, fall through and start */ }

  const previous = getLock();
  let release!: () => void;
  setLock(new Promise((resolve) => { release = resolve; }));
  await previous;
  try {
    // Re-check after acquiring the lock — prior holder may have started it.
    try {
      const res = await fetch(`http://${mlxHost}/v1/models`);
      if (res.ok) return;
    } catch { /* still down */ }

    console.log("[mlx] server unreachable — spawning");
    supervisor.start(false);
    const snap = supervisor.getState();
    mlxState.pid = snap.pid;

    const ready = await waitForMlxReady(mlxHost);
    if (!ready) {
      throw new Error("MLX server failed to become ready");
    }
    supervisor.reportHealthy();
    console.log("[mlx] ready");
  } finally {
    release();
  }
}

// ── Health Probe Interval ─────────────────────────────────────────────────

export function startHealthProbe(mlxHost: string, supervisor: MlxSupervisor, intervalMs = 10000): ReturnType<typeof setInterval> {
  const timer = setInterval(async () => {
    try {
      const res = await fetch(`http://${mlxHost}/v1/models`);
      if (res.ok) supervisor.reportHealthy();
    } catch {
      /* MLX unreachable — exit handler will drive the respawn */
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}
