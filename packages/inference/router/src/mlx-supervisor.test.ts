/**
 * Tests for MlxSupervisor — router-side supervision of the MLX child process.
 *
 * Verifies:
 * - Exit detection: unexpected child exit triggers a respawn after backoff.
 * - Intentional shutdown: process exit after markIntentional() does NOT respawn.
 * - Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s.
 * - Reset on success: reportHealthy() clears backoff and failure counters.
 * - Failure cap: after N consecutive failures the supervisor gives up and stops.
 * - State snapshot: getState() exposes everything /health needs.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { EventEmitter } from "node:events";
import { MlxSupervisor, type ProcLike } from "./mlx-supervisor";

// ── Fakes ───────────────────────────────────────────────────────────────────

class FakeProc extends EventEmitter implements ProcLike {
  public pid: number | null;
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  die(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit("exit", code, signal);
  }
}

interface ScheduledTimer {
  fn: () => void;
  ms: number;
  handle: number;
  cancelled: boolean;
}

class FakeClock {
  private timers = new Map<number, ScheduledTimer>();
  private nextHandle = 1;
  public current = 0;

  setTimeout = (fn: () => void, ms: number): number => {
    const handle = this.nextHandle++;
    this.timers.set(handle, { fn, ms, handle, cancelled: false });
    return handle;
  };

  clearTimeout = (handle: unknown): void => {
    const h = handle as number;
    const t = this.timers.get(h);
    if (t) t.cancelled = true;
    this.timers.delete(h);
  };

  now = (): number => this.current;

  /** Fire the single scheduled timer (if any). Returns the delay it was set for. */
  fireNext(): number {
    const active = [...this.timers.values()].find((t) => !t.cancelled);
    if (!active) throw new Error("no scheduled timer to fire");
    this.timers.delete(active.handle);
    this.current += active.ms;
    active.fn();
    return active.ms;
  }

  pendingCount(): number {
    return [...this.timers.values()].filter((t) => !t.cancelled).length;
  }
}

function makeSupervisor(opts: {
  maxConsecutiveFailures?: number;
  backoffSchedule?: number[];
  waitPortFree?: () => Promise<number>;
} = {}) {
  const clock = new FakeClock();
  const procs: FakeProc[] = [];
  const spawnCalls: boolean[] = [];
  const logs: string[] = [];
  let nextPid = 100;

  const supervisor = new MlxSupervisor({
    spawn: (thinking: boolean) => {
      spawnCalls.push(thinking);
      const p = new FakeProc(nextPid++);
      procs.push(p);
      return p;
    },
    log: (m) => logs.push(m),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    backoffSchedule: opts.backoffSchedule,
    maxConsecutiveFailures: opts.maxConsecutiveFailures,
    waitPortFree: opts.waitPortFree,
  });

  return { supervisor, clock, procs, spawnCalls, logs };
}

async function drainMicrotasks(n = 4): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("MlxSupervisor.start", () => {
  test("records pid and thinking mode, no pending respawn", () => {
    const { supervisor, procs } = makeSupervisor();
    supervisor.start(false);
    expect(procs).toHaveLength(1);
    const s = supervisor.getState();
    expect(s.pid).toBe(procs[0].pid);
    expect(s.thinking).toBe(false);
    expect(s.isHealthy).toBe(false);
    expect(s.respawnCount).toBe(0);
  });
});

describe("unexpected exit", () => {
  test("schedules a respawn at the first backoff step", () => {
    const { supervisor, procs, clock } = makeSupervisor();
    supervisor.start(false);
    procs[0].die(1);

    const s = supervisor.getState();
    expect(s.lastExitCode).toBe(1);
    expect(s.consecutiveFailures).toBe(1);
    expect(s.backoffMs).toBe(1000);
    expect(s.isHealthy).toBe(false);
    expect(clock.pendingCount()).toBe(1);
  });

  test("firing the respawn timer spawns a new child with the same thinking mode", () => {
    const { supervisor, procs, clock, spawnCalls } = makeSupervisor();
    supervisor.start(true);
    procs[0].die(null, "SIGKILL");

    const delay = clock.fireNext();
    expect(delay).toBe(1000);
    expect(spawnCalls).toEqual([true, true]);
    expect(procs).toHaveLength(2);
    expect(supervisor.getState().respawnCount).toBe(1);
  });
});

describe("exponential backoff", () => {
  test("doubles each failure up to the 30s cap", () => {
    const { supervisor, procs, clock } = makeSupervisor();
    supervisor.start(false);

    const expected = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (let i = 0; i < expected.length; i++) {
      procs[i].die(1);
      expect(supervisor.getState().backoffMs).toBe(expected[i]);
      clock.fireNext();
    }
  });
});

describe("intentional shutdown", () => {
  test("markIntentional() suppresses respawn on the next exit", () => {
    const { supervisor, procs, clock } = makeSupervisor();
    supervisor.start(false);
    supervisor.markIntentional();
    procs[0].die(0);

    const s = supervisor.getState();
    expect(s.consecutiveFailures).toBe(0);
    expect(s.respawnCount).toBe(0);
    expect(clock.pendingCount()).toBe(0);
  });

  test("the intentional flag only applies to the next exit event", () => {
    const { supervisor, procs, clock } = makeSupervisor();
    supervisor.start(false);

    // Cycle 1: intentional stop + restart
    supervisor.markIntentional();
    procs[0].die(0);
    expect(clock.pendingCount()).toBe(0);

    supervisor.start(false);
    // Cycle 2: now an unexpected exit should respawn
    procs[1].die(1);
    expect(clock.pendingCount()).toBe(1);
    expect(supervisor.getState().consecutiveFailures).toBe(1);
  });
});

describe("reportHealthy", () => {
  test("resets backoff, clears failure counter, flips isHealthy true", () => {
    const { supervisor, procs, clock } = makeSupervisor();
    supervisor.start(false);
    procs[0].die(1);
    procs[0].die(1); // shouldn't happen, but be safe — use a fresh cycle
    // Actually just do one cycle:
    clock.fireNext();
    procs[1].die(1);
    expect(supervisor.getState().backoffMs).toBe(2000);
    clock.fireNext();

    supervisor.reportHealthy();
    const s = supervisor.getState();
    expect(s.isHealthy).toBe(true);
    expect(s.consecutiveFailures).toBe(0);
    expect(s.backoffMs).toBe(1000);
  });

  test("next failure after reportHealthy starts backoff from the first step", () => {
    const { supervisor, procs, clock } = makeSupervisor();
    supervisor.start(false);
    procs[0].die(1);
    clock.fireNext();
    procs[1].die(1);
    clock.fireNext();

    supervisor.reportHealthy();
    procs[2].die(1);
    expect(supervisor.getState().backoffMs).toBe(1000);
    expect(supervisor.getState().consecutiveFailures).toBe(1);
  });
});

describe("failure cap", () => {
  test("after maxConsecutiveFailures the supervisor gives up and stops scheduling", () => {
    const { supervisor, procs, clock, logs } = makeSupervisor({ maxConsecutiveFailures: 3 });
    supervisor.start(false);

    procs[0].die(1);
    clock.fireNext();
    procs[1].die(1);
    clock.fireNext();
    procs[2].die(1);

    const s = supervisor.getState();
    expect(s.givenUp).toBe(true);
    expect(s.isHealthy).toBe(false);
    expect(s.consecutiveFailures).toBe(3);
    expect(clock.pendingCount()).toBe(0);
    expect(logs.some((m) => /giv(ing|en).up/i.test(m))).toBe(true);
  });

  test("start() after giving up clears givenUp and resumes supervision", () => {
    const { supervisor, procs, clock } = makeSupervisor({ maxConsecutiveFailures: 2 });
    supervisor.start(false);
    procs[0].die(1);
    clock.fireNext();
    procs[1].die(1);
    expect(supervisor.getState().givenUp).toBe(true);

    supervisor.start(false);
    expect(supervisor.getState().givenUp).toBe(false);
    procs[2].die(1);
    expect(clock.pendingCount()).toBe(1);
  });
});

describe("stop", () => {
  test("cancels pending respawn timer and marks intentional", () => {
    const { supervisor, procs, clock } = makeSupervisor();
    supervisor.start(false);
    procs[0].die(1);
    expect(clock.pendingCount()).toBe(1);

    supervisor.stop();
    expect(clock.pendingCount()).toBe(0);

    // A subsequent phantom exit event should not reschedule.
    procs[0].die(1);
    expect(clock.pendingCount()).toBe(0);
  });
});

describe("getState snapshot", () => {
  test("includes all fields the /health endpoint needs", () => {
    const { supervisor } = makeSupervisor();
    supervisor.start(false);
    const s = supervisor.getState();
    expect(s).toEqual({
      pid: s.pid,
      thinking: false,
      lastExitCode: null,
      lastExitSignal: null,
      lastExitAt: null,
      respawnCount: 0,
      backoffMs: 1000,
      consecutiveFailures: 0,
      isHealthy: false,
      givenUp: false,
      lastPortWaitMs: null,
    });
  });
});

describe("intentional/respawn races", () => {
  test("late exit of the old child does not consume the intentional marker for a new child", () => {
    const { supervisor, procs, clock } = makeSupervisor();
    supervisor.start(false);

    // Router calls markIntentional() then killMlxServers(), but the old proc
    // hasn't dispatched its exit event yet. Router spawns a new child.
    supervisor.markIntentional();
    supervisor.start(false);
    // (The listener gate on procs[0] drops its eventual exit event.)

    // Now the NEW child crashes unexpectedly.
    procs[1].die(1);
    expect(clock.pendingCount()).toBe(1); // respawn scheduled
    expect(supervisor.getState().consecutiveFailures).toBe(1);
  });
});

describe("waitPortFree (issue #38)", () => {
  test("respawn waits for the port-free probe to resolve before spawning", async () => {
    let resolvePort: ((ms: number) => void) | null = null;
    const waitPortFree = () => new Promise<number>((r) => { resolvePort = r; });
    const { supervisor, procs, clock } = makeSupervisor({ waitPortFree });

    supervisor.start(false);
    procs[0].die(1);
    clock.fireNext(); // fire backoff timer

    // Port probe is pending — no new child yet.
    await drainMicrotasks();
    expect(procs).toHaveLength(1);
    expect(supervisor.getState().respawnCount).toBe(0);

    // Port is free; probe resolves with 42ms wait.
    resolvePort!(42);
    await drainMicrotasks();

    expect(procs).toHaveLength(2);
    expect(supervisor.getState().respawnCount).toBe(1);
    expect(supervisor.getState().lastPortWaitMs).toBe(42);
  });

  test("probe rejection does not block the respawn (degraded mode)", async () => {
    let rejectPort: ((err: Error) => void) | null = null;
    const waitPortFree = () => new Promise<number>((_, rej) => { rejectPort = rej; });
    const { supervisor, procs, clock, logs } = makeSupervisor({ waitPortFree });

    supervisor.start(false);
    procs[0].die(1);
    clock.fireNext();

    await drainMicrotasks();
    expect(procs).toHaveLength(1);

    rejectPort!(new Error("timeout"));
    await drainMicrotasks();

    expect(procs).toHaveLength(2);
    expect(supervisor.getState().respawnCount).toBe(1);
    expect(logs.some((m) => /port wait failed/i.test(m))).toBe(true);
  });

  test("start() bypasses waitPortFree (initial boot / external restart)", async () => {
    let called = 0;
    const waitPortFree = () => { called += 1; return Promise.resolve(0); };
    const { supervisor, procs } = makeSupervisor({ waitPortFree });

    supervisor.start(false);
    await drainMicrotasks();

    expect(procs).toHaveLength(1);
    expect(called).toBe(0);
  });
});

describe("stale exit events", () => {
  test("an exit event from a previously-attached proc does not double-count", () => {
    const { supervisor, procs, clock } = makeSupervisor();
    supervisor.start(false);
    procs[0].die(1); // schedules respawn
    clock.fireNext();  // respawns → procs[1]
    expect(supervisor.getState().consecutiveFailures).toBe(1);

    // procs[0] emits a second exit somehow (belt-and-braces). It shouldn't count.
    procs[0].die(1);
    expect(supervisor.getState().consecutiveFailures).toBe(1);
    expect(clock.pendingCount()).toBe(0);
  });
});
