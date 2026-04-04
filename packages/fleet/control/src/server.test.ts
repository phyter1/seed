import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { ControlDB } from "./db";
import { createApp, createState, stopState, handleWsMessage, handleWsClose } from "./server";
import { hashToken } from "./auth";
import { ACTION_WHITELIST } from "./types";
import type { Hono } from "hono";
import type { ControlPlaneState } from "./server";

const TEST_DB = "/tmp/seed-control-server-test.db";

let db: ControlDB;
let app: Hono;
let state: ControlPlaneState;

function cleanup() {
  for (const ext of ["", "-shm", "-wal"]) {
    const p = TEST_DB + ext;
    if (existsSync(p)) unlinkSync(p);
  }
}

beforeEach(() => {
  cleanup();
  db = new ControlDB(TEST_DB);
  state = createState(db);
  app = createApp(state);
});

afterEach(() => {
  stopState(state);
  db?.close();
  cleanup();
});

async function req(path: string, init?: RequestInit) {
  return app.request(path, init);
}

async function post(path: string, body?: any) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function put(path: string, body: any) {
  return app.request(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// --- REST API Tests ---

describe("health endpoint", () => {
  test("returns ok with uptime and connection count", async () => {
    const res = await req("/health");
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.uptime_ms).toBeGreaterThanOrEqual(0);
    expect(data.connected_machines).toBe(0);
  });
});

describe("fleet endpoints", () => {
  test("list empty fleet", async () => {
    const res = await req("/v1/fleet");
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("get nonexistent machine returns 404", async () => {
    const res = await req("/v1/fleet/nonexistent");
    expect(res.status).toBe(404);
  });

  test("approve a pending machine", async () => {
    db.registerMachine("ren1", "Ren 1");

    const res = await post("/v1/fleet/approve/ren1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("accepted");
    expect(data.token).toBeTruthy();
    expect(data.token.length).toBe(64); // 256-bit hex

    // Machine should be accepted in DB
    const machine = db.getMachine("ren1")!;
    expect(machine.status).toBe("accepted");
    expect(machine.token_hash).toBeTruthy();
  });

  test("approve non-pending machine returns 409", async () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "hash");

    const res = await post("/v1/fleet/approve/ren1");
    expect(res.status).toBe(409);
  });

  test("revoke an accepted machine", async () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "hash");

    const res = await post("/v1/fleet/revoke/ren1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("revoked");
  });

  test("revoke creates audit entry", async () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "hash");
    await post("/v1/fleet/revoke/ren1");

    const audit = db.getAuditLog({ event_type: "machine_revoke" });
    expect(audit.length).toBe(1);
    expect(audit[0].machine_id).toBe("ren1");
  });
});

describe("machine self-registration", () => {
  const validHash = "a".repeat(64);

  test("accepts a new machine and stores it as pending", async () => {
    const res = await post("/v1/fleet/register", {
      machine_id: "ren3",
      display_name: "Ren 3",
      token_hash: validHash,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(body.machine_id).toBe("ren3");

    const machine = db.getMachine("ren3")!;
    expect(machine.status).toBe("pending");
    expect(machine.token_hash).toBe(validHash);
    expect(machine.display_name).toBe("Ren 3");
  });

  test("writes an audit entry on successful registration", async () => {
    await post("/v1/fleet/register", {
      machine_id: "ren3",
      token_hash: validHash,
    });
    const audit = db.getAuditLog({ event_type: "machine_join" });
    expect(audit.length).toBe(1);
    expect(audit[0].machine_id).toBe("ren3");
    expect(audit[0].result).toBe("pending");
  });

  test("rejects duplicate machine_id with 409", async () => {
    db.registerMachineWithToken("ren3", validHash);
    const res = await post("/v1/fleet/register", {
      machine_id: "ren3",
      token_hash: "b".repeat(64),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already registered");
    // Original token_hash is preserved
    expect(db.getMachine("ren3")!.token_hash).toBe(validHash);
  });

  test("409 on duplicate writes a rejected audit entry", async () => {
    db.registerMachineWithToken("ren3", validHash);
    await post("/v1/fleet/register", {
      machine_id: "ren3",
      token_hash: validHash,
    });
    const audit = db.getAuditLog({ event_type: "machine_join" });
    expect(audit.some((e) => e.result === "rejected")).toBe(true);
  });

  test("rejects missing fields with 400", async () => {
    const r1 = await post("/v1/fleet/register", { token_hash: validHash });
    expect(r1.status).toBe(400);
    const r2 = await post("/v1/fleet/register", { machine_id: "ren3" });
    expect(r2.status).toBe(400);
  });

  test("rejects malformed token_hash with 400", async () => {
    const r1 = await post("/v1/fleet/register", {
      machine_id: "ren3",
      token_hash: "nothex",
    });
    expect(r1.status).toBe(400);
    const r2 = await post("/v1/fleet/register", {
      machine_id: "ren3",
      token_hash: "a".repeat(63),
    });
    expect(r2.status).toBe(400);
  });

  test("rejects non-JSON body with 400", async () => {
    const res = await app.request("/v1/fleet/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  test("register endpoint is exempt from operator auth", async () => {
    // Rebuild the app with an operator token
    stopState(state);
    db.close();
    cleanup();
    db = new ControlDB(TEST_DB);
    const opToken = await hashToken("op-secret");
    state = createState(db, opToken);
    app = createApp(state);

    // No Authorization header — register should still work
    const res = await post("/v1/fleet/register", {
      machine_id: "ren3",
      token_hash: validHash,
    });
    expect(res.status).toBe(200);

    // But other /v1/* endpoints should still be gated
    const gated = await req("/v1/fleet");
    expect(gated.status).toBe(401);
  });

  test("approve of a self-registered machine preserves the client token_hash", async () => {
    await post("/v1/fleet/register", {
      machine_id: "ren3",
      token_hash: validHash,
    });
    const res = await post("/v1/fleet/approve/ren3");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("accepted");
    // No server-generated token is returned — the agent already has it
    expect(body.token).toBeUndefined();
    // Hash is the same one the client supplied at registration time
    expect(db.getMachine("ren3")!.token_hash).toBe(validHash);
  });

  test("approve legacy pending machine still generates a token", async () => {
    // Simulates an agent that connected without a token (old flow)
    db.registerMachine("ren3");
    const res = await post("/v1/fleet/approve/ren3");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.token.length).toBe(64);
  });
});

describe("command validation", () => {
  test("rejects unknown action", async () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "hash");

    // Simulate a connected machine
    const fakeWs = {
      send: () => {},
      close: () => {},
    };
    state.connections.set("ren1", {
      machine_id: "ren1",
      ws: fakeWs as any,
      last_pong: Date.now(),
      missed_pongs: 0,
      last_health: null,
    });

    const res = await post("/v1/fleet/ren1/command", {
      action: "run_script",
      params: { script: "rm -rf /" },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("unknown action");
  });

  test("rejects command to disconnected machine", async () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "hash");

    const res = await post("/v1/fleet/ren1/command", {
      action: "service.restart",
      params: { service_id: "ollama" },
    });
    expect(res.status).toBe(503);
  });

  test("dispatches valid command and creates audit entry", async () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "hash");

    const sentMessages: string[] = [];
    const fakeWs = {
      send: (data: string) => sentMessages.push(data),
      close: () => {},
    };
    state.connections.set("ren1", {
      machine_id: "ren1",
      ws: fakeWs as any,
      last_pong: Date.now(),
      missed_pongs: 0,
      last_health: null,
    });

    const res = await post("/v1/fleet/ren1/command", {
      action: "service.restart",
      params: { service_id: "ollama" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.command_id).toBeTruthy();
    expect(data.status).toBe("dispatched");

    // Check that command was sent via WebSocket
    expect(sentMessages.length).toBe(1);
    const sent = JSON.parse(sentMessages[0]);
    expect(sent.type).toBe("command");
    expect(sent.action).toBe("service.restart");
    expect(sent.target).toBe("ren1");

    // Check audit log
    const audit = db.getAuditLog({ event_type: "command" });
    expect(audit.length).toBe(1);
    expect(audit[0].result).toBe("dispatched");
  });

  test("all whitelisted actions are accepted", async () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "hash");

    const fakeWs = { send: () => {}, close: () => {} };
    state.connections.set("ren1", {
      machine_id: "ren1",
      ws: fakeWs as any,
      last_pong: Date.now(),
      missed_pongs: 0,
      last_health: null,
    });

    for (const action of ACTION_WHITELIST) {
      const res = await post("/v1/fleet/ren1/command", {
        action,
        params: {},
      });
      expect(res.status).toBe(200);
    }
  });
});

describe("config endpoints", () => {
  test("get empty config", async () => {
    const res = await req("/v1/config");
    const data = await res.json();
    expect(data.config).toEqual({});
    expect(data.version).toBe(0);
  });

  test("set and get config", async () => {
    await put("/v1/config", { key: "fleet", value: { name: "test" } });

    const res = await req("/v1/config");
    const data = await res.json();
    expect(data.config.fleet).toEqual({ name: "test" });
    expect(data.version).toBe(1);
  });

  test("config export", async () => {
    await put("/v1/config", { key: "fleet", value: { name: "test" } });
    const res = await req("/v1/config/export");
    const data = await res.json();
    expect(data.fleet).toEqual({ name: "test" });
  });
});

describe("audit endpoint", () => {
  test("returns audit entries", async () => {
    db.audit({ event_type: "machine_join", machine_id: "ren1", result: "pending" });
    db.audit({ event_type: "command", machine_id: "ren1", action: "service.restart" });

    const res = await req("/v1/audit");
    const data = await res.json();
    expect(data.length).toBe(2);
  });

  test("filters by machine_id", async () => {
    db.audit({ event_type: "machine_join", machine_id: "ren1" });
    db.audit({ event_type: "machine_join", machine_id: "ren2" });

    const res = await req("/v1/audit?machine_id=ren1");
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].machine_id).toBe("ren1");
  });
});

// --- WebSocket Protocol Tests ---

describe("WebSocket message handling", () => {
  test("announce from unknown machine registers as pending", async () => {
    const sent: string[] = [];
    const fakeWs = {
      send: (data: string) => sent.push(data),
      close: () => {},
    };

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "announce",
        machine_id: "new-machine",
        hostname: "new-machine.local",
        arch: "arm64",
        cpu_cores: 8,
        memory_gb: 16,
        platform: "darwin",
        agent_version: "0.1.0",
        config_version: 0,
        capabilities: ["bun", "git"],
      }),
      state,
      {}
    );

    const machine = db.getMachine("new-machine");
    expect(machine).not.toBeNull();
    expect(machine!.status).toBe("pending");
    expect(machine!.arch).toBe("arm64");
    expect(state.connections.has("new-machine")).toBe(true);
  });

  test("announce with valid token authenticates", async () => {
    const token = "test_token_abc123";
    const hash = await hashToken(token);
    db.registerMachine("ren1");
    db.approveMachine("ren1", hash);

    const fakeWs = { send: () => {}, close: () => {} };

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "announce",
        machine_id: "ren1",
        hostname: "ren1.local",
        arch: "x86_64",
        cpu_cores: 8,
        memory_gb: 32,
        platform: "darwin",
        agent_version: "0.1.0",
        config_version: 0,
        capabilities: [],
      }),
      state,
      { authorization: `Bearer ${token}` }
    );

    expect(state.connections.has("ren1")).toBe(true);
  });

  test("announce with invalid token is rejected", async () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "correct_hash");

    let closed = false;
    const fakeWs = {
      send: () => {},
      close: () => { closed = true; },
    };

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "announce",
        machine_id: "ren1",
        hostname: "ren1.local",
        arch: "x86_64",
        cpu_cores: 8,
        memory_gb: 32,
        platform: "darwin",
        agent_version: "0.1.0",
        config_version: 0,
        capabilities: [],
      }),
      state,
      { authorization: "Bearer wrong_token" }
    );

    expect(closed).toBe(true);
    expect(state.connections.has("ren1")).toBe(false);

    // Should have audit entry for auth failure
    const audit = db.getAuditLog({ event_type: "auth_failure" });
    expect(audit.length).toBe(1);
  });

  test("announce from revoked machine is rejected", async () => {
    db.registerMachine("ren1");
    db.approveMachine("ren1", "hash");
    db.revokeMachine("ren1");

    let closed = false;
    const fakeWs = {
      send: () => {},
      close: () => { closed = true; },
    };

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "announce",
        machine_id: "ren1",
        hostname: "ren1.local",
        arch: "x86_64",
        cpu_cores: 8,
        memory_gb: 32,
        platform: "darwin",
        agent_version: "0.1.0",
        config_version: 0,
        capabilities: [],
      }),
      state,
      {}
    );

    expect(closed).toBe(true);
  });

  test("health message updates in-memory state", async () => {
    // First, register and announce the machine
    const fakeWs = { send: () => {}, close: () => {} };
    db.registerMachine("ren1");

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "announce",
        machine_id: "ren1",
        hostname: "ren1.local",
        arch: "x86_64",
        cpu_cores: 8,
        memory_gb: 32,
        platform: "linux",
        agent_version: "0.1.0",
        config_version: 0,
        capabilities: [],
      }),
      state,
      {}
    );

    // Now send health
    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "health",
        machine_id: "ren1",
        timestamp: new Date().toISOString(),
        system: { cpu_percent: 25, memory_used_gb: 12, memory_total_gb: 32, disk_free_gb: 80 },
        services: [],
        models: [],
      }),
      state,
      {}
    );

    const conn = state.connections.get("ren1");
    expect(conn).not.toBeNull();
    expect(conn!.last_health).not.toBeNull();
    expect(conn!.last_health!.system.cpu_percent).toBe(25);
  });

  test("command_result updates audit log", async () => {
    const fakeWs = { send: () => {}, close: () => {} };
    db.registerMachine("ren1");

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "announce",
        machine_id: "ren1",
        hostname: "ren1.local",
        arch: "x86_64",
        cpu_cores: 8,
        memory_gb: 32,
        platform: "linux",
        agent_version: "0.1.0",
        config_version: 0,
        capabilities: [],
      }),
      state,
      {}
    );

    const commandId = crypto.randomUUID();
    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "command_result",
        command_id: commandId,
        success: true,
        output: "ollama restarted",
        duration_ms: 1200,
      }),
      state,
      {}
    );

    const audit = db.getAuditLog({ event_type: "command" });
    expect(audit.length).toBe(1);
    expect(audit[0].command_id).toBe(commandId);
    expect(audit[0].result).toBe("success");
  });

  test("config_ack updates machine config version", async () => {
    const fakeWs = { send: () => {}, close: () => {} };
    db.registerMachine("ren1");

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "announce",
        machine_id: "ren1",
        hostname: "ren1.local",
        arch: "x86_64",
        cpu_cores: 8,
        memory_gb: 32,
        platform: "linux",
        agent_version: "0.1.0",
        config_version: 0,
        capabilities: [],
      }),
      state,
      {}
    );

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "config_ack",
        version: 5,
        status: "applied",
        machine_id: "ren1",
      }),
      state,
      {}
    );

    const machine = db.getMachine("ren1")!;
    expect(machine.config_version).toBe(5);
  });

  test("pong resets missed pong counter", async () => {
    const fakeWs = { send: () => {}, close: () => {} };
    db.registerMachine("ren1");

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "announce",
        machine_id: "ren1",
        hostname: "ren1.local",
        arch: "x86_64",
        cpu_cores: 8,
        memory_gb: 32,
        platform: "linux",
        agent_version: "0.1.0",
        config_version: 0,
        capabilities: [],
      }),
      state,
      {}
    );

    // Simulate some missed pongs
    const conn = state.connections.get("ren1")!;
    conn.missed_pongs = 2;

    await handleWsMessage(
      fakeWs,
      JSON.stringify({ type: "pong" }),
      state,
      {}
    );

    expect(conn.missed_pongs).toBe(0);
  });

  test("disconnect persists last health and removes connection", async () => {
    const fakeWs = { send: () => {}, close: () => {} };
    db.registerMachine("ren1");

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "announce",
        machine_id: "ren1",
        hostname: "ren1.local",
        arch: "x86_64",
        cpu_cores: 8,
        memory_gb: 32,
        platform: "linux",
        agent_version: "0.1.0",
        config_version: 0,
        capabilities: [],
      }),
      state,
      {}
    );

    // Set some health data
    const conn = state.connections.get("ren1")!;
    conn.last_health = {
      machine_id: "ren1",
      timestamp: new Date().toISOString(),
      system: { cpu_percent: 10, memory_used_gb: 4, memory_total_gb: 32, disk_free_gb: 100 },
      services: [],
      models: [],
    };

    handleWsClose(fakeWs, state);

    expect(state.connections.has("ren1")).toBe(false);
    // Health should be persisted to DB
    const machine = db.getMachine("ren1")!;
    expect(machine.last_health).not.toBeNull();
    expect(machine.last_health!.system.cpu_percent).toBe(10);
  });
});

// --- Forwarded Telemetry Tests ---

describe("forwarded telemetry (hook_event / otlp_event)", () => {
  async function announceRen1(fakeWs: any) {
    db.registerMachine("ren1");
    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "announce",
        machine_id: "ren1",
        hostname: "ren1.local",
        arch: "x86_64",
        cpu_cores: 8,
        memory_gb: 32,
        platform: "linux",
        agent_version: "0.1.0",
        config_version: 0,
        capabilities: [],
      }),
      state,
      {}
    );
  }

  function makeRecordingPipeline() {
    const ingested: any[] = [];
    const pipeline = {
      bus: {} as any,
      sessions: {} as any,
      costs: {} as any,
      anomalies: {} as any,
      ingest: (event: any) => {
        ingested.push(event);
      },
      start: () => {},
      stop: () => {},
      onAgentDetected: () => () => {},
      onAnomaly: () => () => {},
      onEvent: () => () => {},
    };
    return { pipeline, ingested };
  }

  test("hook_event with spoofed machine_id is dropped", async () => {
    stopState(state);
    db.close();
    cleanup();
    db = new ControlDB(TEST_DB);
    const { pipeline, ingested } = makeRecordingPipeline();
    state = createState(db, undefined, pipeline as any);
    app = createApp(state);

    const fakeWs = { send: () => {}, close: () => {} };
    await announceRen1(fakeWs);

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "hook_event",
        machine_id: "ren2", // WS is authenticated as ren1
        received_at: new Date().toISOString(),
        payload: { event: "PreToolUse", session_id: "abc" },
      }),
      state,
      {}
    );

    expect(ingested.length).toBe(0);
  });

  test("hook_event before announce is dropped", async () => {
    let closed = false;
    const fakeWs = {
      send: () => {},
      close: () => {
        closed = true;
      },
    };

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "hook_event",
        machine_id: "ren1",
        received_at: new Date().toISOString(),
        payload: { event: "PreToolUse" },
      }),
      state,
      {}
    );

    expect(closed).toBe(true);
  });

  test("hook_event with valid payload is normalized and ingested", async () => {
    stopState(state);
    db.close();
    cleanup();
    db = new ControlDB(TEST_DB);
    const { pipeline, ingested } = makeRecordingPipeline();
    state = createState(db, undefined, pipeline as any);
    app = createApp(state);

    const fakeWs = { send: () => {}, close: () => {} };
    await announceRen1(fakeWs);

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "hook_event",
        machine_id: "ren1",
        received_at: new Date().toISOString(),
        payload: {
          event: "PostToolUse",
          session_id: "test-session-1",
          tool: "Bash",
        },
      }),
      state,
      {}
    );

    expect(ingested.length).toBe(1);
    expect(ingested[0].session_id).toBe("test-session-1");
  });

  test("otlp_event with empty payload ingests nothing", async () => {
    stopState(state);
    db.close();
    cleanup();
    db = new ControlDB(TEST_DB);
    const { pipeline, ingested } = makeRecordingPipeline();
    state = createState(db, undefined, pipeline as any);
    app = createApp(state);

    const fakeWs = { send: () => {}, close: () => {} };
    await announceRen1(fakeWs);

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "otlp_event",
        machine_id: "ren1",
        received_at: new Date().toISOString(),
        signal: "logs",
        payload: { resourceLogs: [] },
      }),
      state,
      {}
    );

    expect(ingested.length).toBe(0);
  });

  test("otlp_event with spoofed machine_id is dropped", async () => {
    stopState(state);
    db.close();
    cleanup();
    db = new ControlDB(TEST_DB);
    const { pipeline, ingested } = makeRecordingPipeline();
    state = createState(db, undefined, pipeline as any);
    app = createApp(state);

    const fakeWs = { send: () => {}, close: () => {} };
    await announceRen1(fakeWs);

    await handleWsMessage(
      fakeWs,
      JSON.stringify({
        type: "otlp_event",
        machine_id: "ren2",
        received_at: new Date().toISOString(),
        signal: "logs",
        payload: { resourceLogs: [{ scopeLogs: [] }] },
      }),
      state,
      {}
    );

    expect(ingested.length).toBe(0);
  });
});

// --- Auth Middleware Tests ---

describe("operator auth", () => {
  test("unauthenticated requests pass when no token configured", async () => {
    // state has no operator token
    const res = await req("/v1/fleet");
    expect(res.status).toBe(200);
  });

  test("auth required when operator token is configured", async () => {
    stopState(state);
    db.close();
    cleanup();
    db = new ControlDB(TEST_DB);
    const opHash = await hashToken("my-operator-token");
    state = createState(db, opHash);
    app = createApp(state);

    // Without token
    const res1 = await req("/v1/fleet");
    expect(res1.status).toBe(401);

    // With wrong token
    const res2 = await app.request("/v1/fleet", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res2.status).toBe(403);

    // With correct token
    const res3 = await app.request("/v1/fleet", {
      headers: { Authorization: "Bearer my-operator-token" },
    });
    expect(res3.status).toBe(200);
  });
});
