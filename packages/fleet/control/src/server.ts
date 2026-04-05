import { Hono } from "hono";
import { ControlDB } from "./db";
import { generateToken, hashToken, extractBearerToken } from "./auth";
import type {
  AgentMessage,
  ConnectedMachine,
  ControlMessage,
  HealthReport,
  AuditEventType,
  EventCategory,
  ServiceType,
  SessionStatus,
} from "./types";
import { ACTION_WHITELIST } from "./types";
import type { TelemetryPipeline } from "./telemetry";
import { generateHints } from "./install-hints";
import type {
  InstallStatus,
  InstallEventStatus,
  InstallTarget,
} from "./types";
import {
  detectServiceType,
  normalizeHookPayload,
  normalizeLogRecord,
  normalizeMetricDataPoint,
  type OtlpAttribute,
  type OtlpLogRecord,
  type OtlpLogsPayload,
  type OtlpMetricDataPoint,
  type OtlpMetricsPayload,
} from "./normalizer";

const PING_INTERVAL_MS = 30_000;
const MAX_MISSED_PONGS = 3;
const HEALTH_PERSIST_INTERVAL_MS = 5 * 60_000;

/** Rate limit for the unauthenticated install telemetry endpoint. */
const INSTALL_RATE_LIMIT = 60; // requests
const INSTALL_RATE_WINDOW_MS = 60_000; // per minute

interface InstallRateState {
  /** install_id → array of timestamps (ms) within the rolling window */
  buckets: Map<string, number[]>;
}

function checkInstallRate(
  state: InstallRateState,
  installId: string,
  now: number = Date.now()
): boolean {
  const cutoff = now - INSTALL_RATE_WINDOW_MS;
  const bucket = state.buckets.get(installId) ?? [];
  // Drop expired timestamps
  const fresh = bucket.filter((t) => t > cutoff);
  if (fresh.length >= INSTALL_RATE_LIMIT) {
    state.buckets.set(installId, fresh);
    return false;
  }
  fresh.push(now);
  state.buckets.set(installId, fresh);
  return true;
}

/** WS object used by the dashboard broadcaster. */
export interface DashboardWsLike {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

export interface ControlPlaneState {
  connections: Map<string, ConnectedMachine>;
  /** Reverse lookup: ws object identity → machine_id */
  wsToMachine: Map<object, string>;
  /** Connected dashboard clients (for broadcasting telemetry events). */
  dashboardClients: Set<DashboardWsLike>;
  db: ControlDB;
  telemetry: TelemetryPipeline | null;
  startedAt: number;
  operatorTokenHash: string | null;
  pingInterval?: ReturnType<typeof setInterval>;
  healthPersistInterval?: ReturnType<typeof setInterval>;
  telemetryUnsubscribers: Array<() => void>;
  installRate: InstallRateState;
}

export function createState(
  db: ControlDB,
  operatorTokenHash?: string,
  telemetry?: TelemetryPipeline
): ControlPlaneState {
  const state: ControlPlaneState = {
    connections: new Map(),
    wsToMachine: new Map(),
    dashboardClients: new Set(),
    db,
    telemetry: telemetry ?? null,
    startedAt: Date.now(),
    operatorTokenHash: operatorTokenHash ?? null,
    telemetryUnsubscribers: [],
    installRate: { buckets: new Map() },
  };

  // Wire telemetry pipeline → dashboard broadcaster
  if (telemetry) {
    state.telemetryUnsubscribers.push(
      telemetry.onEvent((event) => {
        broadcastToDashboards(state, {
          type: "agent.event",
          session_id: event.session_id,
          service_type: event.service_type,
          event_type: event.event_type,
          event_name: event.event_name,
          detail: event.detail,
          token_count: event.token_count,
          cost_cents: event.cost_cents,
          source: event.source,
          timestamp: event.timestamp.toISOString(),
        });
      }),
      telemetry.onAgentDetected((e) => {
        const session = db.getSession(e.session_id);
        broadcastToDashboards(state, {
          type: "agent.detected",
          session,
          timestamp: e.started_at,
        });
      }),
      telemetry.onAnomaly((a) => {
        broadcastToDashboards(state, {
          type: "agent.anomaly",
          anomaly: a,
        });
      })
    );
  }

  // Ping all connected agents every 30s
  state.pingInterval = setInterval(() => {
    for (const [machineId, conn] of state.connections) {
      conn.missed_pongs++;
      if (conn.missed_pongs > MAX_MISSED_PONGS) {
        console.log(`[control] ${machineId}: missed ${conn.missed_pongs} pongs, dropping`);
        try { conn.ws.close(1000, "ping timeout"); } catch {}
        state.wsToMachine.delete(conn.ws);
        state.connections.delete(machineId);
        continue;
      }
      try {
        conn.ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        state.wsToMachine.delete(conn.ws);
        state.connections.delete(machineId);
      }
    }
  }, PING_INTERVAL_MS);

  // Persist in-memory health to DB every 5 minutes
  state.healthPersistInterval = setInterval(() => {
    for (const [machineId, conn] of state.connections) {
      if (conn.last_health) {
        db.updateLastHealth(machineId, conn.last_health);
      }
    }
  }, HEALTH_PERSIST_INTERVAL_MS);

  return state;
}

export function stopState(state: ControlPlaneState): void {
  if (state.pingInterval) clearInterval(state.pingInterval);
  if (state.healthPersistInterval) clearInterval(state.healthPersistInterval);
  for (const unsub of state.telemetryUnsubscribers) unsub();
  state.telemetryUnsubscribers = [];
}

/** Broadcast a JSON-serializable message to all connected dashboard clients. */
export function broadcastToDashboards(
  state: ControlPlaneState,
  msg: unknown
): void {
  if (state.dashboardClients.size === 0) return;
  const raw = JSON.stringify(msg);
  for (const ws of state.dashboardClients) {
    try {
      ws.send(raw);
    } catch {
      state.dashboardClients.delete(ws);
    }
  }
}

// --- REST API ---

export function createApp(state: ControlPlaneState): Hono {
  const app = new Hono();
  const { db } = state;

  app.onError((err, c) => {
    console.error("[control] server error:", err);
    return c.json({ error: err.message }, 500);
  });

  // Auth middleware for /v1/*
  // `/v1/fleet/register` is intentionally exempt — machines self-register
  // with a pre-hashed token, then an operator must approve them before
  // they can receive config or commands. Anyone can POST here, but only
  // an approved operator can turn a pending machine into an accepted one.
  app.use("/v1/*", async (c, next) => {
    if (!state.operatorTokenHash) return next();
    const path = new URL(c.req.url).pathname;
    if (path === "/v1/fleet/register") return next();
    // Install telemetry is unauthenticated by design — machines aren't
    // registered yet during install, so we can't gate on a bearer token.
    // Abuse is bounded by a per-install_id rate limiter.
    if (path === "/v1/install/event") return next();
    const token = extractBearerToken(c.req.header("Authorization"));
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const hash = await hashToken(token);
    if (hash !== state.operatorTokenHash) return c.json({ error: "forbidden" }, 403);
    return next();
  });

  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      uptime_ms: Date.now() - state.startedAt,
      connected_machines: state.connections.size,
    });
  });

  // --- Fleet ---

  app.get("/v1/fleet", (c) => {
    const machines = db.listMachines();
    const enriched = machines.map((m) => {
      const conn = state.connections.get(m.id);
      return {
        ...m,
        connected: !!conn,
        last_health: conn?.last_health ?? m.last_health,
      };
    });
    return c.json(enriched);
  });

  app.get("/v1/fleet/:machine_id", (c) => {
    const machine = db.getMachine(c.req.param("machine_id"));
    if (!machine) return c.json({ error: "not found" }, 404);
    const conn = state.connections.get(machine.id);
    return c.json({
      ...machine,
      connected: !!conn,
      last_health: conn?.last_health ?? machine.last_health,
    });
  });

  app.get("/v1/fleet/:machine_id/health", (c) => {
    const machineId = c.req.param("machine_id");
    const conn = state.connections.get(machineId);
    if (conn?.last_health) return c.json(conn.last_health);
    const machine = db.getMachine(machineId);
    if (!machine) return c.json({ error: "not found" }, 404);
    if (!machine.last_health) return c.json({ error: "no health data" }, 404);
    return c.json(machine.last_health);
  });

  // Machine self-registration. Called by `seed fleet join` on the machine
  // being onboarded. The machine generates a token locally, hashes it, and
  // sends only the hash. The machine stays in `pending` state until an
  // operator runs `seed fleet approve <machine_id>`.
  app.post("/v1/fleet/register", async (c) => {
    let body: {
      machine_id?: unknown;
      display_name?: unknown;
      token_hash?: unknown;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const machineId = typeof body.machine_id === "string" ? body.machine_id.trim() : "";
    const tokenHash = typeof body.token_hash === "string" ? body.token_hash.trim() : "";
    const displayName =
      typeof body.display_name === "string" ? body.display_name.trim() : undefined;
    if (!machineId || !tokenHash) {
      return c.json({ error: "machine_id and token_hash required" }, 400);
    }
    // token_hash must look like a SHA-256 hex digest
    if (!/^[0-9a-f]{64}$/i.test(tokenHash)) {
      return c.json({ error: "token_hash must be a 64-char hex SHA-256 digest" }, 400);
    }
    const existing = db.getMachine(machineId);
    if (existing) {
      db.audit({
        event_type: "machine_join",
        machine_id: machineId,
        result: "rejected",
        details: `machine_id already registered (status=${existing.status})`,
      });
      return c.json(
        { error: `machine '${machineId}' already registered (revoke first to re-register)` },
        409
      );
    }
    const machine = db.registerMachineWithToken(machineId, tokenHash, displayName);
    if (!machine) return c.json({ error: "registration failed" }, 500);
    db.audit({
      event_type: "machine_join",
      machine_id: machineId,
      result: "pending",
      details: "self-registered via /v1/fleet/register, awaiting operator approval",
    });
    return c.json({ status: "pending", machine_id: machineId });
  });

  app.post("/v1/fleet/approve/:machine_id", async (c) => {
    const machineId = c.req.param("machine_id");
    const machine = db.getMachine(machineId);
    if (!machine) return c.json({ error: "not found" }, 404);
    if (machine.status !== "pending")
      return c.json({ error: `machine is ${machine.status}, not pending` }, 409);

    // Two paths:
    //  1. Machine pre-registered via `seed fleet join` — token_hash already stored.
    //     We preserve it and just flip status to accepted.
    //  2. Legacy path — agent connected without a token, control plane
    //     registered it as pending. We generate a token and push it over WS.
    let approved: typeof machine | null;
    let tokenForResponse: string | null = null;
    if (machine.token_hash) {
      approved = db.approveMachinePreservingToken(machineId);
    } else {
      const token = generateToken();
      const hash = await hashToken(token);
      approved = db.approveMachine(machineId, hash);
      tokenForResponse = token;
    }
    if (!approved) return c.json({ error: "approval failed" }, 500);

    db.audit({
      event_type: "machine_approve",
      machine_id: machineId,
      issued_by: "operator",
      result: "success",
    });

    // Notify the connected agent. Include the token only on the legacy
    // path; pre-registered agents already have it.
    const conn = state.connections.get(machineId);
    if (conn) {
      const approvedMsg: Record<string, unknown> = {
        type: "approved",
        machine_id: machineId,
      };
      if (tokenForResponse) approvedMsg.token = tokenForResponse;
      conn.ws.send(JSON.stringify(approvedMsg));
    }

    if (tokenForResponse) {
      return c.json({ ...approved, token: tokenForResponse });
    }
    return c.json(approved);
  });

  app.post("/v1/fleet/revoke/:machine_id", (c) => {
    const machineId = c.req.param("machine_id");
    const revoked = db.revokeMachine(machineId);
    if (!revoked) return c.json({ error: "not found or not accepted" }, 404);

    db.audit({
      event_type: "machine_revoke",
      machine_id: machineId,
      issued_by: "operator",
      result: "success",
    });

    const conn = state.connections.get(machineId);
    if (conn) {
      try { conn.ws.close(1000, "revoked"); } catch {}
      state.wsToMachine.delete(conn.ws);
      state.connections.delete(machineId);
    }

    return c.json(revoked);
  });

  // --- Commands ---

  app.post("/v1/fleet/:machine_id/command", async (c) => {
    const machineId = c.req.param("machine_id");
    const body = await c.req.json();
    const { action, params, timeout_ms } = body;

    if (!ACTION_WHITELIST.includes(action as any)) {
      db.audit({
        event_type: "command",
        machine_id: machineId,
        issued_by: "operator",
        action,
        params,
        result: "rejected",
        details: `unknown action: ${action}`,
      });
      return c.json({ error: `unknown action: ${action}` }, 400);
    }

    const conn = state.connections.get(machineId);
    if (!conn) return c.json({ error: "machine not connected" }, 503);

    const commandId = crypto.randomUUID();
    const envelope: ControlMessage = {
      type: "command",
      command_id: commandId,
      timestamp: new Date().toISOString(),
      target: machineId,
      action,
      params: params ?? {},
      timeout_ms: timeout_ms ?? 30_000,
      issued_by: "operator",
    };

    conn.ws.send(JSON.stringify(envelope));

    db.audit({
      event_type: "command",
      machine_id: machineId,
      issued_by: "operator",
      action,
      params,
      result: "dispatched",
      command_id: commandId,
    });

    return c.json({ command_id: commandId, status: "dispatched" });
  });

  // --- Service Discovery ---
  //
  // Looks up a fleet-wide service by id. Services are declared under the
  // config key `services.<service_id>` with shape `{ host, port, probe? }`
  // (host is a machine_id). Returns the URL along with a best-effort
  // `healthy` flag derived from the most recent health report from that
  // machine. The URL is returned even when unhealthy so callers can retry.
  app.get("/v1/services/:service_id", (c) => {
    const serviceId = c.req.param("service_id");
    const entry = db.getConfig(`services.${serviceId}`);
    if (!entry) return c.json({ error: "service not found" }, 404);
    const value = entry.value as {
      host?: string;
      port?: number;
      probe?: { type?: string; path?: string };
    } | null;
    if (!value || typeof value.host !== "string" || typeof value.port !== "number") {
      return c.json({ error: "service config malformed" }, 500);
    }

    const host = value.host;
    const port = value.port;
    const machine = db.getMachine(host);
    // `host` in config is the machine_id. The reachable endpoint is,
    // in priority order:
    //   1. lan_ip the agent reported on announce (IP, never flaky mDNS)
    //   2. machine_id (only resolvable if /etc/hosts or DNS has it)
    // display_name is NEVER used for URL construction — it's a human
    // label that may contain spaces, parens, etc.
    const hostname = machine?.lan_ip ?? host;
    // Services are HTTP today; if that changes, add scheme to config.
    const url = `http://${hostname}:${port}`;

    let healthy = false;
    const conn = state.connections.get(host);
    const lastHealth = conn?.last_health ?? machine?.last_health ?? null;
    if (lastHealth && Array.isArray(lastHealth.services)) {
      const match = lastHealth.services.find(
        (s) => s.id === serviceId || s.port === port
      );
      if (match) {
        healthy =
          match.health_tier === "accepting_connections" ||
          match.health_tier === "serving_requests" ||
          match.health_tier === "within_sla";
      }
    }

    return c.json({
      service_id: serviceId,
      host: hostname,
      machine_id: host,
      port,
      url,
      healthy,
      connected: !!conn,
    });
  });

  // --- Config ---

  app.get("/v1/config", (c) => {
    const entries = db.getAllConfig();
    const config: Record<string, unknown> = {};
    for (const entry of entries) config[entry.key] = entry.value;
    return c.json({ config, version: db.getConfigVersion() });
  });

  app.put("/v1/config", async (c) => {
    const body = await c.req.json();
    const { key, value } = body;
    if (!key || value === undefined) return c.json({ error: "key and value required" }, 400);

    const entry = db.setConfig(key, value, "operator");

    db.audit({
      event_type: "config_change",
      issued_by: "operator",
      action: `config.set.${key}`,
      result: "success",
    });

    // If the key is a per-machine config entry and that machine is
    // currently connected, push the update over the WebSocket so the
    // agent converges immediately. Without this, changes only reach
    // the agent on its next announce, which can leave workloads and
    // services waiting indefinitely for a manual restart.
    const machineMatch = /^machines\.(.+)$/.exec(key);
    let pushed = false;
    if (machineMatch) {
      const machineId = machineMatch[1];
      const conn = state.connections.get(machineId);
      if (conn) {
        conn.ws.send(
          JSON.stringify({
            type: "config_update",
            version: entry.version,
            config: value,
          })
        );
        pushed = true;
      }
    }

    return c.json({ ...entry, pushed });
  });

  // --- Workloads ---
  // Workloads are declared inline on each machine's config under the
  // `workloads` field of the MachineConfig. These endpoints let
  // operators read/write the declarations without hand-crafting the
  // full MachineConfig on every change.

  app.get("/v1/workloads", (c) => {
    const entries = db.getAllConfig();
    const result: Record<string, unknown[]> = {};
    for (const e of entries) {
      const m = /^machines\.(.+)$/.exec(e.key);
      if (!m) continue;
      const value = e.value as { workloads?: unknown[] } | null;
      const workloads = Array.isArray(value?.workloads) ? value!.workloads! : [];
      if (workloads.length > 0) result[m[1]] = workloads;
    }
    return c.json({ workloads: result });
  });

  app.get("/v1/workloads/:machine_id", (c) => {
    const machineId = c.req.param("machine_id");
    const entry = db.getConfig(`machines.${machineId}`);
    const value = entry?.value as { workloads?: unknown[] } | null;
    const workloads = Array.isArray(value?.workloads) ? value!.workloads! : [];
    return c.json({ machine_id: machineId, workloads });
  });

  app.put("/v1/workloads/:machine_id", async (c) => {
    const machineId = c.req.param("machine_id");
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const workloads = body?.workloads;
    if (!Array.isArray(workloads)) {
      return c.json({ error: "workloads[] required" }, 400);
    }
    // Shallow validation — every entry must have id, version, artifact_url.
    for (const w of workloads) {
      if (
        typeof w?.id !== "string" ||
        typeof w?.version !== "string" ||
        typeof w?.artifact_url !== "string"
      ) {
        return c.json(
          { error: "each workload needs id, version, artifact_url" },
          400
        );
      }
    }

    // Merge into existing machines.<id> config (preserve services,
    // models, repos if present).
    const existing = db.getConfig(`machines.${machineId}`);
    const base = (existing?.value as any) ?? {
      services: [],
      models: [],
      repos: [],
    };
    const updated = { ...base, workloads };
    const entry = db.setConfig(`machines.${machineId}`, updated, "operator");

    db.audit({
      event_type: "config_change",
      issued_by: "operator",
      action: `workloads.set.${machineId}`,
      result: "success",
      details: JSON.stringify({
        count: workloads.length,
        ids: workloads.map((w: any) => w.id),
      }),
    });

    // If the machine is connected, push the updated config immediately.
    const conn = state.connections.get(machineId);
    if (conn) {
      conn.ws.send(
        JSON.stringify({
          type: "config_update",
          version: entry.version,
          config: updated,
        })
      );
    }

    return c.json({
      machine_id: machineId,
      workloads,
      config_version: entry.version,
      pushed: !!conn,
    });
  });

  app.post("/v1/workloads/:machine_id/:workload_id/install", async (c) => {
    const machineId = c.req.param("machine_id");
    const workloadId = c.req.param("workload_id");
    const conn = state.connections.get(machineId);
    if (!conn) return c.json({ error: "machine not connected" }, 503);

    const commandId = crypto.randomUUID();
    conn.ws.send(
      JSON.stringify({
        type: "command",
        command_id: commandId,
        timestamp: new Date().toISOString(),
        target: machineId,
        action: "workload.install",
        params: { workload_id: workloadId },
        timeout_ms: 300_000,
        issued_by: "operator",
      })
    );
    db.audit({
      event_type: "command",
      machine_id: machineId,
      issued_by: "operator",
      action: "workload.install",
      params: { workload_id: workloadId } as any,
      result: "dispatched",
      command_id: commandId,
    });
    return c.json({ command_id: commandId, status: "dispatched" });
  });

  app.get("/v1/config/export", (c) => {
    const entries = db.getAllConfig();
    const config: Record<string, unknown> = {};
    for (const entry of entries) config[entry.key] = entry.value;
    return c.json(config);
  });

  // --- Telemetry: OTLP ingestion ---
  // These endpoints are intentionally OUTSIDE the /v1/* auth scope so that
  // OTLP-emitting processes (CLI agents, the fleet router) on the same trust
  // domain can push without shipping operator credentials. Auth can be added
  // later via a bearer token per service if needed.

  app.post("/otlp/v1/logs", async (c) => {
    if (!state.telemetry) return c.json({ error: "telemetry disabled" }, 503);
    const contentType = c.req.header("Content-Type") ?? "";
    if (contentType.includes("application/x-protobuf")) {
      return c.json(
        { error: "only application/json is supported" },
        415
      );
    }

    let body: OtlpLogsPayload;
    try {
      body = (await c.req.json()) as OtlpLogsPayload;
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }

    if (!body || !Array.isArray(body.resourceLogs)) {
      return c.json({ error: "resourceLogs array required" }, 400);
    }

    let accepted = 0;
    let skipped = 0;
    for (const resourceLog of body.resourceLogs) {
      const resourceAttrs = resourceLog.resource?.attributes;
      for (const scopeLog of resourceLog.scopeLogs ?? []) {
        for (const record of scopeLog.logRecords ?? []) {
          const normalized = normalizeLogRecord(record, resourceAttrs);
          if (!normalized.session_id) {
            skipped++;
            continue;
          }
          state.telemetry.ingest(normalized);
          accepted++;
        }
      }
    }

    return c.json({ accepted, skipped }, 200);
  });

  app.post("/otlp/v1/metrics", async (c) => {
    if (!state.telemetry) return c.json({ error: "telemetry disabled" }, 503);
    const contentType = c.req.header("Content-Type") ?? "";
    if (contentType.includes("application/x-protobuf")) {
      return c.json(
        { error: "only application/json is supported" },
        415
      );
    }

    let body: OtlpMetricsPayload;
    try {
      body = (await c.req.json()) as OtlpMetricsPayload;
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }

    if (!body || !Array.isArray(body.resourceMetrics)) {
      return c.json({ error: "resourceMetrics array required" }, 400);
    }

    let accepted = 0;
    let skipped = 0;
    for (const resourceMetric of body.resourceMetrics) {
      const resourceAttrs = resourceMetric.resource?.attributes;
      for (const scopeMetric of resourceMetric.scopeMetrics ?? []) {
        for (const metric of scopeMetric.metrics ?? []) {
          const dataPoints =
            metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];
          for (const dp of dataPoints) {
            const normalized = normalizeMetricDataPoint(
              metric.name,
              dp,
              resourceAttrs
            );
            if (!normalized.session_id) {
              skipped++;
              continue;
            }
            state.telemetry.ingest(normalized);
            accepted++;
          }
        }
      }
    }

    return c.json({ accepted, skipped }, 200);
  });

  // --- Telemetry: Hook receiver ---
  // Accepts hook payloads from CLI agents (Claude Code, Codex, Gemini).
  // Accepts direct hook POSTs; the machine-agent proxy may relay these too.
  app.post("/api/v1/hooks", async (c) => {
    if (!state.telemetry) return c.json({ error: "telemetry disabled" }, 503);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "body must be a JSON object" }, 400);
    }

    const machineId = c.req.header("X-Machine-Id") ?? undefined;
    const normalized = normalizeHookPayload(
      body as Record<string, unknown>,
      machineId
    );
    if (!normalized) {
      return c.json({ error: "unrecognized hook payload" }, 400);
    }
    if (!normalized.session_id) {
      return c.json({ received: true, skipped: "no session id" }, 200);
    }
    state.telemetry.ingest(normalized);
    return c.json({ received: true });
  });

  // --- Telemetry: Dashboard API ---

  app.get("/api/v1/agents", (c) => {
    const serviceType = c.req.query("service_type") as ServiceType | undefined;
    const status = c.req.query("status") as SessionStatus | undefined;
    const sessionKind = c.req.query("session_kind") as
      | "cli"
      | "inference"
      | undefined;
    const limit = Math.max(
      1,
      Math.min(200, Number(c.req.query("limit") ?? 50))
    );
    const offset = Math.max(0, Number(c.req.query("offset") ?? 0));

    const { sessions, total } = db.listSessions({
      service_type: serviceType,
      status,
      session_kind: sessionKind,
      limit,
      offset,
    });

    return c.json({
      data: sessions,
      pagination: { total, limit, offset, has_more: offset + limit < total },
    });
  });

  app.get("/api/v1/agents/:id", (c) => {
    const session = db.getSession(c.req.param("id"));
    if (!session) return c.json({ error: "not found" }, 404);
    return c.json(session);
  });

  app.get("/api/v1/agents/:id/events", (c) => {
    const id = c.req.param("id");
    const cursor = c.req.query("cursor")
      ? Number(c.req.query("cursor"))
      : undefined;
    const eventType = c.req.query("event_type") as EventCategory | undefined;
    const limit = Math.max(
      1,
      Math.min(200, Number(c.req.query("limit") ?? 50))
    );

    const result = db.getSessionEvents(id, {
      cursor,
      event_type: eventType,
      limit,
    });
    if (!result) return c.json({ error: "not found" }, 404);

    return c.json({
      data: result.events,
      pagination: {
        has_more: result.has_more,
        next_cursor: result.next_cursor,
      },
    });
  });

  app.get("/api/v1/costs/summary", (c) => {
    return c.json(db.getCostSummary());
  });

  app.get("/api/v1/costs", (c) => {
    const period =
      (c.req.query("period") as "today" | "week" | "month" | "all") ?? "today";
    const groupBy =
      (c.req.query("group_by") as "session" | "service_type") ?? "service_type";
    if (!["today", "week", "month", "all"].includes(period)) {
      return c.json({ error: "invalid period" }, 400);
    }
    if (!["session", "service_type"].includes(groupBy)) {
      return c.json({ error: "invalid group_by" }, 400);
    }
    return c.json(db.getCostBreakdown(period, groupBy));
  });

  // --- Install Telemetry ---
  //
  // `/v1/install/event` is unauthenticated: during install, the machine
  // hasn't been approved yet, so there's no token to gate on. We rate
  // limit per-install_id to prevent abuse and record everything into
  // `install_sessions` + `install_events` so operators can observe
  // installs in real-time from the CLI.

  app.post("/v1/install/event", async (c) => {
    let body: {
      install_id?: unknown;
      step?: unknown;
      status?: unknown;
      machine_id?: unknown;
      target?: unknown;
      os?: unknown;
      arch?: unknown;
      details?: unknown;
      env?: unknown;
      timestamp?: unknown;
      steps_total?: unknown;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }

    const installId =
      typeof body.install_id === "string" ? body.install_id.trim() : "";
    const step = typeof body.step === "string" ? body.step.trim() : "";
    const status =
      typeof body.status === "string" ? (body.status as InstallEventStatus) : "";
    if (!installId || !step || !status) {
      return c.json(
        { error: "install_id, step, and status required" },
        400
      );
    }
    if (!["started", "ok", "failed", "retrying"].includes(status)) {
      return c.json({ error: `invalid status: ${status}` }, 400);
    }

    // Rate limit check
    if (!checkInstallRate(state.installRate, installId)) {
      return c.json(
        { error: "rate limit exceeded (60/min per install_id)" },
        429
      );
    }

    const details =
      body.details && typeof body.details === "object" && !Array.isArray(body.details)
        ? (body.details as Record<string, unknown>)
        : null;
    const timestamp =
      typeof body.timestamp === "string" ? body.timestamp : new Date().toISOString();

    // Upsert session. Create on first event (or `install.started`).
    let session = db.getInstallSession(installId);
    if (!session) {
      const target: InstallTarget =
        body.target === "control-plane" ? "control-plane" : "agent";
      const env =
        body.env && typeof body.env === "object" && !Array.isArray(body.env)
          ? (body.env as Record<string, unknown>)
          : null;
      session = db.createInstallSession({
        install_id: installId,
        machine_id:
          typeof body.machine_id === "string" ? body.machine_id : null,
        target,
        os: typeof body.os === "string" ? body.os : null,
        arch: typeof body.arch === "string" ? body.arch : null,
        env,
        started_at: timestamp,
      });
    }

    // Fill in machine_id/target/os/arch if newly known.
    const sessionUpdates: Parameters<typeof db.updateInstallSession>[1] = {};
    if (
      typeof body.machine_id === "string" &&
      body.machine_id &&
      !session.machine_id
    ) {
      sessionUpdates.machine_id = body.machine_id;
    }
    if (typeof body.steps_total === "number" && !session.steps_total) {
      sessionUpdates.steps_total = body.steps_total;
    }

    // Record the event
    const recorded = db.recordInstallEvent({
      install_id: installId,
      step,
      status,
      details,
      timestamp,
    });

    // Update session state based on the event
    sessionUpdates.last_step = step;
    if (status === "ok") {
      sessionUpdates.steps_completed = session.steps_completed + 1;
    } else if (status === "failed") {
      const errMsg =
        details && typeof details.error === "string"
          ? details.error
          : typeof details?.error_type === "string"
            ? details.error_type
            : `failed at step ${step}`;
      sessionUpdates.last_error = errMsg;
    }

    // Terminal states
    if (step === "install.complete" && status === "ok") {
      sessionUpdates.status = "success";
      sessionUpdates.completed_at = timestamp;
    } else if (step === "install.complete" && status === "failed") {
      sessionUpdates.status = "failed";
      sessionUpdates.completed_at = timestamp;
    } else if (step === "install.aborted") {
      sessionUpdates.status = "aborted";
      sessionUpdates.completed_at = timestamp;
    }

    db.updateInstallSession(installId, sessionUpdates);
    const updatedSession = db.getInstallSession(installId)!;

    // Generate hints from the event + recent history
    const recentEvents = db.listInstallEvents(installId);
    const hints = generateHints(
      { install_id: installId, step, status, details, timestamp },
      updatedSession,
      // Exclude the event we just inserted so prior-failure counts don't
      // include the one we're responding to.
      recentEvents.filter((e) => e.id !== recorded.id)
    );

    const abort = hints.some((h) => h.action === "abort");
    return c.json({ ack: true, install_id: installId, hints, abort });
  });

  app.get("/v1/installs", (c) => {
    const status = c.req.query("status") as InstallStatus | undefined;
    const machineId = c.req.query("machine_id") ?? undefined;
    const limit = Math.max(
      1,
      Math.min(200, Number(c.req.query("limit") ?? 50))
    );
    const sessions = db.listInstallSessions({
      status,
      machine_id: machineId,
      limit,
    });
    return c.json({ data: sessions, pagination: { limit } });
  });

  app.get("/v1/installs/:install_id", (c) => {
    const id = c.req.param("install_id");
    const session = db.getInstallSession(id);
    if (!session) return c.json({ error: "not found" }, 404);
    const events = db.listInstallEvents(id);
    return c.json({ session, events });
  });

  app.get("/v1/installs/:install_id/events", (c) => {
    const id = c.req.param("install_id");
    const session = db.getInstallSession(id);
    if (!session) return c.json({ error: "not found" }, 404);
    const since = c.req.query("since") ?? undefined;
    const events = db.listInstallEvents(id, { since });
    return c.json({ data: events });
  });

  // --- Audit ---

  app.get("/v1/audit", (c) => {
    const machineId = c.req.query("machine_id") ?? undefined;
    const eventType = c.req.query("event_type") as AuditEventType | undefined;
    const limit = Number(c.req.query("limit") ?? 100);
    return c.json(db.getAuditLog({ machine_id: machineId, event_type: eventType, limit }));
  });

  return app;
}

// --- WebSocket Message Handler ---
// Called by Bun's ServerWebSocket.message callback

export async function handleWsMessage(
  ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void },
  raw: string,
  state: ControlPlaneState,
  upgradeData: { authorization?: string; machine_id?: string }
): Promise<void> {
  const { db } = state;

  let msg: AgentMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    console.error("[control] invalid JSON from agent");
    return;
  }

  const existingMachineId = state.wsToMachine.get(ws);

  if (msg.type === "pong") {
    if (existingMachineId) {
      const conn = state.connections.get(existingMachineId);
      if (conn) {
        conn.missed_pongs = 0;
        conn.last_pong = Date.now();
      }
    }
    return;
  }

  if (msg.type === "announce") {
    const {
      machine_id, arch, memory_gb, platform, agent_version, config_version, lan_ip,
    } = msg;

    // Auth check
    const token = extractBearerToken(upgradeData.authorization ?? null);
    if (token) {
      const tokenHash = await hashToken(token);
      // Accept either an approved machine or a pending machine that
      // pre-registered via `seed fleet join`. Pending machines get a
      // connection so they appear in `seed fleet status`, but config
      // push and command dispatch stay gated on `status === 'accepted'`.
      const machine =
        db.validateToken(machine_id, tokenHash) ??
        db.validatePendingToken(machine_id, tokenHash);
      if (!machine) {
        db.audit({
          event_type: "auth_failure",
          machine_id,
          result: "failure",
          details: "invalid token",
        });
        ws.close(1008, "invalid token");
        return;
      }
    } else {
      const existing = db.getMachine(machine_id);
      if (!existing) {
        db.registerMachine(machine_id);
        db.audit({
          event_type: "machine_join",
          machine_id,
          result: "pending",
          details: "new machine registered as pending",
        });
      } else if (existing.status === "revoked") {
        db.audit({
          event_type: "auth_failure",
          machine_id,
          result: "failure",
          details: "machine is revoked",
        });
        ws.close(1008, "revoked");
        return;
      } else if (existing.status === "accepted") {
        db.audit({
          event_type: "auth_failure",
          machine_id,
          result: "failure",
          details: "accepted machine connected without token",
        });
        ws.close(1008, "token required");
        return;
      }
    }

    // Prevent duplicate connections
    const existingConn = state.connections.get(machine_id);
    if (existingConn && existingConn.ws !== ws) {
      ws.close(1008, "duplicate machine_id");
      return;
    }

    state.wsToMachine.set(ws, machine_id);
    state.connections.set(machine_id, {
      machine_id,
      ws: ws as any,
      last_pong: Date.now(),
      missed_pongs: 0,
      last_health: null,
    });

    db.updateMachineInfo(machine_id, {
      arch,
      platform,
      memory_gb,
      agent_version,
      config_version,
      ...(lan_ip ? { lan_ip } : {}),
    });

    console.log(`[control] ${machine_id} connected (${platform}/${arch}, ${memory_gb}GB)`);

    // Push config if version mismatch
    const machine = db.getMachine(machine_id);
    if (machine && machine.status === "accepted") {
      const currentVersion = db.getConfigVersion();
      if (config_version < currentVersion) {
        const configEntries = db.getAllConfig();
        const machineConfig = configEntries.find((e) => e.key === `machines.${machine_id}`);
        if (machineConfig) {
          ws.send(JSON.stringify({
            type: "config_update",
            version: currentVersion,
            config: machineConfig.value,
          }));
        }
      }
    }
    return;
  }

  // All subsequent messages require prior announce
  if (!existingMachineId) {
    ws.close(1008, "not announced");
    return;
  }

  if (msg.type === "health") {
    const healthReport: HealthReport = {
      machine_id: msg.machine_id,
      timestamp: msg.timestamp,
      system: msg.system,
      services: msg.services,
      models: msg.models,
      ...(msg.gpu !== undefined ? { gpu: msg.gpu } : {}),
    };
    const conn = state.connections.get(existingMachineId);
    if (conn) conn.last_health = healthReport;
    db.updateLastSeen(existingMachineId);
    return;
  }

  if (msg.type === "command_result") {
    db.audit({
      event_type: "command",
      machine_id: existingMachineId,
      action: "command_result",
      result: msg.success ? "success" : "failure",
      details: msg.output,
      command_id: msg.command_id,
    });
    return;
  }

  if (msg.type === "config_ack") {
    if (msg.status === "applied") {
      db.updateConfigVersion(existingMachineId, msg.version);
    }
    return;
  }

  if (msg.type === "hook_event") {
    // Forwarded from a CLI agent via the machine agent's proxy.
    // Validate the machine_id matches the authenticated WS so a
    // compromised agent can't impersonate another machine.
    if (msg.machine_id !== existingMachineId) {
      console.warn(
        `[control] hook_event machine_id mismatch: ${msg.machine_id} via ${existingMachineId}`
      );
      return;
    }
    if (!state.telemetry) return;
    const normalized = normalizeHookPayload(
      msg.payload as Record<string, unknown>,
      existingMachineId
    );
    if (normalized && normalized.session_id) {
      state.telemetry.ingest(normalized);
    }
    return;
  }

  if (msg.type === "otlp_event") {
    if (msg.machine_id !== existingMachineId) {
      console.warn(
        `[control] otlp_event machine_id mismatch: ${msg.machine_id} via ${existingMachineId}`
      );
      return;
    }
    if (!state.telemetry) return;
    const payload = msg.payload as
      | { resourceLogs?: unknown[]; resourceMetrics?: unknown[] }
      | undefined;
    if (!payload || typeof payload !== "object") return;

    if (msg.signal === "logs" && Array.isArray(payload.resourceLogs)) {
      for (const resourceLog of payload.resourceLogs as Array<{
        resource?: { attributes?: unknown };
        scopeLogs?: Array<{ logRecords?: unknown[] }>;
      }>) {
        const resourceAttrs = resourceLog.resource?.attributes as
          | OtlpAttribute[]
          | undefined;
        for (const scopeLog of resourceLog.scopeLogs ?? []) {
          for (const record of (scopeLog.logRecords ?? []) as OtlpLogRecord[]) {
            const normalized = normalizeLogRecord(record, resourceAttrs);
            if (normalized.session_id) {
              state.telemetry.ingest(normalized);
            }
          }
        }
      }
    } else if (
      msg.signal === "metrics" &&
      Array.isArray(payload.resourceMetrics)
    ) {
      for (const resourceMetric of payload.resourceMetrics as Array<{
        resource?: { attributes?: unknown };
        scopeMetrics?: Array<{ metrics?: unknown[] }>;
      }>) {
        const resourceAttrs = resourceMetric.resource?.attributes as
          | OtlpAttribute[]
          | undefined;
        for (const scopeMetric of resourceMetric.scopeMetrics ?? []) {
          for (const metric of (scopeMetric.metrics ?? []) as Array<{
            name: string;
            sum?: { dataPoints?: unknown[] };
            gauge?: { dataPoints?: unknown[] };
          }>) {
            const dataPoints =
              metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];
            for (const dp of dataPoints as OtlpMetricDataPoint[]) {
              const normalized = normalizeMetricDataPoint(
                metric.name,
                dp,
                resourceAttrs
              );
              if (normalized && normalized.session_id) {
                state.telemetry.ingest(normalized);
              }
            }
          }
        }
      }
    }
    return;
  }
}

export function handleWsClose(
  ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void },
  state: ControlPlaneState
): void {
  const machineId = state.wsToMachine.get(ws);
  if (machineId) {
    console.log(`[control] ${machineId} disconnected`);
    const conn = state.connections.get(machineId);
    if (conn?.last_health) {
      state.db.updateLastHealth(machineId, conn.last_health);
    }
    state.connections.delete(machineId);
    state.wsToMachine.delete(ws);
  }
  state.dashboardClients.delete(ws as DashboardWsLike);
}

// --- Dashboard WebSocket ---

/** Register a dashboard client (called on /ws/dashboard upgrade). */
export function registerDashboardClient(
  ws: DashboardWsLike,
  state: ControlPlaneState
): void {
  state.dashboardClients.add(ws);
}

export function unregisterDashboardClient(
  ws: DashboardWsLike,
  state: ControlPlaneState
): void {
  state.dashboardClients.delete(ws);
}
