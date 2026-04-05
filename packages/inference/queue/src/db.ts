import { Database } from "bun:sqlite";
import type {
  Job,
  JobStatus,
  Capability,
  CreateJobRequest,
  JobResult,
  QueueStats,
  WorkerRegistration,
  RateLimits,
  RateLimitStatus,
} from "./types";

const SOFT_MAX = 10;
const STALE_CLAIM_SECONDS = 300; // 5 minutes — reclaim jobs from dead workers

export class QueueDB {
  private db: Database;

  constructor(path: string = "queue.db") {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  private migrate() {
    // Add new columns to existing databases
    try { this.db.exec("ALTER TABLE jobs ADD COLUMN local_only INTEGER NOT NULL DEFAULT 0"); } catch {}
    try { this.db.exec("ALTER TABLE workers ADD COLUMN locality TEXT NOT NULL DEFAULT 'local'"); } catch {}
    try { this.db.exec("ALTER TABLE workers ADD COLUMN provider_id TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE workers ADD COLUMN default_model TEXT"); } catch {}

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        priority INTEGER NOT NULL DEFAULT 5,
        capability TEXT NOT NULL DEFAULT 'any',
        local_only INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued',
        payload TEXT NOT NULL,
        result TEXT,
        creator TEXT NOT NULL,
        worker_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        claimed_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        ttl_seconds INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority DESC);
      CREATE INDEX IF NOT EXISTS idx_jobs_capability ON jobs(capability);
      CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON jobs(status, priority DESC, created_at ASC);

      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        capability TEXT NOT NULL,
        locality TEXT NOT NULL DEFAULT 'local',
        provider_id TEXT,
        default_model TEXT,
        hostname TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        last_heartbeat TEXT NOT NULL DEFAULT (datetime('now')),
        jobs_completed INTEGER NOT NULL DEFAULT 0,
        jobs_failed INTEGER NOT NULL DEFAULT 0,
        rate_limits TEXT
      );

      CREATE TABLE IF NOT EXISTS usage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        worker_id TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        tokens_prompt INTEGER NOT NULL DEFAULT 0,
        tokens_completion INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (worker_id) REFERENCES workers(id)
      );

      CREATE INDEX IF NOT EXISTS idx_usage_worker_time ON usage_log(worker_id, timestamp);
    `);
  }

  // --- Job operations ---

  createJob(req: CreateJobRequest): Job {
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO jobs (id, priority, capability, local_only, status, payload, creator, ttl_seconds)
      VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
      RETURNING *
    `);
    const row = stmt.get(
      id,
      req.priority ?? 5,
      req.capability ?? "any",
      req.local_only ? 1 : 0,
      JSON.stringify(req.payload),
      req.creator,
      req.ttl_seconds ?? null
    ) as any;
    return this.rowToJob(row);
  }

  /**
   * Atomically claim the highest-priority job matching the capability.
   * Enforces local_only: if a job is local_only=1, only workers with locality='local' can claim it.
   * Returns null if no job is available.
   */
  claimJob(workerId: string, capability: Capability): Job | null {
    // First, reclaim stale jobs
    this.reclaimStale();

    // Expire TTL'd jobs
    this.expireTTL();

    // Look up the claiming worker's locality
    const worker = this.db.prepare("SELECT locality FROM workers WHERE id = ?").get(workerId) as { locality: string } | undefined;
    const workerLocality = worker?.locality ?? "local";

    // Atomically claim: find the best match and update in one statement
    // COMPLIANCE ENFORCEMENT: if job.local_only=1 and worker.locality='cloud', skip it.
    // Cloud workers can only claim jobs where local_only=0.
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = 'claimed', worker_id = ?, claimed_at = datetime('now')
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'queued'
          AND (capability = ? OR capability = 'any' OR ? = 'any')
          AND (local_only = 0 OR ? = 'local')
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
      )
      RETURNING *
    `);
    const row = stmt.get(workerId, capability, capability, workerLocality) as any;
    return row ? this.rowToJob(row) : null;
  }

  /** Worker signals it's starting inference */
  startJob(jobId: string, workerId: string): Job | null {
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = 'running', started_at = datetime('now')
      WHERE id = ? AND worker_id = ? AND status = 'claimed'
      RETURNING *
    `);
    const row = stmt.get(jobId, workerId) as any;
    return row ? this.rowToJob(row) : null;
  }

  /** Worker reports completion */
  completeJob(jobId: string, workerId: string, result: JobResult): Job | null {
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = 'done', result = ?, completed_at = datetime('now')
      WHERE id = ? AND worker_id = ? AND status = 'running'
      RETURNING *
    `);
    const row = stmt.get(JSON.stringify(result), jobId, workerId) as any;
    return row ? this.rowToJob(row) : null;
  }

  /** Worker reports failure */
  failJob(jobId: string, workerId: string, error: string): Job | null {
    const result: Partial<JobResult> = {
      error,
      worker_id: workerId,
      model: "",
      content: "",
      duration_ms: 0,
    };
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = 'failed', result = ?, completed_at = datetime('now')
      WHERE id = ? AND worker_id = ? AND status IN ('claimed', 'running')
      RETURNING *
    `);
    const row = stmt.get(JSON.stringify(result), jobId, workerId) as any;
    return row ? this.rowToJob(row) : null;
  }

  /** Release a job back to the queue — used when a worker can't complete (e.g., rate-limited) */
  releaseJob(jobId: string, workerId: string): Job | null {
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = 'queued', worker_id = NULL, claimed_at = NULL, started_at = NULL
      WHERE id = ? AND worker_id = ? AND status IN ('claimed', 'running')
      RETURNING *
    `);
    const row = stmt.get(jobId, workerId) as any;
    return row ? this.rowToJob(row) : null;
  }

  getJob(id: string): Job | null {
    const stmt = this.db.prepare("SELECT * FROM jobs WHERE id = ?");
    const row = stmt.get(id) as any;
    return row ? this.rowToJob(row) : null;
  }

  listJobs(opts?: {
    status?: JobStatus;
    capability?: Capability;
    creator?: string;
    limit?: number;
    offset?: number;
  }): Job[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (opts?.status) {
      conditions.push("status = ?");
      params.push(opts.status);
    }
    if (opts?.capability) {
      conditions.push("capability = ?");
      params.push(opts.capability);
    }
    if (opts?.creator) {
      conditions.push("creator = ?");
      params.push(opts.creator);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    const stmt = this.db.prepare(
      `SELECT * FROM jobs ${where} ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?`
    );
    const rows = stmt.all(...params, limit, offset) as any[];
    return rows.map((r) => this.rowToJob(r));
  }

  cancelJob(id: string): boolean {
    const stmt = this.db.prepare(
      "DELETE FROM jobs WHERE id = ? AND status = 'queued'"
    );
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /** Purge completed/failed jobs older than N seconds */
  purgeOld(olderThanSeconds: number = 86400): number {
    const stmt = this.db.prepare(`
      DELETE FROM jobs
      WHERE status IN ('done', 'failed')
        AND completed_at < datetime('now', ? || ' seconds')
    `);
    const result = stmt.run(`-${olderThanSeconds}`);
    return result.changes;
  }

  // --- Queue stats ---

  stats(): QueueStats {
    const statusCounts = this.db
      .prepare("SELECT status, COUNT(*) as count FROM jobs GROUP BY status")
      .all() as Array<{ status: JobStatus; count: number }>;

    const capCounts = this.db
      .prepare(
        "SELECT capability, COUNT(*) as count FROM jobs WHERE status = 'queued' GROUP BY capability"
      )
      .all() as Array<{ capability: Capability; count: number }>;

    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) byStatus[row.status] = row.count;

    const byCap: Record<string, number> = {};
    for (const row of capCounts) byCap[row.capability] = row.count;

    const depth =
      (byStatus["queued"] ?? 0) +
      (byStatus["claimed"] ?? 0) +
      (byStatus["running"] ?? 0);

    return {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      by_status: byStatus as Record<JobStatus, number>,
      by_capability: byCap as Record<Capability, number>,
      depth,
      soft_max: SOFT_MAX,
      can_plan: depth < SOFT_MAX,
    };
  }

  depth(): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as n FROM jobs WHERE status IN ('queued', 'claimed', 'running')"
      )
      .get() as { n: number };
    return row.n;
  }

  // --- Worker registration ---

  registerWorker(reg: {
    id: string;
    capability: Capability;
    locality?: "local" | "cloud";
    provider_id?: string | null;
    default_model?: string | null;
    hostname: string;
    endpoint: string;
    rate_limits?: RateLimits;
  }): WorkerRegistration {
    const stmt = this.db.prepare(`
      INSERT INTO workers (id, capability, locality, provider_id, default_model, hostname, endpoint, rate_limits)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        capability = excluded.capability,
        locality = excluded.locality,
        provider_id = excluded.provider_id,
        default_model = excluded.default_model,
        hostname = excluded.hostname,
        endpoint = excluded.endpoint,
        rate_limits = excluded.rate_limits,
        last_heartbeat = datetime('now')
      RETURNING *
    `);
    const row = stmt.get(
      reg.id,
      reg.capability,
      reg.locality ?? "local",
      reg.provider_id ?? null,
      reg.default_model ?? null,
      reg.hostname,
      reg.endpoint,
      reg.rate_limits ? JSON.stringify(reg.rate_limits) : null
    ) as any;
    return this.rowToWorker(row);
  }

  workerHeartbeat(workerId: string): void {
    this.db
      .prepare("UPDATE workers SET last_heartbeat = datetime('now') WHERE id = ?")
      .run(workerId);
  }

  incrementWorkerStats(workerId: string, field: "jobs_completed" | "jobs_failed"): void {
    this.db
      .prepare(`UPDATE workers SET ${field} = ${field} + 1 WHERE id = ?`)
      .run(workerId);
  }

  listWorkers(): WorkerRegistration[] {
    return this.db
      .prepare("SELECT * FROM workers ORDER BY last_heartbeat DESC")
      .all()
      .map((r: any) => this.rowToWorker(r)) as WorkerRegistration[];
  }

  // --- Rate limit tracking ---

  /** Record a completed request's usage for rate limit tracking */
  recordUsage(workerId: string, tokensPrompt: number, tokensCompletion: number): void {
    this.db
      .prepare(
        "INSERT INTO usage_log (worker_id, tokens_prompt, tokens_completion) VALUES (?, ?, ?)"
      )
      .run(workerId, tokensPrompt, tokensCompletion);
  }

  /** Get rate limit status for a worker */
  getRateLimitStatus(workerId: string): RateLimitStatus {
    const worker = this.db
      .prepare("SELECT rate_limits FROM workers WHERE id = ?")
      .get(workerId) as { rate_limits: string | null } | undefined;

    const limits: RateLimits | null = worker?.rate_limits
      ? JSON.parse(worker.rate_limits)
      : null;

    // Count requests and tokens in the last minute
    const minuteAgo = this.db
      .prepare(
        `SELECT COUNT(*) as req_count,
                COALESCE(SUM(tokens_prompt + tokens_completion), 0) as token_count
         FROM usage_log
         WHERE worker_id = ? AND timestamp > datetime('now', '-1 minute')`
      )
      .get(workerId) as { req_count: number; token_count: number };

    // Count requests and tokens today (since midnight UTC)
    const today = this.db
      .prepare(
        `SELECT COUNT(*) as req_count,
                COALESCE(SUM(tokens_prompt + tokens_completion), 0) as token_count
         FROM usage_log
         WHERE worker_id = ? AND timestamp > datetime('now', 'start of day')`
      )
      .get(workerId) as { req_count: number; token_count: number };

    const available = this.isWithinLimits(limits, minuteAgo, today);

    // Estimate when the worker will be available again
    let next_available_in_ms: number | null = null;
    if (!available && limits) {
      if (limits.rpm && minuteAgo.req_count >= limits.rpm) {
        // Find oldest request in the last minute — that's when the window slides
        const oldest = this.db
          .prepare(
            `SELECT timestamp FROM usage_log
             WHERE worker_id = ? AND timestamp > datetime('now', '-1 minute')
             ORDER BY timestamp ASC LIMIT 1`
          )
          .get(workerId) as { timestamp: string } | undefined;
        if (oldest) {
          const oldestTime = new Date(oldest.timestamp + "Z").getTime();
          next_available_in_ms = Math.max(0, oldestTime + 60_000 - Date.now());
        }
      } else if (limits.tpm && minuteAgo.token_count >= limits.tpm) {
        next_available_in_ms = 60_000; // worst case, wait a minute
      } else if (limits.rpd && today.req_count >= limits.rpd) {
        // Daily limit hit — calculate time until midnight UTC
        const now = new Date();
        const midnight = new Date(now);
        midnight.setUTCHours(24, 0, 0, 0);
        next_available_in_ms = midnight.getTime() - now.getTime();
      } else if (limits.tpd && today.token_count >= limits.tpd) {
        const now = new Date();
        const midnight = new Date(now);
        midnight.setUTCHours(24, 0, 0, 0);
        next_available_in_ms = midnight.getTime() - now.getTime();
      }
    }

    return {
      worker_id: workerId,
      requests_this_minute: minuteAgo.req_count,
      requests_today: today.req_count,
      tokens_this_minute: minuteAgo.token_count,
      tokens_today: today.token_count,
      limits,
      available,
      next_available_in_ms,
    };
  }

  /** Get rate limit status for all workers */
  getAllRateLimitStatus(): RateLimitStatus[] {
    const workers = this.db
      .prepare("SELECT id FROM workers")
      .all() as Array<{ id: string }>;
    return workers.map((w) => this.getRateLimitStatus(w.id));
  }

  /** Check if a worker is within its rate limits */
  isWorkerAvailable(workerId: string): boolean {
    return this.getRateLimitStatus(workerId).available;
  }

  /** Purge old usage logs (keep last 24h) */
  purgeUsageLogs(olderThanSeconds: number = 86400): number {
    const stmt = this.db.prepare(
      `DELETE FROM usage_log WHERE timestamp < datetime('now', '-${olderThanSeconds} seconds')`
    );
    return stmt.run().changes;
  }

  private isWithinLimits(
    limits: RateLimits | null,
    minute: { req_count: number; token_count: number },
    day: { req_count: number; token_count: number }
  ): boolean {
    if (!limits) return true; // no limits = local worker, always available
    if (limits.rpm && minute.req_count >= limits.rpm) return false;
    if (limits.rpd && day.req_count >= limits.rpd) return false;
    if (limits.tpm && minute.token_count >= limits.tpm) return false;
    if (limits.tpd && day.token_count >= limits.tpd) return false;
    return true;
  }

  // --- Internal ---

  private rowToWorker(row: any): WorkerRegistration {
    return {
      ...row,
      rate_limits: row.rate_limits ? JSON.parse(row.rate_limits) : null,
    };
  }

  private reclaimStale() {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'queued', worker_id = NULL, claimed_at = NULL
         WHERE status = 'claimed'
           AND claimed_at < datetime('now', '-${STALE_CLAIM_SECONDS} seconds')`
      )
      .run();
  }

  private expireTTL() {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'failed', result = '{"error":"TTL expired"}', completed_at = datetime('now')
         WHERE status = 'queued'
           AND ttl_seconds IS NOT NULL
           AND created_at < datetime('now', '-' || ttl_seconds || ' seconds')`
      )
      .run();
  }

  private rowToJob(row: any): Job {
    return {
      ...row,
      local_only: !!row.local_only,
      payload: JSON.parse(row.payload),
      result: row.result ? JSON.parse(row.result) : null,
    };
  }

  close() {
    this.db.close();
  }
}
