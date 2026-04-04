/**
 * Session Tracker
 *
 * Subscribes to the telemetry event bus and maintains agent_sessions.
 * Two session classifications are supported:
 *
 *   - CLI sessions (session_kind='cli'): one per CLI agent run. The session
 *     ID is the OTEL session ID emitted by Claude/Codex/Gemini. Lifecycle
 *     begins on the first event for that ID.
 *
 *   - Inference sessions (session_kind='inference'): long-lived, one per
 *     (service, machine) pair. Created lazily from router/worker telemetry.
 *     Each inference call is an event within the session.
 *
 * The DB's insertEvent() already upserts the session row, so this tracker
 * is primarily responsible for emitting AgentDetected events to subscribers
 * (e.g. the WebSocket broadcaster) when a brand-new session is observed.
 */

import type { ControlDB } from "./db";
import type { TelemetryEventBus } from "./event-bus";
import type { AgentSession, NormalizedEvent, ServiceType } from "./types";

export interface AgentDetectedEvent {
  type: "agent_detected";
  session_id: string;
  service_type: ServiceType;
  started_at: string;
}

type AgentDetectedHandler = (event: AgentDetectedEvent) => void;

export class SessionTracker {
  /** Sessions already observed this process lifetime. */
  private readonly seen = new Set<string>();
  private readonly detectedHandlers = new Set<AgentDetectedHandler>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly db: ControlDB,
    private readonly bus: TelemetryEventBus
  ) {}

  /** Subscribe to the event bus. No-op if already started. */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.onEvent((event) => this.handle(event));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.seen.clear();
  }

  /** Subscribe to AgentDetected notifications. Returns unsubscribe fn. */
  onAgentDetected(handler: AgentDetectedHandler): () => void {
    this.detectedHandlers.add(handler);
    return () => this.detectedHandlers.delete(handler);
  }

  /** Public so tests can invoke directly. */
  handle(event: NormalizedEvent): void {
    if (!event.session_id) return;

    if (!this.seen.has(event.session_id)) {
      this.seen.add(event.session_id);
      // Verify the session exists (insertEvent should have created it)
      const session = this.db.getSession(event.session_id);
      if (session) {
        this.emitDetected({
          type: "agent_detected",
          session_id: session.id,
          service_type: session.service_type,
          started_at: session.started_at,
        });
      }
    }
  }

  /** Mark session complete (idempotent). */
  endSession(sessionId: string, reason: string): AgentSession | null {
    return this.db.updateSessionStatus(sessionId, "completed", reason);
  }

  private emitDetected(event: AgentDetectedEvent): void {
    for (const handler of this.detectedHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("[session-tracker] detected handler threw:", err);
      }
    }
  }
}
