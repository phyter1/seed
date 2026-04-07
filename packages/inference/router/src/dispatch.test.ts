/**
 * Tests for the dispatch module — machine queue serialization and load balancing.
 */

import { describe, test, expect } from "bun:test";
import { withMachineQueue, pickIdlestMachine, withPrePickedQueue } from "./dispatch";
import type { MachineQueue } from "./state";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeQueues(): Record<string, MachineQueue> {
  const queues: Record<string, MachineQueue> = {};
  return queues;
}

function ensureQueue(queues: Record<string, MachineQueue>) {
  return (machine: string): MachineQueue => {
    if (!queues[machine]) {
      queues[machine] = { promise: Promise.resolve(), depth: 0 };
    }
    return queues[machine];
  };
}

// ── withMachineQueue ──────────────────────────────────────────────────────

describe("withMachineQueue", () => {
  test("serializes calls for the same machine", async () => {
    const queues = makeQueues();
    const eq = ensureQueue(queues);
    const order: number[] = [];

    const p1 = withMachineQueue("ren1", async () => {
      await Bun.sleep(20);
      order.push(1);
      return 1;
    }, eq);

    const p2 = withMachineQueue("ren1", async () => {
      order.push(2);
      return 2;
    }, eq);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(order).toEqual([1, 2]); // p2 waited for p1
  });

  test("runs calls for different machines in parallel", async () => {
    const queues = makeQueues();
    const eq = ensureQueue(queues);
    const order: string[] = [];

    const p1 = withMachineQueue("ren1", async () => {
      await Bun.sleep(20);
      order.push("ren1");
    }, eq);

    const p2 = withMachineQueue("ren2", async () => {
      order.push("ren2");
    }, eq);

    await Promise.all([p1, p2]);
    // ren2 should complete before ren1 since they run in parallel
    expect(order[0]).toBe("ren2");
  });

  test("depth returns to 0 after completion", async () => {
    const queues = makeQueues();
    const eq = ensureQueue(queues);

    await withMachineQueue("ren1", async () => "done", eq);
    expect(eq("ren1").depth).toBe(0);
  });

  test("depth decrements even on error", async () => {
    const queues = makeQueues();
    const eq = ensureQueue(queues);

    try {
      await withMachineQueue("ren1", async () => {
        throw new Error("fail");
      }, eq);
    } catch { /* expected */ }

    expect(eq("ren1").depth).toBe(0);
  });
});

// ── pickIdlestMachine ─────────────────────────────────────────────────────

describe("pickIdlestMachine", () => {
  test("picks the machine with lowest depth", () => {
    const queues = makeQueues();
    const eq = ensureQueue(queues);

    // Pre-increment ren1 depth
    eq("ren1").depth = 3;
    eq("ren2").depth = 1;
    eq("ren3").depth = 2;

    const picked = pickIdlestMachine(["ren1", "ren2", "ren3"], eq);
    expect(picked).toBe("ren2");
    // depth is pre-incremented
    expect(eq("ren2").depth).toBe(2);
  });

  test("picks first candidate when all depths are equal", () => {
    const queues = makeQueues();
    const eq = ensureQueue(queues);

    const picked = pickIdlestMachine(["ren1", "ren2"], eq);
    expect(picked).toBe("ren1");
    expect(eq("ren1").depth).toBe(1);
  });
});

// ── withPrePickedQueue ────────────────────────────────────────────────────

describe("withPrePickedQueue", () => {
  test("uses pre-incremented depth (decrements on completion)", async () => {
    const queues = makeQueues();
    const eq = ensureQueue(queues);

    // Simulate pickIdlestMachine pre-increment
    eq("ren1").depth = 1;

    await withPrePickedQueue("ren1", async () => "done", eq);
    expect(eq("ren1").depth).toBe(0);
  });

  test("serializes through the queue", async () => {
    const queues = makeQueues();
    const eq = ensureQueue(queues);
    const order: number[] = [];

    // First job through normal queue
    const p1 = withMachineQueue("ren1", async () => {
      await Bun.sleep(20);
      order.push(1);
    }, eq);

    // Second job with pre-picked (simulating pickIdlest already incremented depth)
    eq("ren1").depth++;
    const p2 = withPrePickedQueue("ren1", async () => {
      order.push(2);
    }, eq);

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });
});
