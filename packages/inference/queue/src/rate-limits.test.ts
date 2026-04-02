import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { QueueDB } from "./db";
import { createApp } from "./server";
import { unlinkSync, existsSync } from "fs";
import type { Hono } from "hono";

const TEST_DB = "/tmp/ren-queue-ratelimit-test.db";

let db: QueueDB;
let app: Hono;

async function post(path: string, body: any) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function get(path: string) {
  return app.request(path);
}

beforeEach(() => {
  for (const ext of ["", "-shm", "-wal"]) {
    const p = TEST_DB + ext;
    if (existsSync(p)) unlinkSync(p);
  }
  db = new QueueDB(TEST_DB);
  app = createApp(db);
});

afterEach(() => {
  db?.close();
  for (const ext of ["", "-shm", "-wal"]) {
    const p = TEST_DB + ext;
    if (existsSync(p)) unlinkSync(p);
  }
});

describe("rate limit tracking", () => {
  test("worker with no rate limits is always available", () => {
    db.registerWorker({
      id: "local-worker",
      capability: "speed",
      hostname: "localhost",
      endpoint: "http://localhost:8080",
    });

    // Record some usage
    for (let i = 0; i < 100; i++) {
      db.recordUsage("local-worker", 500, 200);
    }

    const status = db.getRateLimitStatus("local-worker");
    expect(status.available).toBe(true);
    expect(status.limits).toBeNull();
    expect(status.requests_this_minute).toBe(100);
  });

  test("worker with RPM limit gets rate-limited", () => {
    db.registerWorker({
      id: "groq",
      capability: "speed",
      hostname: "cloud",
      endpoint: "https://api.groq.com",
      rate_limits: { rpm: 5 },
    });

    // 4 requests — still available
    for (let i = 0; i < 4; i++) {
      db.recordUsage("groq", 100, 50);
    }
    expect(db.isWorkerAvailable("groq")).toBe(true);

    // 5th request — at limit
    db.recordUsage("groq", 100, 50);
    expect(db.isWorkerAvailable("groq")).toBe(false);

    const status = db.getRateLimitStatus("groq");
    expect(status.requests_this_minute).toBe(5);
    expect(status.available).toBe(false);
    expect(status.next_available_in_ms).not.toBeNull();
  });

  test("worker with RPD limit gets rate-limited after daily quota", () => {
    db.registerWorker({
      id: "gemini",
      capability: "any",
      hostname: "cloud",
      endpoint: "https://generativelanguage.googleapis.com",
      rate_limits: { rpd: 3 },
    });

    db.recordUsage("gemini", 100, 50);
    db.recordUsage("gemini", 100, 50);
    expect(db.isWorkerAvailable("gemini")).toBe(true);

    db.recordUsage("gemini", 100, 50);
    expect(db.isWorkerAvailable("gemini")).toBe(false);
  });

  test("worker with TPM limit tracks token usage", () => {
    db.registerWorker({
      id: "cerebras",
      capability: "reasoning",
      hostname: "cloud",
      endpoint: "https://api.cerebras.ai",
      rate_limits: { tpm: 1000 },
    });

    db.recordUsage("cerebras", 400, 200); // 600 total
    expect(db.isWorkerAvailable("cerebras")).toBe(true);

    db.recordUsage("cerebras", 300, 200); // 1100 total — over
    expect(db.isWorkerAvailable("cerebras")).toBe(false);

    const status = db.getRateLimitStatus("cerebras");
    expect(status.tokens_this_minute).toBe(1100);
  });

  test("rate limits stored and retrieved with worker registration", () => {
    const worker = db.registerWorker({
      id: "groq",
      capability: "speed",
      hostname: "cloud",
      endpoint: "https://api.groq.com",
      rate_limits: { rpm: 30, rpd: 1000, tpm: 12000, tpd: 100000 },
    });

    expect(worker.rate_limits).toEqual({
      rpm: 30,
      rpd: 1000,
      tpm: 12000,
      tpd: 100000,
    });

    const workers = db.listWorkers();
    expect(workers[0].rate_limits).toEqual({
      rpm: 30,
      rpd: 1000,
      tpm: 12000,
      tpd: 100000,
    });
  });

  test("re-registration updates rate limits", () => {
    db.registerWorker({
      id: "groq",
      capability: "speed",
      hostname: "cloud",
      endpoint: "https://api.groq.com",
      rate_limits: { rpm: 30 },
    });

    db.registerWorker({
      id: "groq",
      capability: "speed",
      hostname: "cloud",
      endpoint: "https://api.groq.com",
      rate_limits: { rpm: 60, rpd: 2000 },
    });

    const worker = db.listWorkers().find((w) => w.id === "groq");
    expect(worker!.rate_limits).toEqual({ rpm: 60, rpd: 2000 });
  });

  test("getAllRateLimitStatus returns status for all workers", () => {
    db.registerWorker({
      id: "groq",
      capability: "speed",
      hostname: "cloud",
      endpoint: "https://api.groq.com",
      rate_limits: { rpm: 30 },
    });
    db.registerWorker({
      id: "local",
      capability: "speed",
      hostname: "local-machine",
      endpoint: "http://localhost:8080",
    });

    const statuses = db.getAllRateLimitStatus();
    expect(statuses.length).toBe(2);
    expect(statuses.every((s) => s.available)).toBe(true);
  });
});

describe("rate limit API", () => {
  test("claim returns 429 when worker is rate-limited", async () => {
    db.registerWorker({
      id: "groq",
      capability: "speed",
      hostname: "cloud",
      endpoint: "https://api.groq.com",
      rate_limits: { rpm: 2 },
    });

    // Use up the limit
    db.recordUsage("groq", 100, 50);
    db.recordUsage("groq", 100, 50);

    // Submit a job
    await post("/jobs", {
      payload: { messages: [{ role: "user", content: "test" }] },
      creator: "test",
      capability: "speed",
    });

    // Try to claim — should be rejected
    const res = await post("/jobs/claim", {
      worker_id: "groq",
      capability: "speed",
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.message).toBe("rate limited");
    expect(body.available).toBe(false);
  });

  test("job goes to non-rate-limited worker", async () => {
    db.registerWorker({
      id: "groq",
      capability: "speed",
      hostname: "cloud",
      endpoint: "https://api.groq.com",
      rate_limits: { rpm: 1 },
    });
    db.registerWorker({
      id: "local",
      capability: "speed",
      hostname: "local-machine",
      endpoint: "http://localhost:8080",
    });

    // Rate-limit groq
    db.recordUsage("groq", 100, 50);

    // Submit a job
    await post("/jobs", {
      payload: { messages: [{ role: "user", content: "test" }] },
      creator: "test",
      capability: "speed",
    });

    // Groq gets 429
    const groqRes = await post("/jobs/claim", {
      worker_id: "groq",
      capability: "speed",
    });
    expect(groqRes.status).toBe(429);

    // Local worker gets the job
    const localRes = await post("/jobs/claim", {
      worker_id: "local",
      capability: "speed",
    });
    expect(localRes.status).toBe(200);
    const job = await localRes.json();
    expect(job.worker_id).toBe("local");
  });

  test("release puts job back in queue", async () => {
    db.registerWorker({
      id: "groq",
      capability: "speed",
      hostname: "cloud",
      endpoint: "https://api.groq.com",
    });

    await post("/jobs", {
      payload: { messages: [{ role: "user", content: "test" }] },
      creator: "test",
      capability: "speed",
    });

    // Claim
    const claimRes = await post("/jobs/claim", {
      worker_id: "groq",
      capability: "speed",
    });
    const job = await claimRes.json();
    expect(job.status).toBe("claimed");

    // Release
    const releaseRes = await post(`/jobs/${job.id}/release`, {
      worker_id: "groq",
    });
    expect(releaseRes.status).toBe(200);
    const released = await releaseRes.json();
    expect(released.status).toBe("queued");
    expect(released.worker_id).toBeNull();
  });

  test("complete records usage for rate limit tracking", async () => {
    db.registerWorker({
      id: "groq",
      capability: "speed",
      hostname: "cloud",
      endpoint: "https://api.groq.com",
      rate_limits: { rpm: 10 },
    });

    await post("/jobs", {
      payload: { messages: [{ role: "user", content: "test" }] },
      creator: "test",
      capability: "speed",
    });

    const claimRes = await post("/jobs/claim", {
      worker_id: "groq",
      capability: "speed",
    });
    const job = await claimRes.json();

    await post(`/jobs/${job.id}/start`, { worker_id: "groq" });
    await post(`/jobs/${job.id}/complete`, {
      worker_id: "groq",
      result: {
        content: "hello",
        model: "llama-3.3-70b",
        worker_id: "groq",
        duration_ms: 100,
        tokens: { prompt: 43, completion: 12 },
      },
    });

    const status = db.getRateLimitStatus("groq");
    expect(status.requests_today).toBe(1);
    expect(status.tokens_this_minute).toBe(55); // 43 + 12
  });

  test("rate limit status endpoint", async () => {
    db.registerWorker({
      id: "groq",
      capability: "speed",
      hostname: "cloud",
      endpoint: "https://api.groq.com",
      rate_limits: { rpm: 30, rpd: 1000 },
    });

    db.recordUsage("groq", 200, 100);

    const res = await get("/workers/groq/rate-limit");
    const status = await res.json();
    expect(status.worker_id).toBe("groq");
    expect(status.requests_this_minute).toBe(1);
    expect(status.tokens_this_minute).toBe(300);
    expect(status.available).toBe(true);
    expect(status.limits.rpm).toBe(30);
  });

  test("all rate limits endpoint", async () => {
    db.registerWorker({
      id: "groq",
      capability: "speed",
      hostname: "cloud",
      endpoint: "https://api.groq.com",
      rate_limits: { rpm: 30 },
    });
    db.registerWorker({
      id: "cerebras",
      capability: "reasoning",
      hostname: "cloud",
      endpoint: "https://api.cerebras.ai",
      rate_limits: { rpm: 30, tpd: 1000000 },
    });

    const res = await get("/workers/rate-limits");
    const statuses = await res.json();
    expect(statuses.length).toBe(2);
  });
});
