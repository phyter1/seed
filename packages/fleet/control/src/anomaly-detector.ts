/**
 * Anomaly Detector
 *
 * Runs periodic passes over the metric windows table to detect:
 *
 *   1. Cost spike: a session's tokens/minute rate is N× higher than the
 *      average of all other active sessions (multiplier configurable).
 *
 *   2. Token rate anomaly: absolute tokens/minute exceeds a fixed ceiling.
 *
 *   3. Session health scoring: assigns green/yellow/red health based on
 *      recent activity and rate signals.
 *
 * This module does NOT send notifications directly — it records anomalies
 * to the audit log and emits AnomalyDetected events. Downstream handlers
 * (e.g. the WebSocket broadcaster) can surface them to dashboards.
 */

import type { ControlDB } from "./db";
import type { HealthLevel } from "./types";

const DEFAULT_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_COST_MULTIPLIER = 3.0;
const DEFAULT_TOKEN_RATE_CEILING = 50_000; // tokens/minute
const DEFAULT_LOOKBACK_MINUTES = 60;
const DEFAULT_MIN_DURATION_MINUTES = 1;

export interface AnomalyDetectorOptions {
  checkIntervalMs?: number;
  /** Sessions exceeding this multiplier of other sessions' mean rate trigger a spike. */
  costMultiplier?: number;
  /** Absolute ceiling for tokens/minute — higher triggers a rate anomaly. */
  tokenRateCeiling?: number;
  /** How far back (minutes) to look for metric windows. */
  lookbackMinutes?: number;
  /** Minimum session duration in minutes to be considered for anomaly checks. */
  minDurationMinutes?: number;
  /** Dedup window for alerts (minutes). */
  dedupMinutes?: number;
}

export interface AnomalyDetected {
  type: "cost_spike" | "token_rate";
  session_id: string;
  tokens_per_minute: number;
  ratio?: number;
  detected_at: string;
  details: string;
}

type AnomalyHandler = (a: AnomalyDetected) => void;

export class AnomalyDetector {
  private readonly checkIntervalMs: number;
  private readonly costMultiplier: number;
  private readonly tokenRateCeiling: number;
  private readonly lookbackMinutes: number;
  private readonly minDurationMinutes: number;
  private readonly dedupMinutes: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly handlers = new Set<AnomalyHandler>();
  /** session_id → epoch ms of last alert */
  private readonly lastAlerts = new Map<string, number>();

  constructor(
    private readonly db: ControlDB,
    options?: AnomalyDetectorOptions
  ) {
    this.checkIntervalMs = options?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this.costMultiplier = options?.costMultiplier ?? DEFAULT_COST_MULTIPLIER;
    this.tokenRateCeiling =
      options?.tokenRateCeiling ?? DEFAULT_TOKEN_RATE_CEILING;
    this.lookbackMinutes =
      options?.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES;
    this.minDurationMinutes =
      options?.minDurationMinutes ?? DEFAULT_MIN_DURATION_MINUTES;
    this.dedupMinutes = options?.dedupMinutes ?? 15;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.check();
      } catch (err) {
        console.error("[anomaly-detector] check failed:", err);
      }
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onAnomaly(handler: AnomalyHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Public: run a single detection pass. Returns the anomalies surfaced
   * this pass (after dedup filtering).
   */
  check(): AnomalyDetected[] {
    const rates = this.db.getSessionTokenRates(
      this.lookbackMinutes,
      this.minDurationMinutes
    );
    if (rates.length === 0) return [];

    const found: AnomalyDetected[] = [];
    const now = Date.now();
    const dedupMs = this.dedupMinutes * 60_000;

    // Cost spike detection (needs ≥2 sessions)
    if (rates.length >= 2) {
      for (const session of rates) {
        const others = rates.filter((r) => r.session_id !== session.session_id);
        const avg =
          others.reduce((sum, r) => sum + r.tokens_per_minute, 0) / others.length;
        if (avg <= 0) continue;
        const ratio = session.tokens_per_minute / avg;
        if (ratio >= this.costMultiplier) {
          if (this.shouldAlert(session.session_id, now, dedupMs)) {
            const anomaly: AnomalyDetected = {
              type: "cost_spike",
              session_id: session.session_id,
              tokens_per_minute: session.tokens_per_minute,
              ratio,
              detected_at: new Date(now).toISOString(),
              details: `tokens/min ${session.tokens_per_minute.toFixed(
                0
              )} is ${ratio.toFixed(2)}× the mean of other sessions (${avg.toFixed(0)})`,
            };
            this.record(anomaly);
            found.push(anomaly);
          }
        }
      }
    }

    // Token rate ceiling (absolute)
    for (const session of rates) {
      if (session.tokens_per_minute >= this.tokenRateCeiling) {
        if (this.shouldAlert(session.session_id, now, dedupMs)) {
          const anomaly: AnomalyDetected = {
            type: "token_rate",
            session_id: session.session_id,
            tokens_per_minute: session.tokens_per_minute,
            detected_at: new Date(now).toISOString(),
            details: `tokens/min ${session.tokens_per_minute.toFixed(
              0
            )} exceeds ceiling ${this.tokenRateCeiling}`,
          };
          this.record(anomaly);
          found.push(anomaly);
        }
      }
    }

    return found;
  }

  /**
   * Derive a health level from the session's recent activity.
   * - red:    idle > 15 min (possibly stuck) OR ratio > 5x mean
   * - yellow: idle 5-15 min OR ratio > 2x mean
   * - green:  everything else
   */
  scoreHealth(sessionId: string): HealthLevel {
    const session = this.db.getSession(sessionId);
    if (!session) return "green";
    if (!session.last_event_at) return "green";

    const idleMs = Date.now() - new Date(session.last_event_at).getTime();
    const idleMin = idleMs / 60_000;
    if (idleMin > 15) return "red";
    if (idleMin > 5) return "yellow";
    return "green";
  }

  private shouldAlert(sessionId: string, now: number, dedupMs: number): boolean {
    const last = this.lastAlerts.get(sessionId);
    if (last && now - last < dedupMs) return false;
    this.lastAlerts.set(sessionId, now);
    return true;
  }

  private record(anomaly: AnomalyDetected): void {
    this.db.audit({
      event_type:
        anomaly.type === "cost_spike"
          ? "anomaly_cost_spike"
          : "anomaly_token_rate",
      issued_by: "anomaly-detector",
      result: "detected",
      details: `${anomaly.session_id}: ${anomaly.details}`,
    });
    for (const h of this.handlers) {
      try {
        h(anomaly);
      } catch (err) {
        console.error("[anomaly-detector] handler threw:", err);
      }
    }
  }
}
