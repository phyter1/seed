/**
 * Internal pub/sub event bus for normalized telemetry events.
 *
 * Subscribers include: session tracker, cost aggregator, anomaly detector,
 * and the WebSocket dashboard broadcaster. Events are emitted synchronously
 * after persistence — handler errors are caught so one bad handler cannot
 * block other subscribers.
 */

import type { NormalizedEvent } from "./types";

type EventHandler = (event: NormalizedEvent) => void;

export class TelemetryEventBus {
  private handlers: Set<EventHandler> = new Set();

  /** Subscribe. Returns an unsubscribe function. */
  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Synchronously dispatch to all handlers; swallow per-handler errors. */
  emit(event: NormalizedEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("[telemetry-event-bus] handler threw:", err);
      }
    }
  }

  /** Remove all handlers (test teardown). */
  clear(): void {
    this.handlers.clear();
  }

  size(): number {
    return this.handlers.size;
  }
}
