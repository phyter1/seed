/**
 * Observatory Proxy
 *
 * Runs inside the machine agent. Listens on a local HTTP port for hook
 * payloads and OTLP telemetry from CLI agents / local services, then
 * forwards them to the control plane over the existing agent WebSocket.
 *
 * While the WebSocket is disconnected, events are buffered in memory
 * (bounded — oldest dropped when the buffer is full) and flushed on
 * reconnect.
 *
 * The buffer/forwarder is split from the HTTP server so it can be unit
 * tested without binding a real port.
 */

import { Hono } from "hono";
import type {
  HookEventMessage,
  OtlpEventMessage,
  ProxyConfig,
} from "./types";
import { DEFAULT_PROXY_CONFIG } from "./types";

export type ForwardableMessage = HookEventMessage | OtlpEventMessage;

/**
 * A minimal WebSocket-like sender. We only care about open-ness and
 * a send() method — matches both browser WebSocket and Bun's server
 * WebSocket surface well enough for forwarding JSON text frames.
 */
export interface WsSender {
  readyState: number;
  send: (data: string) => void;
}

export const WS_OPEN = 1;

export interface ProxyForwarderOptions {
  machineId: string;
  bufferMax: number;
  /**
   * Resolver for the current WebSocket. Called on every flush/forward;
   * returns `null` when the agent is disconnected. Using a resolver
   * (not a stored ref) means the forwarder stays correct across
   * reconnects without an explicit setWs() call.
   */
  getWs: () => WsSender | null;
  /** Optional structured logger (defaults to console). */
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string) => void;
  };
}

export interface ProxyStats {
  forwarded: number;
  buffered: number;
  dropped: number;
  buffer_size: number;
}

/**
 * Buffers events while the WS is down and forwards immediately while
 * it is up. Bounded ring-buffer semantics: when full, the oldest event
 * is evicted to make room for the newest.
 */
export class ProxyForwarder {
  private buffer: ForwardableMessage[] = [];
  private stats: ProxyStats = {
    forwarded: 0,
    buffered: 0,
    dropped: 0,
    buffer_size: 0,
  };
  private readonly logger: NonNullable<ProxyForwarderOptions["logger"]>;

  constructor(private readonly opts: ProxyForwarderOptions) {
    this.logger = opts.logger ?? {
      log: (m) => console.log(m),
      warn: (m) => console.warn(m),
    };
  }

  /**
   * Enqueue an event. Forwards immediately if connected, otherwise
   * buffers. When the buffer is at `bufferMax`, the oldest event is
   * dropped so the newest is always retained.
   */
  enqueue(msg: ForwardableMessage): void {
    const ws = this.opts.getWs();
    if (ws && ws.readyState === WS_OPEN) {
      try {
        ws.send(JSON.stringify(msg));
        this.stats.forwarded++;
        return;
      } catch (err: any) {
        // Treat send failure like a disconnect — fall through to buffer.
        this.logger.warn(
          `[proxy] send failed, buffering: ${err?.message ?? err}`
        );
      }
    }

    if (this.buffer.length >= this.opts.bufferMax) {
      this.buffer.shift();
      this.stats.dropped++;
    }
    this.buffer.push(msg);
    this.stats.buffered++;
    this.stats.buffer_size = this.buffer.length;
  }

  /**
   * Flush all buffered events to the current WebSocket. Called on
   * reconnect and periodically by the flush interval. Stops (and puts
   * the event back) on first send failure so nothing is lost.
   */
  flush(): number {
    const ws = this.opts.getWs();
    if (!ws || ws.readyState !== WS_OPEN) return 0;
    if (this.buffer.length === 0) return 0;

    let sent = 0;
    while (this.buffer.length > 0) {
      const next = this.buffer[0];
      try {
        ws.send(JSON.stringify(next));
      } catch (err: any) {
        this.logger.warn(
          `[proxy] flush interrupted: ${err?.message ?? err}`
        );
        break;
      }
      this.buffer.shift();
      sent++;
      this.stats.forwarded++;
    }

    this.stats.buffer_size = this.buffer.length;
    if (sent > 0) {
      this.logger.log(`[proxy] flushed ${sent} buffered events`);
    }
    return sent;
  }

  getStats(): ProxyStats {
    return { ...this.stats, buffer_size: this.buffer.length };
  }

  /** For tests. */
  getBufferLength(): number {
    return this.buffer.length;
  }

  /** For tests. */
  peekBuffer(): ReadonlyArray<ForwardableMessage> {
    return this.buffer;
  }
}

/**
 * Build the Hono app that accepts hook + OTLP payloads and feeds them
 * into the forwarder. Exposed separately so tests can hit it via
 * `app.request()` without a live server.
 */
export function createProxyApp(
  forwarder: ProxyForwarder,
  machineId: string
): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ status: "ok", machine_id: machineId, ...forwarder.getStats() })
  );

  app.post("/hooks", async (c) => {
    let payload: Record<string, unknown>;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return c.json({ error: "payload must be a JSON object" }, 400);
    }

    const msg: HookEventMessage = {
      type: "hook_event",
      machine_id: machineId,
      received_at: new Date().toISOString(),
      payload,
    };
    forwarder.enqueue(msg);
    return c.json({ status: "accepted" }, 202);
  });

  const otlpHandler = (signal: "logs" | "metrics") => async (c: any) => {
    let payload: Record<string, unknown>;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return c.json({ error: "payload must be a JSON object" }, 400);
    }

    const msg: OtlpEventMessage = {
      type: "otlp_event",
      machine_id: machineId,
      received_at: new Date().toISOString(),
      signal,
      payload,
    };
    forwarder.enqueue(msg);
    return c.json({ status: "accepted" }, 202);
  };

  app.post("/otlp/v1/logs", otlpHandler("logs"));
  app.post("/otlp/v1/metrics", otlpHandler("metrics"));

  return app;
}

export interface ProxyHandle {
  app: Hono;
  forwarder: ProxyForwarder;
  config: ProxyConfig;
  flushInterval: ReturnType<typeof setInterval>;
  stop: () => void;
}

/**
 * Wire up a proxy: forwarder + Hono app + periodic flush timer.
 * The caller is responsible for `Bun.serve()`-ing the app on the
 * configured port (so this stays test-friendly and host-agnostic).
 */
export function createProxy(params: {
  machineId: string;
  config: Partial<ProxyConfig> | undefined;
  getWs: () => WsSender | null;
  logger?: ProxyForwarderOptions["logger"];
}): ProxyHandle {
  const config: ProxyConfig = { ...DEFAULT_PROXY_CONFIG, ...(params.config ?? {}) };
  const forwarder = new ProxyForwarder({
    machineId: params.machineId,
    bufferMax: config.buffer_max,
    getWs: params.getWs,
    logger: params.logger,
  });
  const app = createProxyApp(forwarder, params.machineId);

  const flushInterval = setInterval(() => {
    forwarder.flush();
  }, config.flush_interval_ms);

  return {
    app,
    forwarder,
    config,
    flushInterval,
    stop: () => clearInterval(flushInterval),
  };
}
