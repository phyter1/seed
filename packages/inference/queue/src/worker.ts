/**
 * ren-queue worker daemon
 *
 * Runs on each machine, polls the queue for jobs matching its capability,
 * runs inference against the local endpoint, reports results.
 *
 * Usage:
 *   WORKER_ID=local-mlx CAPABILITY=speed INFERENCE_URL=http://localhost:8080 QUEUE_URL=http://queue-host:7654 bun run src/worker.ts
 *   PROVIDER_ID=mlx_local WORKER_ID=local-mlx QUEUE_URL=http://queue-host:7654 bun run src/worker.ts
 *
 * Environment:
 *   WORKER_ID       — unique worker name (e.g., "local-mlx", "local-ollama", "groq-cloud")
 *   CAPABILITY      — "speed" | "reasoning" | "code" | "any"
 *   INFERENCE_URL   — inference endpoint (OpenAI-compatible), local or cloud
 *   PROVIDER_ID     — optional provider key from seed.config.json
 *   QUEUE_URL       — queue server URL
 *   POLL_INTERVAL   — ms between polls (default: 2000)
 *   DEFAULT_MODEL   — model name if job doesn't specify one
 *   API_KEY         — bearer token for cloud providers (optional, not needed for local)
 */

import type { Job, JobResult, Capability, RateLimits } from "./types";
import { discoverServerWithRetry } from "./discovery";
import { resolveWorkerConfig } from "./config";

const resolvedConfig = resolveWorkerConfig(process.env);
const WORKER_ID = resolvedConfig.workerId;
const CAPABILITY = resolvedConfig.capability as Capability;
const INFERENCE_URL = resolvedConfig.inferenceUrl;
let QUEUE_URL = resolvedConfig.queueUrl;
const POLL_INTERVAL = resolvedConfig.pollInterval;
const DEFAULT_MODEL = resolvedConfig.defaultModel;
const API_KEY = resolvedConfig.apiKey;
const PROVIDER_ID = resolvedConfig.providerId;

// Rate limits — parsed from env. Format: "rpm=30,rpd=1000,tpm=12000,tpd=100000"
function parseRateLimits(): RateLimits | undefined {
  const raw = process.env.RATE_LIMITS;
  if (!raw) return undefined;
  const limits: RateLimits = {};
  for (const pair of raw.split(",")) {
    const [key, val] = pair.split("=");
    if (key && val) (limits as any)[key.trim()] = Number(val.trim());
  }
  return Object.keys(limits).length > 0 ? limits : undefined;
}
const RATE_LIMITS = parseRateLimits();

if (!WORKER_ID) {
  console.error("WORKER_ID is required");
  process.exit(1);
}
if (!INFERENCE_URL) {
  console.error("INFERENCE_URL is required (or provide PROVIDER_ID backed by seed.config.json)");
  process.exit(1);
}

// --- Queue client ---

async function claimJob(): Promise<Job | "rate_limited" | null> {
  const res = await fetch(`${QUEUE_URL}/jobs/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worker_id: WORKER_ID, capability: CAPABILITY }),
  });
  if (res.status === 204) return null;
  if (res.status === 429) return "rate_limited";
  if (!res.ok) {
    console.error(`Claim failed: ${res.status} ${await res.text()}`);
    return null;
  }
  return res.json();
}

async function startJob(jobId: string): Promise<boolean> {
  const res = await fetch(`${QUEUE_URL}/jobs/${jobId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worker_id: WORKER_ID }),
  });
  return res.ok;
}

async function completeJob(jobId: string, result: JobResult): Promise<void> {
  await fetch(`${QUEUE_URL}/jobs/${jobId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worker_id: WORKER_ID, result }),
  });
}

async function failJob(jobId: string, error: string): Promise<void> {
  await fetch(`${QUEUE_URL}/jobs/${jobId}/fail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worker_id: WORKER_ID, error }),
  });
}

async function sendHeartbeat(): Promise<void> {
  await fetch(`${QUEUE_URL}/workers/${WORKER_ID}/heartbeat`, {
    method: "POST",
  }).catch(() => {}); // non-fatal
}

const LOCALITY = resolvedConfig.locality;

async function registerWorker(): Promise<void> {
  const hostname = (
    await Bun.spawn(["hostname"], { stdout: "pipe" }).stdout.text()
  ).trim();

  // Retry registration — queue server may not be up yet at boot
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const res = await fetch(`${QUEUE_URL}/workers/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: WORKER_ID,
          capability: CAPABILITY,
          locality: LOCALITY,
          hostname,
          endpoint: INFERENCE_URL,
          rate_limits: RATE_LIMITS,
        }),
      });
      if (res.ok) return;
      console.warn(`[${WORKER_ID}] Registration failed (${res.status}), retry ${attempt}/30...`);
    } catch (err: any) {
      console.warn(`[${WORKER_ID}] Registration error: ${err?.code ?? err?.message}, retry ${attempt}/30...`);
    }
    await Bun.sleep(5000);
  }
  throw new Error("Failed to register after 30 attempts");
}

class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

async function releaseJob(jobId: string): Promise<void> {
  // Tell the server to put the job back in the queue
  await fetch(`${QUEUE_URL}/jobs/${jobId}/release`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worker_id: WORKER_ID }),
  });
}

// --- Inference ---

async function runInference(job: Job): Promise<JobResult> {
  const model = job.payload.model ?? DEFAULT_MODEL;
  const start = performance.now();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const res = await fetch(`${INFERENCE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: job.payload.messages,
      temperature: job.payload.temperature ?? 0.7,
      max_tokens: job.payload.max_tokens ?? 2048,
    }),
  });

  if (res.status === 429) {
    throw new RateLimitError(
      `Provider rate limited (429): ${await res.text()}`
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Inference failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const duration_ms = Math.round(performance.now() - start);

  // Reasoning models (nemotron, etc.) may put output in `reasoning` field
  // with empty `content`. Check both.
  const msg = data.choices?.[0]?.message;
  const content = msg?.content || msg?.reasoning || "";

  return {
    content,
    model: data.model ?? model,
    worker_id: WORKER_ID!,
    duration_ms,
    tokens: data.usage
      ? {
          prompt: data.usage.prompt_tokens,
          completion: data.usage.completion_tokens,
        }
      : undefined,
  };
}

// --- Main loop ---

async function processJob(job: Job): Promise<void> {
  const msgPreview = job.payload.messages.at(-1)?.content?.slice(0, 80) ?? "?";
  console.log(
    `[${WORKER_ID}] Processing job ${job.id.slice(0, 8)} (p${job.priority}, ${job.capability}): ${msgPreview}...`
  );

  const started = await startJob(job.id);
  if (!started) {
    console.warn(`[${WORKER_ID}] Could not start job ${job.id.slice(0, 8)} — skipping`);
    return;
  }

  try {
    const result = await runInference(job);
    await completeJob(job.id, result);
    console.log(
      `[${WORKER_ID}] Completed job ${job.id.slice(0, 8)} in ${result.duration_ms}ms (${result.model})`
    );
  } catch (err: any) {
    if (err instanceof RateLimitError) {
      // Provider hit us with a 429 — release the job so another worker can take it
      console.warn(`[${WORKER_ID}] Provider rate limit on job ${job.id.slice(0, 8)} — releasing back to queue`);
      await releaseJob(job.id);
      return;
    }
    const errorMsg = err?.message ?? String(err);
    console.error(`[${WORKER_ID}] Failed job ${job.id.slice(0, 8)}: ${errorMsg}`);
    await failJob(job.id, errorMsg);
  }
}

const RATE_LIMIT_BACKOFF_MS = 30_000; // back off 30s when rate-limited

async function poll(): Promise<number> {
  try {
    const result = await claimJob();

    if (result === "rate_limited") {
      console.log(`[${WORKER_ID}] Rate limited — backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s`);
      return RATE_LIMIT_BACKOFF_MS;
    }

    if (result && typeof result === "object") {
      await processJob(result);
      return 0; // immediately poll again after completing a job
    }

    return POLL_INTERVAL; // no jobs, normal poll
  } catch (err: any) {
    console.error(`[${WORKER_ID}] Poll error: ${err?.message}`);
    return POLL_INTERVAL;
  }
}

async function main() {
  console.log(`[${WORKER_ID}] Starting worker`);
  console.log(`  Capability: ${CAPABILITY}`);
  console.log(`  Provider:   ${PROVIDER_ID ?? "(unbound)"}`);
  console.log(`  Inference:  ${INFERENCE_URL}`);

  // Auto-discover queue server if QUEUE_URL not provided
  if (!QUEUE_URL) {
    console.log(`  Queue:      (discovering via mDNS...)`);
    QUEUE_URL = await discoverServerWithRetry();
  }

  console.log(`  Queue:      ${QUEUE_URL}`);
  console.log(`  Poll:       ${POLL_INTERVAL}ms`);
  console.log(`  Model:      ${DEFAULT_MODEL || "(from job)"}`);
  console.log(`  API Key:    ${API_KEY ? API_KEY.slice(0, 8) + "..." : "(none)"}`);

  await registerWorker();
  console.log(`[${WORKER_ID}] Registered`);

  // Worker heartbeat every 30s
  setInterval(() => sendHeartbeat(), 30_000);

  // Main poll loop
  while (true) {
    const sleepMs = await poll();
    if (sleepMs > 0) await Bun.sleep(sleepMs);
  }
}

main().catch((err) => {
  console.error("Worker fatal:", err);
  process.exit(1);
});
