import { describe, test, expect } from "bun:test";
import {
  parseWorkloadDeclareArgs,
  runWorkloadDeclare,
  type WorkloadDeclareArgs,
} from "./cli";

// --- Arg parsing ---

describe("parseWorkloadDeclareArgs", () => {
  test("parses full set-mode args", () => {
    const result = parseWorkloadDeclareArgs([
      "memory",
      "--machine",
      "ren1",
      "--version",
      "0.2.0",
      "--artifact-url",
      "file:///tmp/memory-0.2.0.tar.gz",
    ]);
    expect(result.machineId).toBe("ren1");
    expect(result.workloadId).toBe("memory");
    expect(result.version).toBe("0.2.0");
    expect(result.artifactUrl).toBe("file:///tmp/memory-0.2.0.tar.gz");
    expect(result.env).toEqual({});
  });

  test("parses list-mode args (no workload id)", () => {
    const result = parseWorkloadDeclareArgs(["--machine", "ren3"]);
    expect(result.machineId).toBe("ren3");
    expect(result.workloadId).toBeUndefined();
  });

  test("parses repeatable --env flags", () => {
    const result = parseWorkloadDeclareArgs([
      "router",
      "--machine",
      "ren3",
      "--version",
      "0.3.0",
      "--artifact-url",
      "file:///tmp/router.tar.gz",
      "--env",
      "PORT=3000",
      "--env",
      "HOST=0.0.0.0",
    ]);
    expect(result.env).toEqual({ PORT: "3000", HOST: "0.0.0.0" });
  });

  test("handles env values containing =", () => {
    const result = parseWorkloadDeclareArgs([
      "app",
      "--machine",
      "ren1",
      "--version",
      "1.0.0",
      "--artifact-url",
      "file:///tmp/app.tar.gz",
      "--env",
      "DSN=postgres://host:5432/db?sslmode=require",
    ]);
    expect(result.env).toEqual({
      DSN: "postgres://host:5432/db?sslmode=require",
    });
  });

  test("exits on missing --machine", () => {
    const origExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error("exit");
    }) as never;
    try {
      expect(() =>
        parseWorkloadDeclareArgs(["memory", "--version", "1.0.0"])
      ).toThrow("exit");
      expect(exitCode).toBe(1);
    } finally {
      process.exit = origExit;
    }
  });

  test("exits on missing --version in set mode", () => {
    const origExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error("exit");
    }) as never;
    try {
      expect(() =>
        parseWorkloadDeclareArgs([
          "memory",
          "--machine",
          "ren1",
          "--artifact-url",
          "file:///tmp/m.tar.gz",
        ])
      ).toThrow("exit");
      expect(exitCode).toBe(1);
    } finally {
      process.exit = origExit;
    }
  });

  test("exits on missing --artifact-url in set mode", () => {
    const origExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error("exit");
    }) as never;
    try {
      expect(() =>
        parseWorkloadDeclareArgs([
          "memory",
          "--machine",
          "ren1",
          "--version",
          "0.2.0",
        ])
      ).toThrow("exit");
      expect(exitCode).toBe(1);
    } finally {
      process.exit = origExit;
    }
  });
});

// --- runWorkloadDeclare ---

describe("runWorkloadDeclare", () => {
  test("list mode calls GET and prints table", async () => {
    const logs: string[] = [];
    const fakeGet = async (path: string) => {
      expect(path).toBe("/v1/workloads/ren1");
      return {
        machine_id: "ren1",
        workloads: [
          {
            id: "memory",
            version: "0.2.0",
            artifact_url: "file:///tmp/memory-0.2.0.tar.gz",
          },
        ],
      };
    };

    await runWorkloadDeclare({
      args: { machineId: "ren1", env: {} },
      get: fakeGet,
      put: async () => ({}),
      log: (msg) => logs.push(msg),
    });

    expect(logs.some((l) => l.includes("memory"))).toBe(true);
    expect(logs.some((l) => l.includes("0.2.0"))).toBe(true);
  });

  test("list mode with no workloads prints empty message", async () => {
    const logs: string[] = [];
    await runWorkloadDeclare({
      args: { machineId: "ren2", env: {} },
      get: async () => ({ machine_id: "ren2", workloads: [] }),
      put: async () => ({}),
      log: (msg) => logs.push(msg),
    });
    expect(logs.some((l) => l.includes("no workload declarations"))).toBe(true);
  });

  test("set mode fetches existing, appends new workload, PUTs merged list", async () => {
    let putPath = "";
    let putBody: any = null;

    const fakeGet = async () => ({
      machine_id: "ren1",
      workloads: [
        {
          id: "memory",
          version: "0.2.0",
          artifact_url: "file:///tmp/memory-0.2.0.tar.gz",
        },
      ],
    });

    const fakePut = async (path: string, body: any) => {
      putPath = path;
      putBody = body;
      return { machine_id: "ren1", pushed: true };
    };

    const logs: string[] = [];
    await runWorkloadDeclare({
      args: {
        machineId: "ren1",
        workloadId: "router",
        version: "0.3.0",
        artifactUrl: "file:///tmp/router.tar.gz",
        env: { PORT: "3000" },
      },
      get: fakeGet,
      put: fakePut,
      log: (msg) => logs.push(msg),
    });

    expect(putPath).toBe("/v1/workloads/ren1");
    expect(putBody.workloads).toHaveLength(2);
    expect(putBody.workloads[0].id).toBe("memory");
    expect(putBody.workloads[1].id).toBe("router");
    expect(putBody.workloads[1].version).toBe("0.3.0");
    expect(putBody.workloads[1].env).toEqual({ PORT: "3000" });
    expect(logs.some((l) => l.includes("declared router@0.3.0"))).toBe(true);
    expect(logs.some((l) => l.includes("(pushed)"))).toBe(true);
  });

  test("set mode replaces existing workload by id", async () => {
    let putBody: any = null;

    const fakeGet = async () => ({
      machine_id: "ren1",
      workloads: [
        {
          id: "memory",
          version: "0.1.0",
          artifact_url: "file:///tmp/memory-0.1.0.tar.gz",
        },
        {
          id: "router",
          version: "0.2.0",
          artifact_url: "file:///tmp/router-0.2.0.tar.gz",
        },
      ],
    });

    await runWorkloadDeclare({
      args: {
        machineId: "ren1",
        workloadId: "memory",
        version: "0.3.0",
        artifactUrl: "file:///tmp/memory-0.3.0.tar.gz",
        env: {},
      },
      get: fakeGet,
      put: async (_path, body) => {
        putBody = body;
        return { machine_id: "ren1", pushed: false };
      },
      log: () => {},
    });

    expect(putBody.workloads).toHaveLength(2);
    expect(putBody.workloads[0].id).toBe("memory");
    expect(putBody.workloads[0].version).toBe("0.3.0");
    expect(putBody.workloads[1].id).toBe("router");
  });

  test("set mode shows (not connected) when pushed=false", async () => {
    const logs: string[] = [];
    await runWorkloadDeclare({
      args: {
        machineId: "ren2",
        workloadId: "app",
        version: "1.0.0",
        artifactUrl: "file:///tmp/app.tar.gz",
        env: {},
      },
      get: async () => ({ machine_id: "ren2", workloads: [] }),
      put: async () => ({ machine_id: "ren2", pushed: false }),
      log: (msg) => logs.push(msg),
    });
    expect(logs.some((l) => l.includes("(not connected)"))).toBe(true);
  });

  test("set mode omits env key when no --env flags provided", async () => {
    let putBody: any = null;

    await runWorkloadDeclare({
      args: {
        machineId: "ren1",
        workloadId: "simple",
        version: "1.0.0",
        artifactUrl: "file:///tmp/simple.tar.gz",
        env: {},
      },
      get: async () => ({ machine_id: "ren1", workloads: [] }),
      put: async (_path, body) => {
        putBody = body;
        return { machine_id: "ren1", pushed: true };
      },
      log: () => {},
    });

    expect(putBody.workloads[0].env).toBeUndefined();
  });
});
