/**
 * Cost Tracker
 *
 * Aggregates token usage and cost into 1-minute windows per session. Windows
 * are persisted to the `agent_metrics` table; the dashboard API reads from
 * this table for period totals and breakdowns.
 *
 * Pricing model:
 *   - Local models (service_type ∈ {fleet-router, inference-worker}) = $0 cost,
 *     but token counts are still tracked.
 *   - CLI agents: cost is taken from the event's cost_cents field (computed
 *     upstream by the agent's own OTLP instrumentation). If the upstream did
 *     not populate cost_cents, we apply the built-in rate table as a fallback.
 *
 * Window flushing:
 *   - In-memory window buffers per session, bucketed by window_start.
 *   - A periodic flush (default: every 60s) writes closed windows to DB.
 *   - flushAll() can be called synchronously in tests.
 */

import type { ControlDB } from "./db";
import type { TelemetryEventBus } from "./event-bus";
import type { CostRate, NormalizedEvent, ServiceType } from "./types";

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_FLUSH_INTERVAL_MS = 60_000;

/**
 * Fallback cost rates (cents per 1M tokens, {prompt, completion}).
 * Only used when upstream doesn't supply cost_cents. Values are intentionally
 * conservative current-gen defaults; tune via setCostRate().
 *
 * Local models: $0 for both directions.
 */
const DEFAULT_RATES: Record<ServiceType, CostRate> = {
  claude: {
    prompt_cents_per_mtok: 300,
    completion_cents_per_mtok: 1500,
  },
  codex: {
    prompt_cents_per_mtok: 125,
    completion_cents_per_mtok: 1000,
  },
  gemini: {
    prompt_cents_per_mtok: 30,
    completion_cents_per_mtok: 250,
  },
  "fleet-router": {
    prompt_cents_per_mtok: 0,
    completion_cents_per_mtok: 0,
  },
  "inference-worker": {
    prompt_cents_per_mtok: 0,
    completion_cents_per_mtok: 0,
  },
};

interface WindowBucket {
  session_id: string;
  window_start: number; // epoch ms (truncated to window boundary)
  window_end: number;
  token_count: number;
  cost_cents: number;
  event_count: number;
}

export interface CostTrackerOptions {
  windowMs?: number;
  flushIntervalMs?: number;
}

export class CostTracker {
  private readonly windowMs: number;
  private readonly flushIntervalMs: number;
  private readonly rates: Map<ServiceType, CostRate> = new Map();
  /** key = `${session_id}:${window_start}` */
  private buckets: Map<string, WindowBucket> = new Map();
  private unsubscribe: (() => void) | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: ControlDB,
    private readonly bus: TelemetryEventBus,
    options?: CostTrackerOptions
  ) {
    this.windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
    this.flushIntervalMs = options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    for (const [k, v] of Object.entries(DEFAULT_RATES)) {
      this.rates.set(k as ServiceType, v);
    }
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.onEvent((event) => this.handle(event));
    this.flushTimer = setInterval(() => this.flushClosedWindows(), this.flushIntervalMs);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Flush any remaining windows on stop
    this.flushAll();
  }

  /** Override cost rates (e.g. from configuration). */
  setCostRate(serviceType: ServiceType, rate: CostRate): void {
    this.rates.set(serviceType, rate);
  }

  getCostRate(serviceType: ServiceType): CostRate {
    return this.rates.get(serviceType) ?? DEFAULT_RATES.claude;
  }

  /**
   * Compute fallback cost in cents from prompt/completion token counts.
   * Used when upstream telemetry didn't include a cost figure.
   */
  computeCost(
    serviceType: ServiceType,
    tokensPrompt: number,
    tokensCompletion: number
  ): number {
    const rate = this.getCostRate(serviceType);
    const promptCost = (tokensPrompt * rate.prompt_cents_per_mtok) / 1_000_000;
    const completionCost =
      (tokensCompletion * rate.completion_cents_per_mtok) / 1_000_000;
    return Math.round(promptCost + completionCost);
  }

  /** Public so tests can invoke directly. */
  handle(event: NormalizedEvent): void {
    if (!event.session_id) return;
    if (event.token_count <= 0 && event.cost_cents <= 0) return;

    const eventMs = event.timestamp.getTime();
    const windowStart = Math.floor(eventMs / this.windowMs) * this.windowMs;
    const windowEnd = windowStart + this.windowMs;
    const key = `${event.session_id}:${windowStart}`;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        session_id: event.session_id,
        window_start: windowStart,
        window_end: windowEnd,
        token_count: 0,
        cost_cents: 0,
        event_count: 0,
      };
      this.buckets.set(key, bucket);
    }

    bucket.token_count += event.token_count;
    bucket.cost_cents += event.cost_cents;
    bucket.event_count += 1;
  }

  /** Flush windows that have ended (window_end <= now). */
  flushClosedWindows(now: number = Date.now()): number {
    let flushed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.window_end <= now) {
        this.writeBucket(bucket);
        this.buckets.delete(key);
        flushed++;
      }
    }
    return flushed;
  }

  /** Flush every open bucket (used on shutdown / in tests). */
  flushAll(): number {
    let flushed = 0;
    for (const bucket of this.buckets.values()) {
      this.writeBucket(bucket);
      flushed++;
    }
    this.buckets.clear();
    return flushed;
  }

  private writeBucket(bucket: WindowBucket): void {
    this.db.insertMetricWindow({
      session_id: bucket.session_id,
      window_start: new Date(bucket.window_start).toISOString(),
      window_end: new Date(bucket.window_end).toISOString(),
      token_count: bucket.token_count,
      cost_cents: bucket.cost_cents,
      event_count: bucket.event_count,
    });
  }
}
