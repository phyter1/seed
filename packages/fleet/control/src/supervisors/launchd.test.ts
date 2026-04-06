import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createLaunchdDriver } from "./launchd";

// ---------------------------------------------------------------------------
// Mock infrastructure — intercept Bun.spawn to simulate launchctl responses
// ---------------------------------------------------------------------------

let originalSpawn: typeof Bun.spawn;
let spawnCalls: string[][];

beforeEach(() => {
  originalSpawn = Bun.spawn;
  spawnCalls = [];
});

afterEach(() => {
  Bun.spawn = originalSpawn;
});

/**
 * Build a mock Bun.spawn that returns scripted responses in order.
 * Also records each command array in `spawnCalls` for assertions.
 */
function mockSpawn(calls: { stdout?: string; stderr?: string; exitCode: number }[]) {
  let callIndex = 0;
  // @ts-expect-error — replacing Bun.spawn with a mock for testing
  Bun.spawn = (cmd: string[]) => {
    spawnCalls.push(cmd as string[]);
    const scripted = calls[callIndex] ?? { stdout: "", stderr: "", exitCode: 1 };
    callIndex++;
    const stdout = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(scripted.stdout ?? ""));
        controller.close();
      },
    });
    const stderr = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(scripted.stderr ?? ""));
        controller.close();
      },
    });
    return {
      stdout,
      stderr,
      exited: Promise.resolve(scripted.exitCode),
      exitCode: scripted.exitCode,
      pid: 0,
      kill() {},
    };
  };
}

// ---------------------------------------------------------------------------
// load()
// ---------------------------------------------------------------------------

describe("launchd driver — load()", () => {
  test("bootstrap succeeds (exit 0) — returns void", async () => {
    const driver = createLaunchdDriver();
    mockSpawn([{ exitCode: 0 }]);
    await expect(driver.load("com.test.svc", "/tmp/test.plist")).resolves.toBeUndefined();
    expect(spawnCalls[0]).toEqual(expect.arrayContaining(["launchctl", "bootstrap"]));
  });

  test("bootstrap fails exit 5, print confirms in-domain — returns void (idempotent)", async () => {
    const driver = createLaunchdDriver();
    mockSpawn([
      // bootstrap → exit 5
      { exitCode: 5, stderr: "5: Input/output error" },
      // launchctl print → exit 0 (in-domain)
      { exitCode: 0, stdout: "com.test.svc = {\n\tpid = 1234\n}" },
    ]);
    await expect(driver.load("com.test.svc", "/tmp/test.plist")).resolves.toBeUndefined();
    // Verify the second call was `launchctl print`, not `launchctl list`
    expect(spawnCalls[1][0]).toBe("launchctl");
    expect(spawnCalls[1][1]).toBe("print");
  });

  test("bootstrap fails exit 37, print confirms in-domain — returns void (idempotent)", async () => {
    const driver = createLaunchdDriver();
    mockSpawn([
      // bootstrap → exit 37
      { exitCode: 37, stderr: "37: Operation already in progress" },
      // launchctl print → exit 0 (in-domain)
      { exitCode: 0, stdout: "com.test.svc = {\n\tpid = 5678\n}" },
    ]);
    await expect(driver.load("com.test.svc", "/tmp/test.plist")).resolves.toBeUndefined();
    expect(spawnCalls[1][1]).toBe("print");
  });

  test("bootstrap fails exit 5, print says not in-domain — throws", async () => {
    const driver = createLaunchdDriver();
    mockSpawn([
      // bootstrap → exit 5
      { exitCode: 5, stderr: "5: Input/output error" },
      // launchctl print → exit non-0 (not in-domain)
      { exitCode: 113, stderr: "Could not find service" },
    ]);
    await expect(driver.load("com.test.svc", "/tmp/test.plist")).rejects.toThrow(
      /launchctl bootstrap .* failed \(5\)/
    );
  });
});

// ---------------------------------------------------------------------------
// unload()
// ---------------------------------------------------------------------------

describe("launchd driver — unload()", () => {
  test("bootout succeeds (exit 0) — returns void", async () => {
    const driver = createLaunchdDriver();
    mockSpawn([{ exitCode: 0 }]);
    await expect(driver.unload("com.test.svc")).resolves.toBeUndefined();
    expect(spawnCalls[0]).toEqual(expect.arrayContaining(["launchctl", "bootout"]));
  });

  test("bootout returns 113 — returns void (idempotent)", async () => {
    const driver = createLaunchdDriver();
    mockSpawn([{ exitCode: 113 }]);
    await expect(driver.unload("com.test.svc")).resolves.toBeUndefined();
  });
});
