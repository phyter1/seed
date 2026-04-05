/**
 * End-to-end supervisor test with a real child process.
 *
 * Proves the supervisor actually observes Node's child_process "exit" events
 * and respawns — not just that the state machine behaves under fakes.
 */

import { describe, test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { MlxSupervisor } from "./mlx-supervisor";

describe("MlxSupervisor (real child_process)", () => {
  test("detects a real child exit and respawns it", async () => {
    const logs: string[] = [];
    let spawnCount = 0;

    const supervisor = new MlxSupervisor({
      spawn: () => {
        spawnCount += 1;
        // A shell that exits immediately with code 1.
        const proc = spawn("/bin/sh", ["-c", "exit 1"], { stdio: "ignore" });
        return proc;
      },
      log: (m) => logs.push(m),
      backoffSchedule: [50], // fast for tests
      maxConsecutiveFailures: 3,
    });

    supervisor.start(false);

    // Wait for the supervisor to give up (3 failures * ~50ms backoff + spawn time).
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !supervisor.getState().givenUp) {
      await Bun.sleep(25);
    }

    const state = supervisor.getState();
    expect(state.givenUp).toBe(true);
    expect(state.consecutiveFailures).toBe(3);
    expect(spawnCount).toBe(3);
    expect(state.lastExitCode).toBe(1);
    expect(logs.some((m) => m.includes("giving up"))).toBe(true);
  });

  test("a long-running child that survives does not trigger respawn", async () => {
    let spawnCount = 0;
    const supervisor = new MlxSupervisor({
      spawn: () => {
        spawnCount += 1;
        return spawn("/bin/sh", ["-c", "sleep 10"], { stdio: "ignore" });
      },
      log: () => {},
      backoffSchedule: [50],
    });

    supervisor.start(false);
    await Bun.sleep(200);

    expect(spawnCount).toBe(1);
    expect(supervisor.getState().consecutiveFailures).toBe(0);
    expect(supervisor.getState().respawnCount).toBe(0);

    // Clean up the sleep process.
    supervisor.stop();
  });
});
