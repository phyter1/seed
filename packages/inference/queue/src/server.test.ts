import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { QueueDB } from "./db";
import { createApp } from "./server";
import type { Hono } from "hono";

const TEST_DB = "/tmp/ren-queue-server-test.db";

let db: QueueDB;
let app: Hono;

async function req(path: string, init?: RequestInit) {
  return app.request(path, init);
}

async function post(path: string, body: any) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function del(path: string) {
  return app.request(path, { method: "DELETE" });
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

describe("API", () => {
  test("health check", async () => {
    const res = await req("/health");
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.depth).toBe(0);
  });

  test("submit and retrieve job", async () => {
    const res = await post("/jobs", {
      payload: { messages: [{ role: "user", content: "test" }] },
      creator: "test",
      priority: 8,
      capability: "reasoning",
    });
    expect(res.status).toBe(201);
    const job = await res.json();
    expect(job.priority).toBe(8);
    expect(job.status).toBe("queued");

    const getRes = await req(`/jobs/${job.id}`);
    const got = await getRes.json();
    expect(got.id).toBe(job.id);
  });

  test("claim → start → complete lifecycle", async () => {
    const submitRes = await post("/jobs", {
      payload: { messages: [{ role: "user", content: "hello" }] },
      creator: "test",
    });
    const job = await submitRes.json();

    const claimRes = await post("/jobs/claim", {
      worker_id: "test-worker",
      capability: "any",
    });
    expect(claimRes.status).toBe(200);
    const claimed = await claimRes.json();
    expect(claimed.status).toBe("claimed");

    const startRes = await post(`/jobs/${job.id}/start`, {
      worker_id: "test-worker",
    });
    expect(startRes.status).toBe(200);

    const completeRes = await post(`/jobs/${job.id}/complete`, {
      worker_id: "test-worker",
      result: {
        content: "world",
        model: "test",
        worker_id: "test-worker",
        duration_ms: 50,
      },
    });
    expect(completeRes.status).toBe(200);
    const completed = await completeRes.json();
    expect(completed.status).toBe("done");
    expect(completed.result.content).toBe("world");
  });

  test("queue depth and can_plan", async () => {
    const res = await req("/queue/depth");
    const depth = await res.json();
    expect(depth.depth).toBe(0);
    expect(depth.can_plan).toBe(true);
    expect(depth.soft_max).toBe(10);
  });

  test("validation: missing payload", async () => {
    const res = await post("/jobs", { creator: "test" });
    expect(res.status).toBe(400);
  });

  test("cancel queued job", async () => {
    const submitRes = await post("/jobs", {
      payload: { messages: [{ role: "user", content: "cancel me" }] },
      creator: "test",
    });
    const job = await submitRes.json();

    const cancelRes = await del(`/jobs/${job.id}`);
    expect(cancelRes.status).toBe(200);

    const getRes = await req(`/jobs/${job.id}`);
    expect(getRes.status).toBe(404);
  });

  test("worker registration", async () => {
    await post("/workers/register", {
      id: "local-mlx",
      capability: "speed",
      hostname: "localhost",
      endpoint: "http://localhost:8080",
    });

    const res = await req("/workers");
    const workers = await res.json();
    expect(workers.length).toBe(1);
    expect(workers[0].id).toBe("local-mlx");
  });

  test("no jobs returns 204", async () => {
    const res = await post("/jobs/claim", {
      worker_id: "w",
      capability: "any",
    });
    expect(res.status).toBe(204);
  });
});
