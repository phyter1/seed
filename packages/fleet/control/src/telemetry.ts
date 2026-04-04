/**
 * Telemetry pipeline wiring.
 *
 * Assembles the normalizer → event bus → (session tracker, cost tracker,
 * anomaly detector, broadcaster) fan-out for the fleet control plane.
 *
 * Intended usage from main.ts:
 *
 *   const telemetry = createTelemetryPipeline(db);
 *   telemetry.start();
 *   ...
 *   telemetry.stop();
 *
 * The pipeline provides an `ingest()` entry point used by OTLP and hook
 * routes to inject a NormalizedEvent into the bus.
 */

import { AnomalyDetector } from "./anomaly-detector";
import type { AnomalyDetectorOptions, AnomalyDetected } from "./anomaly-detector";
import { CostTracker } from "./cost-tracker";
import type { CostTrackerOptions } from "./cost-tracker";
import type { ControlDB } from "./db";
import { TelemetryEventBus } from "./event-bus";
import { SessionTracker } from "./session-tracker";
import type { AgentDetectedEvent } from "./session-tracker";
import type { NormalizedEvent } from "./types";

export interface TelemetryPipelineOptions {
  cost?: CostTrackerOptions;
  anomaly?: AnomalyDetectorOptions;
}

export interface TelemetryPipeline {
  bus: TelemetryEventBus;
  sessions: SessionTracker;
  costs: CostTracker;
  anomalies: AnomalyDetector;
  /** Persist + emit a normalized event. */
  ingest(event: NormalizedEvent): void;
  start(): void;
  stop(): void;
  /** Subscribe to "new session detected" notifications. */
  onAgentDetected(handler: (e: AgentDetectedEvent) => void): () => void;
  /** Subscribe to anomaly detections. */
  onAnomaly(handler: (a: AnomalyDetected) => void): () => void;
  /** Subscribe to every normalized event (for the WS broadcaster). */
  onEvent(handler: (e: NormalizedEvent) => void): () => void;
}

export function createTelemetryPipeline(
  db: ControlDB,
  options?: TelemetryPipelineOptions
): TelemetryPipeline {
  const bus = new TelemetryEventBus();
  const sessions = new SessionTracker(db, bus);
  const costs = new CostTracker(db, bus, options?.cost);
  const anomalies = new AnomalyDetector(db, options?.anomaly);

  return {
    bus,
    sessions,
    costs,
    anomalies,
    ingest(event: NormalizedEvent): void {
      if (!event.session_id) {
        // Events without a session_id are dropped (cannot be associated)
        return;
      }
      db.insertEvent(event);
      bus.emit(event);
    },
    start(): void {
      sessions.start();
      costs.start();
      anomalies.start();
    },
    stop(): void {
      anomalies.stop();
      costs.stop();
      sessions.stop();
      bus.clear();
    },
    onAgentDetected(handler) {
      return sessions.onAgentDetected(handler);
    },
    onAnomaly(handler) {
      return anomalies.onAnomaly(handler);
    },
    onEvent(handler) {
      return bus.onEvent(handler);
    },
  };
}
