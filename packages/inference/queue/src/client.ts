/**
 * ren-queue client SDK
 *
 * Usage from any producer (heartbeat, Claude session, CLI):
 *
 *   import { QueueClient } from "./client";
 *   const q = new QueueClient("http://ren.local:7654");
 *
 *   // Check if planner can add more
 *   const { can_plan, depth } = await q.depth();
 *
 *   // Submit a job
 *   const job = await q.submit({
 *     payload: { messages: [{ role: "user", content: "Summarize this..." }] },
 *     creator: "heartbeat-deep",
 *     priority: 7,
 *     capability: "reasoning",
 *   });
 *
 *   // Wait for result
 *   const result = await q.waitForResult(job.id, 60_000);
 */

import type { Job, CreateJobRequest, QueueStats, WorkerRegistration } from "./types";

export class QueueClient {
  constructor(private baseUrl: string = "http://ren.local:7654") {}

  async submit(req: CreateJobRequest): Promise<Job> {
    const res = await fetch(`${this.baseUrl}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`Submit failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getJob(id: string): Promise<Job | null> {
    const res = await fetch(`${this.baseUrl}/jobs/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Get failed: ${res.status}`);
    return res.json();
  }

  async cancel(id: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/jobs/${id}`, { method: "DELETE" });
    return res.ok;
  }

  async stats(): Promise<QueueStats> {
    const res = await fetch(`${this.baseUrl}/queue/stats`);
    return res.json();
  }

  async depth(): Promise<{ depth: number; soft_max: number; can_plan: boolean }> {
    const res = await fetch(`${this.baseUrl}/queue/depth`);
    return res.json();
  }

  async workers(): Promise<WorkerRegistration[]> {
    const res = await fetch(`${this.baseUrl}/workers`);
    return res.json();
  }

  async listJobs(opts?: {
    status?: string;
    capability?: string;
    creator?: string;
    limit?: number;
  }): Promise<Job[]> {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.capability) params.set("capability", opts.capability);
    if (opts?.creator) params.set("creator", opts.creator);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const res = await fetch(`${this.baseUrl}/jobs?${params}`);
    return res.json();
  }

  /**
   * Poll until job reaches terminal state (done/failed) or timeout.
   * Returns the completed job or throws on timeout.
   */
  async waitForResult(jobId: string, timeoutMs: number = 120_000, pollMs: number = 1000): Promise<Job> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = await this.getJob(jobId);
      if (job && (job.status === "done" || job.status === "failed")) {
        return job;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`Timeout waiting for job ${jobId} after ${timeoutMs}ms`);
  }
}

// --- CLI mode: submit a one-off job from the command line ---
// Usage: bun run src/client.ts "What is the capital of France?" --priority 8 --capability reasoning

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help") {
    console.log(`Usage: bun run src/client.ts "<prompt>" [--priority N] [--capability speed|reasoning|code] [--creator NAME] [--model MODEL] [--wait]`);
    process.exit(0);
  }

  const prompt = args[0];
  let priority = 5;
  let capability = "any";
  let creator = "cli";
  let model: string | undefined;
  let wait = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--priority") priority = Number(args[++i]);
    if (args[i] === "--capability") capability = args[++i];
    if (args[i] === "--creator") creator = args[++i];
    if (args[i] === "--model") model = args[++i];
    if (args[i] === "--wait") wait = true;
  }

  const client = new QueueClient(process.env.QUEUE_URL ?? "http://ren.local:7654");

  const job = await client.submit({
    payload: {
      messages: [{ role: "user", content: prompt }],
      model,
    },
    priority: priority as any,
    capability: capability as any,
    creator,
  });

  console.log(`Job ${job.id} queued (priority: ${job.priority}, capability: ${job.capability})`);

  if (wait) {
    console.log("Waiting for result...");
    const completed = await client.waitForResult(job.id);
    if (completed.status === "done") {
      console.log(`\n--- Result (${completed.result?.model}, ${completed.result?.duration_ms}ms) ---`);
      console.log(completed.result?.content);
    } else {
      console.error(`Job failed: ${completed.result?.error}`);
      process.exit(1);
    }
  }
}
