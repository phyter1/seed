import { Hono } from "hono";
import { ControlDB } from "./db";
import { generateToken, hashToken, extractBearerToken } from "./auth";
import type {
  AgentMessage,
  ConnectedMachine,
  ControlMessage,
  HealthReport,
  AuditEventType,
} from "./types";
import { ACTION_WHITELIST } from "./types";

const PING_INTERVAL_MS = 30_000;
const MAX_MISSED_PONGS = 3;
const HEALTH_PERSIST_INTERVAL_MS = 5 * 60_000;

export interface ControlPlaneState {
  connections: Map<string, ConnectedMachine>;
  /** Reverse lookup: ws object identity → machine_id */
  wsToMachine: Map<object, string>;
  db: ControlDB;
  startedAt: number;
  operatorTokenHash: string | null;
  pingInterval?: ReturnType<typeof setInterval>;
  healthPersistInterval?: ReturnType<typeof setInterval>;
}

export function createState(db: ControlDB, operatorTokenHash?: string): ControlPlaneState {
  const state: ControlPlaneState = {
    connections: new Map(),
    wsToMachine: new Map(),
    db,
    startedAt: Date.now(),
    operatorTokenHash: operatorTokenHash ?? null,
  };

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
  app.use("/v1/*", async (c, next) => {
    if (!state.operatorTokenHash) return next();
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

  app.post("/v1/fleet/approve/:machine_id", async (c) => {
    const machineId = c.req.param("machine_id");
    const machine = db.getMachine(machineId);
    if (!machine) return c.json({ error: "not found" }, 404);
    if (machine.status !== "pending")
      return c.json({ error: `machine is ${machine.status}, not pending` }, 409);

    const token = generateToken();
    const hash = await hashToken(token);
    const approved = db.approveMachine(machineId, hash);
    if (!approved) return c.json({ error: "approval failed" }, 500);

    db.audit({
      event_type: "machine_approve",
      machine_id: machineId,
      issued_by: "operator",
      result: "success",
    });

    // Send token to the connected pending agent
    const conn = state.connections.get(machineId);
    if (conn) {
      conn.ws.send(
        JSON.stringify({ type: "approved", token, machine_id: machineId })
      );
    }

    return c.json({ ...approved, token });
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

    return c.json(entry);
  });

  app.get("/v1/config/export", (c) => {
    const entries = db.getAllConfig();
    const config: Record<string, unknown> = {};
    for (const entry of entries) config[entry.key] = entry.value;
    return c.json(config);
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
      machine_id, arch, memory_gb, platform, agent_version, config_version,
    } = msg;

    // Auth check
    const token = extractBearerToken(upgradeData.authorization ?? null);
    if (token) {
      const tokenHash = await hashToken(token);
      const machine = db.validateToken(machine_id, tokenHash);
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
}
