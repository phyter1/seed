// ren-queue: Priority-based inference task queue for the Ren machine fleet

export type JobStatus = "queued" | "claimed" | "running" | "done" | "failed";

export type Capability = "speed" | "reasoning" | "code" | "frontier" | "any";

export type Priority = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type Locality = "local" | "cloud";

export interface JobPayload {
  /** OpenAI-compatible messages array */
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  /** Optional: specific model override (e.g., "qwen3-coder:30b") */
  model?: string;
  /** Optional inference params */
  temperature?: number;
  max_tokens?: number;
  /** Optional: additional context for the worker */
  metadata?: Record<string, unknown>;
}

export interface JobResult {
  /** The model response */
  content: string;
  /** Which model actually ran it */
  model: string;
  /** Which machine ran it */
  worker_id: string;
  /** Inference time in ms */
  duration_ms: number;
  /** Token counts if available */
  tokens?: {
    prompt: number;
    completion: number;
  };
  /** Error message if failed */
  error?: string;
}

export interface Job {
  id: string;
  priority: Priority;
  capability: Capability;
  status: JobStatus;
  payload: JobPayload;
  result: JobResult | null;
  creator: string;
  worker_id: string | null;
  created_at: string;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  /** TTL in seconds — job expires if not completed within this time after creation */
  ttl_seconds: number | null;
  /** If true, only local workers can claim this job. Cloud workers are excluded.
   *  This is the compliance enforcement layer — sensitive data (PII, PHI, tax data)
   *  must never leave the local network. Enforced at the queue level, not the client. */
  local_only: boolean;
}

export interface CreateJobRequest {
  priority?: Priority;
  capability?: Capability;
  payload: JobPayload;
  creator: string;
  ttl_seconds?: number;
  /** If true, only local workers can claim this job. Enforced at the queue level. */
  local_only?: boolean;
}

export interface QueueStats {
  total: number;
  by_status: Record<JobStatus, number>;
  by_capability: Record<Capability, number>;
  depth: number; // queued + claimed + running (active work)
  soft_max: number;
  can_plan: boolean; // depth < soft_max
}

export interface WorkerConfig {
  /** Unique worker identifier (e.g., "local-mlx") */
  id: string;
  /** What this worker is good at */
  capability: Capability;
  /** Local inference endpoint */
  endpoint: string;
  /** Poll interval in ms */
  poll_interval_ms: number;
  /** Queue server URL */
  queue_url: string;
}

export interface WorkerRegistration {
  id: string;
  capability: Capability;
  /** Where this worker runs: "local" (on-network) or "cloud" (external API) */
  locality: Locality;
  provider_id: string | null;
  default_model: string | null;
  hostname: string;
  endpoint: string;
  last_heartbeat: string;
  jobs_completed: number;
  jobs_failed: number;
  rate_limits: RateLimits | null;
}

/** Rate limits a worker declares at registration. All fields optional — omit what doesn't apply. */
export interface RateLimits {
  rpm?: number;    // requests per minute
  rpd?: number;    // requests per day
  tpm?: number;    // tokens per minute
  tpd?: number;    // tokens per day
}

/** Current usage snapshot for a worker within its rate limit windows */
export interface RateLimitStatus {
  worker_id: string;
  requests_this_minute: number;
  requests_today: number;
  tokens_this_minute: number;
  tokens_today: number;
  limits: RateLimits | null;
  available: boolean;       // can this worker accept work right now?
  next_available_in_ms: number | null; // if not available, when will it be?
}
