import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { QueueDB } from "./db";
import { unlinkSync, existsSync } from "fs";

const TEST_DB = "/tmp/ren-queue-test.db";

let db: QueueDB;

beforeEach(() => {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  db = new QueueDB(TEST_DB);
});

afterEach(() => {
  db.close();
  for (const ext of ["", "-shm", "-wal"]) {
    const p = TEST_DB + ext;
    if (existsSync(p)) unlinkSync(p);
  }
});

describe("job lifecycle", () => {
  test("create → claim → start → complete", () => {
    const job = db.createJob({
      payload: { messages: [{ role: "user", content: "hello" }] },
      creator: "test",
      priority: 7,
      capability: "reasoning",
    });

    expect(job.id).toBeTruthy();
    expect(job.status).toBe("queued");
    expect(job.priority).toBe(7);
    expect(job.capability).toBe("reasoning");

    const claimed = db.claimJob("worker-1", "reasoning");
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(job.id);
    expect(claimed!.status).toBe("claimed");
    expect(claimed!.worker_id).toBe("worker-1");

    const started = db.startJob(job.id, "worker-1");
    expect(started!.status).toBe("running");

    const completed = db.completeJob(job.id, "worker-1", {
      content: "world",
      model: "test-model",
      worker_id: "worker-1",
      duration_ms: 100,
    });
    expect(completed!.status).toBe("done");
    expect(completed!.result!.content).toBe("world");
  });

  test("create → claim → fail", () => {
    db.createJob({
      payload: { messages: [{ role: "user", content: "hello" }] },
      creator: "test",
    });

    const claimed = db.claimJob("worker-1", "any");
    expect(claimed).not.toBeNull();

    const failed = db.failJob(claimed!.id, "worker-1", "model crashed");
    expect(failed!.status).toBe("failed");
    expect(failed!.result!.error).toBe("model crashed");
  });
});

describe("priority ordering", () => {
  test("higher priority claimed first", () => {
    db.createJob({
      payload: { messages: [{ role: "user", content: "low" }] },
      creator: "test",
      priority: 3,
    });
    db.createJob({
      payload: { messages: [{ role: "user", content: "high" }] },
      creator: "test",
      priority: 9,
    });
    db.createJob({
      payload: { messages: [{ role: "user", content: "mid" }] },
      creator: "test",
      priority: 5,
    });

    const first = db.claimJob("w", "any");
    expect(first!.payload.messages[0].content).toBe("high");

    const second = db.claimJob("w", "any");
    expect(second!.payload.messages[0].content).toBe("mid");

    const third = db.claimJob("w", "any");
    expect(third!.payload.messages[0].content).toBe("low");
  });
});

describe("capability matching", () => {
  test("worker only sees matching jobs", () => {
    db.createJob({
      payload: { messages: [{ role: "user", content: "speed job" }] },
      creator: "test",
      capability: "speed",
    });
    db.createJob({
      payload: { messages: [{ role: "user", content: "reasoning job" }] },
      creator: "test",
      capability: "reasoning",
    });

    const speedWorker = db.claimJob("w-speed", "speed");
    expect(speedWorker!.payload.messages[0].content).toBe("speed job");

    // Speed worker can't claim reasoning job
    const nothing = db.claimJob("w-speed", "speed");
    expect(nothing).toBeNull();

    // But reasoning worker can
    const reasoningWorker = db.claimJob("w-reason", "reasoning");
    expect(reasoningWorker!.payload.messages[0].content).toBe("reasoning job");
  });

  test("'any' capability jobs are claimable by any worker", () => {
    db.createJob({
      payload: { messages: [{ role: "user", content: "any job" }] },
      creator: "test",
      capability: "any",
    });

    const claimed = db.claimJob("w-speed", "speed");
    expect(claimed).not.toBeNull();
    expect(claimed!.payload.messages[0].content).toBe("any job");
  });
});

describe("queue stats", () => {
  test("depth tracks active work", () => {
    expect(db.depth()).toBe(0);

    db.createJob({
      payload: { messages: [{ role: "user", content: "a" }] },
      creator: "test",
    });
    db.createJob({
      payload: { messages: [{ role: "user", content: "b" }] },
      creator: "test",
    });

    expect(db.depth()).toBe(2);

    db.claimJob("w", "any"); // claimed still counts as active
    expect(db.depth()).toBe(2);

    const stats = db.stats();
    expect(stats.can_plan).toBe(true);
    expect(stats.soft_max).toBe(10);
  });

  test("completed jobs don't count toward depth", () => {
    const job = db.createJob({
      payload: { messages: [{ role: "user", content: "x" }] },
      creator: "test",
    });
    db.claimJob("w", "any");
    db.startJob(job.id, "w");
    db.completeJob(job.id, "w", {
      content: "done",
      model: "m",
      worker_id: "w",
      duration_ms: 1,
    });

    expect(db.depth()).toBe(0);
  });
});

describe("cancel", () => {
  test("can cancel queued jobs", () => {
    const job = db.createJob({
      payload: { messages: [{ role: "user", content: "x" }] },
      creator: "test",
    });
    expect(db.cancelJob(job.id)).toBe(true);
    expect(db.getJob(job.id)).toBeNull();
  });

  test("cannot cancel claimed jobs", () => {
    const job = db.createJob({
      payload: { messages: [{ role: "user", content: "x" }] },
      creator: "test",
    });
    db.claimJob("w", "any");
    expect(db.cancelJob(job.id)).toBe(false);
  });
});

describe("worker registration", () => {
  test("register and list workers", () => {
    db.registerWorker({
      id: "local-mlx",
      capability: "speed",
      hostname: "localhost",
      endpoint: "http://localhost:8080",
    });
    db.registerWorker({
      id: "local-ollama",
      capability: "reasoning",
      hostname: "ren.local",
      endpoint: "http://localhost:11434",
    });

    const workers = db.listWorkers();
    expect(workers.length).toBe(2);
  });

  test("re-register updates existing worker", () => {
    db.registerWorker({
      id: "local-mlx",
      capability: "speed",
      hostname: "localhost",
      endpoint: "http://localhost:8080",
    });
    db.registerWorker({
      id: "local-mlx",
      capability: "speed",
      hostname: "localhost",
      endpoint: "http://localhost:9999",
    });

    const workers = db.listWorkers();
    expect(workers.length).toBe(1);
    expect(workers[0].endpoint).toBe("http://localhost:9999");
  });
});

describe("list and filter", () => {
  test("filter by status", () => {
    db.createJob({
      payload: { messages: [{ role: "user", content: "a" }] },
      creator: "test",
    });
    db.createJob({
      payload: { messages: [{ role: "user", content: "b" }] },
      creator: "test",
    });
    db.claimJob("w", "any");

    const queued = db.listJobs({ status: "queued" });
    expect(queued.length).toBe(1);

    const claimed = db.listJobs({ status: "claimed" });
    expect(claimed.length).toBe(1);
  });

  test("filter by creator", () => {
    db.createJob({
      payload: { messages: [{ role: "user", content: "a" }] },
      creator: "heartbeat",
    });
    db.createJob({
      payload: { messages: [{ role: "user", content: "b" }] },
      creator: "cli",
    });

    const hb = db.listJobs({ creator: "heartbeat" });
    expect(hb.length).toBe(1);
    expect(hb[0].creator).toBe("heartbeat");
  });
});
