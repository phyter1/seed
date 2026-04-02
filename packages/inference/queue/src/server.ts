import { Hono } from "hono";
import { QueueDB } from "./db";
import type { CreateJobRequest, Capability, JobStatus, JobResult } from "./types";

export function createApp(db: QueueDB): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    console.error("[server error]", err);
    return c.json({ error: err.message, stack: err.stack }, 500);
  });

  app.get("/health", (c) => {
    const stats = db.stats();
    return c.json({ status: "ok", ...stats });
  });

  app.post("/jobs", async (c) => {
    const body = await c.req.json<CreateJobRequest>();
    if (!body.payload?.messages?.length) {
      return c.json({ error: "payload.messages is required" }, 400);
    }
    if (!body.creator) {
      return c.json({ error: "creator is required" }, 400);
    }
    const job = db.createJob(body);
    return c.json(job, 201);
  });

  app.get("/jobs", (c) => {
    const status = c.req.query("status") as JobStatus | undefined;
    const capability = c.req.query("capability") as Capability | undefined;
    const creator = c.req.query("creator");
    const limit = Number(c.req.query("limit") ?? 50);
    const offset = Number(c.req.query("offset") ?? 0);
    const jobs = db.listJobs({ status, capability, creator, limit, offset });
    return c.json(jobs);
  });

  app.get("/jobs/:id", (c) => {
    const job = db.getJob(c.req.param("id"));
    if (!job) return c.json({ error: "not found" }, 404);
    return c.json(job);
  });

  app.delete("/jobs/:id", (c) => {
    const deleted = db.cancelJob(c.req.param("id"));
    if (!deleted) return c.json({ error: "not found or not cancellable" }, 404);
    return c.json({ cancelled: true });
  });

  app.post("/jobs/claim", async (c) => {
    const { worker_id, capability } = await c.req.json<{
      worker_id: string;
      capability: Capability;
    }>();
    if (!worker_id || !capability) {
      return c.json({ error: "worker_id and capability required" }, 400);
    }

    // Check rate limits before allowing claim
    if (!db.isWorkerAvailable(worker_id)) {
      const status = db.getRateLimitStatus(worker_id);
      return c.json({
        message: "rate limited",
        ...status,
      }, 429);
    }

    const job = db.claimJob(worker_id, capability);
    if (!job) return c.json({ message: "no jobs available" }, 204);
    db.workerHeartbeat(worker_id);
    return c.json(job);
  });

  app.post("/jobs/:id/start", async (c) => {
    const { worker_id } = await c.req.json<{ worker_id: string }>();
    const job = db.startJob(c.req.param("id"), worker_id);
    if (!job) return c.json({ error: "cannot start" }, 409);
    return c.json(job);
  });

  app.post("/jobs/:id/complete", async (c) => {
    const { worker_id, result } = await c.req.json<{
      worker_id: string;
      result: JobResult;
    }>();
    const job = db.completeJob(c.req.param("id"), worker_id, result);
    if (!job) return c.json({ error: "cannot complete" }, 409);
    db.incrementWorkerStats(worker_id, "jobs_completed");

    // Record usage for rate limit tracking
    db.recordUsage(
      worker_id,
      result.tokens?.prompt ?? 0,
      result.tokens?.completion ?? 0
    );

    return c.json(job);
  });

  /** Worker releases a job back to the queue (e.g., provider rate-limited) */
  app.post("/jobs/:id/release", async (c) => {
    const { worker_id } = await c.req.json<{ worker_id: string }>();
    const job = db.releaseJob(c.req.param("id"), worker_id);
    if (!job) return c.json({ error: "cannot release" }, 409);
    return c.json(job);
  });

  app.post("/jobs/:id/fail", async (c) => {
    const { worker_id, error } = await c.req.json<{
      worker_id: string;
      error: string;
    }>();
    const job = db.failJob(c.req.param("id"), worker_id, error);
    if (!job) return c.json({ error: "cannot fail" }, 409);
    db.incrementWorkerStats(worker_id, "jobs_failed");
    return c.json(job);
  });

  app.get("/queue/stats", (c) => c.json(db.stats()));

  app.get("/queue/depth", (c) => {
    const depth = db.depth();
    const stats = db.stats();
    return c.json({ depth, soft_max: stats.soft_max, can_plan: stats.can_plan });
  });

  app.post("/workers/register", async (c) => {
    const body = await c.req.json();
    const worker = db.registerWorker(body);
    return c.json(worker);
  });

  app.get("/workers", (c) => c.json(db.listWorkers()));

  app.get("/workers/:id/rate-limit", (c) => {
    return c.json(db.getRateLimitStatus(c.req.param("id")));
  });

  app.get("/workers/rate-limits", (c) => {
    return c.json(db.getAllRateLimitStatus());
  });

  app.post("/workers/:id/heartbeat", (c) => {
    db.workerHeartbeat(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/maintenance/purge", async (c) => {
    const { older_than_seconds } = await c.req.json<{ older_than_seconds?: number }>();
    const count = db.purgeOld(older_than_seconds);
    return c.json({ purged: count });
  });

  return app;
}
