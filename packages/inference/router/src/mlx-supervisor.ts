/**
 * MlxSupervisor — watches the MLX child process, respawns on unexpected exit.
 *
 * The fleet router spawns MLX as a detached child. Before this supervisor, a
 * crash would leave the router running but MLX-routed requests failing until
 * manual intervention. With the supervisor attached:
 *
 *   - Every spawn attaches an "exit" listener.
 *   - Unexpected exits trigger a respawn with exponential backoff
 *     (1s, 2s, 4s, 8s, 16s, then capped at 30s).
 *   - reportHealthy() after a successful /v1/models check resets the backoff.
 *   - markIntentional() is called before any deliberate kill (thinking toggle,
 *     router shutdown) so that the subsequent exit does not trigger a respawn.
 *   - After `maxConsecutiveFailures` unsuccessful respawns in a row the
 *     supervisor gives up and stops scheduling; it's better to fail loudly
 *     than to thrash forever. A fresh start() resumes supervision.
 *
 * Real process spawning, killing, and health checks live in router.ts — this
 * module is intentionally I/O-free so it can be unit-tested with fakes.
 */

import type { EventEmitter } from "node:events";

export interface ProcLike extends Pick<EventEmitter, "on"> {
  pid?: number | null;
}

export interface SupervisorDeps {
  /** Spawn a fresh MLX child. Supervisor attaches the exit listener itself. */
  spawn: (thinking: boolean) => ProcLike;
  /** Structured log sink. Defaults to no-op. */
  log?: (msg: string) => void;
  /** Injected timer functions (so tests can use a fake clock). */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Injected clock (ms since epoch). */
  now?: () => number;
  /** Backoff schedule in ms. Defaults to [1s, 2s, 4s, 8s, 16s, 30s]. */
  backoffSchedule?: number[];
  /** Give up after this many consecutive failed respawns. Defaults to 10. */
  maxConsecutiveFailures?: number;
  /**
   * Probe that resolves (with ms waited) when MLX's TCP port is free, or
   * rejects on timeout. Called before each *respawn* (not before start()).
   * If omitted, the supervisor spawns immediately after backoff — the
   * pre-#38 behaviour, kept for tests that don't care about port races.
   */
  waitPortFree?: () => Promise<number>;
}

export interface SupervisorSnapshot {
  pid: number | null;
  thinking: boolean;
  lastExitCode: number | null;
  lastExitSignal: string | null;
  lastExitAt: number | null;
  respawnCount: number;
  backoffMs: number;
  consecutiveFailures: number;
  isHealthy: boolean;
  givenUp: boolean;
  /** ms waited for port-free probe on the most recent respawn, or null. */
  lastPortWaitMs: number | null;
}

const DEFAULT_BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];
const DEFAULT_MAX_FAILURES = 10;

export class MlxSupervisor {
  private readonly spawnFn: (thinking: boolean) => ProcLike;
  private readonly log: (msg: string) => void;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private readonly now: () => number;
  private readonly backoffSchedule: number[];
  private readonly maxFailures: number;
  private readonly waitPortFree: (() => Promise<number>) | null;

  private currentProc: ProcLike | null = null;
  /** The proc whose exit we're expecting (shutdown, toggle). Reset on consumption. */
  private intentionalProc: ProcLike | null = null;
  private respawnTimer: unknown = null;

  private thinking = false;
  private pid: number | null = null;
  private lastExitCode: number | null = null;
  private lastExitSignal: string | null = null;
  private lastExitAt: number | null = null;
  private respawnCount = 0;
  private consecutiveFailures = 0;
  private isHealthy = false;
  private givenUp = false;
  private lastPortWaitMs: number | null = null;

  constructor(deps: SupervisorDeps) {
    this.spawnFn = deps.spawn;
    this.log = deps.log ?? (() => {});
    this.setTimeoutFn = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.clearTimeoutFn = deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>));
    this.now = deps.now ?? (() => Date.now());
    this.backoffSchedule = deps.backoffSchedule && deps.backoffSchedule.length > 0
      ? [...deps.backoffSchedule]
      : [...DEFAULT_BACKOFF];
    this.maxFailures = deps.maxConsecutiveFailures ?? DEFAULT_MAX_FAILURES;
    this.waitPortFree = deps.waitPortFree ?? null;
  }

  /**
   * Spawn a fresh MLX child and attach the exit listener.
   *
   * This is the public, externally-driven entry point: it clears the failure
   * counters so that deliberate restarts (startup, thinking toggle, recovery
   * after giving up) begin from a clean slate. Internal respawns go through
   * spawnChild() directly and preserve the failure counter for backoff.
   */
  start(thinking: boolean): void {
    this.cancelRespawnTimer();
    this.givenUp = false;
    this.consecutiveFailures = 0;
    this.spawnChild(thinking);
  }

  private spawnChild(thinking: boolean): void {
    this.thinking = thinking;
    const proc = this.spawnFn(thinking);
    this.currentProc = proc;
    this.pid = proc.pid ?? null;
    this.isHealthy = false;
    this.log(`spawned MLX: pid=${this.pid ?? "?"} thinking=${thinking}`);

    proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      // Ignore exit events from stale procs we've already replaced.
      if (this.currentProc !== proc) return;
      this.handleExit(proc, code, signal);
    });
  }

  /**
   * Called before a deliberate kill so the *currently-attached* child's exit
   * does not trigger a respawn. Bound to the specific proc reference to avoid
   * races where a late exit of the old child is confused with a new child.
   */
  markIntentional(): void {
    this.intentionalProc = this.currentProc;
  }

  /** Call after a successful health check — resets backoff and failure counters. */
  reportHealthy(): void {
    this.isHealthy = true;
    this.consecutiveFailures = 0;
    this.log(`healthy: respawns=${this.respawnCount} isHealthy=true backoff reset`);
  }

  /** Stop supervising: cancel pending respawn, mark the current child's exit intentional. */
  stop(): void {
    this.cancelRespawnTimer();
    this.intentionalProc = this.currentProc;
    this.currentProc = null;
  }

  getState(): SupervisorSnapshot {
    return {
      pid: this.pid,
      thinking: this.thinking,
      lastExitCode: this.lastExitCode,
      lastExitSignal: this.lastExitSignal,
      lastExitAt: this.lastExitAt,
      respawnCount: this.respawnCount,
      backoffMs: this.currentBackoff(),
      consecutiveFailures: this.consecutiveFailures,
      isHealthy: this.isHealthy,
      givenUp: this.givenUp,
      lastPortWaitMs: this.lastPortWaitMs,
    };
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private handleExit(proc: ProcLike, code: number | null, signal: NodeJS.Signals | null): void {
    this.lastExitCode = code;
    this.lastExitSignal = signal;
    this.lastExitAt = this.now();
    this.isHealthy = false;
    this.currentProc = null;
    this.pid = null;

    if (this.intentionalProc === proc) {
      this.intentionalProc = null;
      this.log(`MLX exited (intentional): code=${code} signal=${signal ?? "none"}`);
      return;
    }

    this.consecutiveFailures += 1;
    const backoffMs = this.currentBackoff();
    this.log(
      `MLX exited unexpectedly: code=${code} signal=${signal ?? "none"} ` +
      `failures=${this.consecutiveFailures} next-backoff=${backoffMs}ms`
    );

    if (this.consecutiveFailures >= this.maxFailures) {
      this.givenUp = true;
      this.log(
        `MLX supervisor giving up after ${this.consecutiveFailures} consecutive failures. ` +
        `Manual intervention required.`
      );
      return;
    }

    this.scheduleRespawn(backoffMs);
  }

  private scheduleRespawn(delayMs: number): void {
    this.cancelRespawnTimer();
    const thinking = this.thinking;
    this.respawnTimer = this.setTimeoutFn(() => {
      this.respawnTimer = null;
      if (this.givenUp) return;
      this.respawnAfterPortFree(thinking);
    }, delayMs);
  }

  /**
   * Wait for the MLX port to be free, then spawn. If no probe is configured,
   * spawn immediately (pre-#38 behaviour). If the probe rejects (timeout),
   * log a warning and spawn anyway — we're already degraded, refusing to
   * respawn would make things worse.
   */
  private respawnAfterPortFree(thinking: boolean): void {
    const doSpawn = () => {
      if (this.givenUp) return;
      this.respawnCount += 1;
      this.log(`respawning MLX: attempt #${this.respawnCount} thinking=${thinking}`);
      this.spawnChild(thinking);
    };

    if (!this.waitPortFree) {
      doSpawn();
      return;
    }

    this.waitPortFree().then(
      (waitMs) => {
        this.lastPortWaitMs = waitMs;
        this.log(`port wait complete: ${waitMs}ms`);
        doSpawn();
      },
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`port wait failed: ${msg}. spawning anyway (degraded).`);
        doSpawn();
      },
    );
  }

  private cancelRespawnTimer(): void {
    if (this.respawnTimer !== null) {
      this.clearTimeoutFn(this.respawnTimer);
      this.respawnTimer = null;
    }
  }

  private currentBackoff(): number {
    const idx = Math.max(0, this.consecutiveFailures - 1);
    const capped = Math.min(idx, this.backoffSchedule.length - 1);
    return this.backoffSchedule[capped];
  }
}
