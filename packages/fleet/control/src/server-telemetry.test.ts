import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { ControlDB } from "./db";
import {
  createApp,
  createState,
  stopState,
  registerDashboardClient,
  type ControlPlaneState,
  type DashboardWsLike,
} from "./server";
import { createTelemetryPipeline } from "./telemetry";
import type { Hono } from "hono";

const TEST_DB = "/tmp/seed-control-server-telemetry-test.db";

let db: ControlDB;
let app: Hono;
let state: ControlPlaneState;
let telemetry: ReturnType<typeof createTelemetryPipeline>;

function cleanup() {
  for (const ext of ["", "-shm", "-wal"]) {
    const p = TEST_DB + ext;
    if (existsSync(p)) unlinkSync(p);
  }
}

beforeEach(() => {
  cleanup();
  db = new ControlDB(TEST_DB);
  telemetry = createTelemetryPipeline(db);
  telemetry.start();
  state = createState(db, undefined, telemetry);
  app = createApp(state);
});

afterEach(() => {
  stopState(state);
  telemetry.stop();
  db?.close();
  cleanup();
});

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function get(path: string) {
  return app.request(path);
}

// ─── OTLP Logs ────────────────────────────────────────────────────────────────

describe("POST /otlp/v1/logs", () => {
  test("accepts a valid claude tool_result log", async () => {
    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "claude" } },
            ],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  body: { stringValue: "claude_code.tool_result" },
                  attributes: [
                    {
                      key: "claude_code.session.id",
                      value: { stringValue: "sess-otlp-1" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const res = await post("/otlp/v1/logs", payload);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accepted).toBe(1);
    expect(data.skipped).toBe(0);

    const session = db.getSession("sess-otlp-1")!;
    expect(session).toBeTruthy();
    expect(session.service_type).toBe("claude");
  });

  test("skips records without a session id", async () => {
    const payload = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  body: { stringValue: "claude_code.tool_result" },
                  attributes: [],
                },
              ],
            },
          ],
        },
      ],
    };
    const res = await post("/otlp/v1/logs", payload);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.accepted).toBe(0);
    expect(data.skipped).toBe(1);
  });

  test("rejects protobuf content-type", async () => {
    const res = await app.request("/otlp/v1/logs", {
      method: "POST",
      headers: { "Content-Type": "application/x-protobuf" },
      body: "raw-bytes",
    });
    expect(res.status).toBe(415);
  });

  test("rejects invalid JSON", async () => {
    const res = await app.request("/otlp/v1/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("rejects missing resourceLogs array", async () => {
    const res = await post("/otlp/v1/logs", { foo: "bar" });
    expect(res.status).toBe(400);
  });

  test("fleet-router inference_request creates inference session", async () => {
    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "fleet-router" } },
              { key: "machine.id", value: { stringValue: "ren3" } },
            ],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  body: { stringValue: "inference_request" },
                  attributes: [
                    { key: "tokens_input", value: { intValue: "100" } },
                    { key: "tokens_output", value: { intValue: "50" } },
                    { key: "model", value: { stringValue: "qwen3-coder" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const res = await post("/otlp/v1/logs", payload);
    expect(res.status).toBe(200);
    const session = db.getSession("fleet-router:ren3")!;
    expect(session).toBeTruthy();
    expect(session.session_kind).toBe("inference");
    expect(session.total_tokens).toBe(150);
    expect(session.total_cost_cents).toBe(0);
  });
});

// ─── OTLP Metrics ─────────────────────────────────────────────────────────────

describe("POST /otlp/v1/metrics", () => {
  test("token usage metric accumulates on session", async () => {
    const payload = {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "claude" } },
            ],
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "claude_code.token.usage",
                  sum: {
                    dataPoints: [
                      {
                        asInt: "250",
                        attributes: [
                          {
                            key: "claude_code.session.id",
                            value: { stringValue: "sess-m1" },
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const res = await post("/otlp/v1/metrics", payload);
    expect(res.status).toBe(200);
    const session = db.getSession("sess-m1")!;
    expect(session.total_tokens).toBe(250);
  });
});

// ─── Hooks ────────────────────────────────────────────────────────────────────

describe("POST /api/v1/hooks", () => {
  test("accepts a claude hook payload", async () => {
    const res = await post("/api/v1/hooks", {
      event: "PreToolUse",
      session_id: "sess-hook-1",
      tool_name: "Bash",
    });
    expect(res.status).toBe(200);
    const session = db.getSession("sess-hook-1")!;
    expect(session).toBeTruthy();
    expect(session.service_type).toBe("claude");
  });

  test("accepts a codex hook payload", async () => {
    const res = await post("/api/v1/hooks", {
      hookEventName: "PostToolUse",
      session_id: "sess-hook-codex",
      tool_name: "shell",
    });
    expect(res.status).toBe(200);
    const session = db.getSession("sess-hook-codex")!;
    expect(session.service_type).toBe("codex");
  });

  test("rejects unrecognized payload", async () => {
    const res = await post("/api/v1/hooks", { foo: "bar" });
    expect(res.status).toBe(400);
  });

  test("rejects invalid JSON", async () => {
    const res = await app.request("/api/v1/hooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad",
    });
    expect(res.status).toBe(400);
  });

  test("carries X-Machine-Id header into event", async () => {
    const res = await post(
      "/api/v1/hooks",
      {
        event: "PreToolUse",
        session_id: "sess-m",
        tool_name: "X",
      },
      { "X-Machine-Id": "ren2" }
    );
    expect(res.status).toBe(200);
    const events = db.getSessionEvents("sess-m", {})!;
    expect(events.events[0].machine_id).toBe("ren2");
  });

  test("skips hook without session_id with 200 (still valid payload)", async () => {
    const res = await post("/api/v1/hooks", {
      event: "SessionStart",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.skipped).toBeTruthy();
  });
});

// ─── Dashboard API ────────────────────────────────────────────────────────────

describe("dashboard API", () => {
  function seed() {
    telemetry.ingest({
      session_id: "sess-a",
      service_type: "claude",
      event_type: "tool_call",
      event_name: "claude_code.tool_result",
      detail: {},
      token_count: 100,
      cost_cents: 10,
      source: "otel",
      timestamp: new Date(),
    });
    telemetry.ingest({
      session_id: "sess-b",
      service_type: "codex",
      event_type: "user_prompt",
      event_name: "codex.user_prompt_submit",
      detail: {},
      token_count: 50,
      cost_cents: 5,
      source: "otel",
      timestamp: new Date(),
    });
    telemetry.costs.flushAll();
  }

  test("GET /api/v1/agents lists sessions", async () => {
    seed();
    const res = await get("/api/v1/agents");
    const data = await res.json();
    expect(data.pagination.total).toBe(2);
    expect(data.data.length).toBe(2);
  });

  test("GET /api/v1/agents?service_type=claude filters", async () => {
    seed();
    const res = await get("/api/v1/agents?service_type=claude");
    const data = await res.json();
    expect(data.pagination.total).toBe(1);
    expect(data.data[0].service_type).toBe("claude");
  });

  test("GET /api/v1/agents/:id returns session detail or 404", async () => {
    seed();
    const ok = await get("/api/v1/agents/sess-a");
    expect(ok.status).toBe(200);
    const data = await ok.json();
    expect(data.id).toBe("sess-a");
    expect(data.total_tokens).toBe(100);

    const miss = await get("/api/v1/agents/nope");
    expect(miss.status).toBe(404);
  });

  test("GET /api/v1/agents/:id/events returns paginated events", async () => {
    seed();
    const res = await get("/api/v1/agents/sess-a/events");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.length).toBe(1);
    expect(data.data[0].event_name).toBe("claude_code.tool_result");
  });

  test("GET /api/v1/costs/summary returns totals", async () => {
    seed();
    const res = await get("/api/v1/costs/summary");
    const data = await res.json();
    expect(data.today.tokens).toBe(150);
    expect(data.today.cost_cents).toBe(15);
  });

  test("GET /api/v1/costs groups by service_type", async () => {
    seed();
    const res = await get("/api/v1/costs?period=all&group_by=service_type");
    const data = await res.json();
    expect(data.total_tokens).toBe(150);
    expect(data.breakdown.length).toBe(2);
  });

  test("GET /api/v1/costs rejects invalid period", async () => {
    const res = await get("/api/v1/costs?period=yesterday&group_by=service_type");
    expect(res.status).toBe(400);
  });
});

// ─── Dashboard WebSocket Broadcast ────────────────────────────────────────────

describe("dashboard WebSocket broadcasting", () => {
  test("telemetry events are broadcast to dashboard clients", () => {
    const messages: string[] = [];
    const ws: DashboardWsLike = {
      send: (data: string) => messages.push(data),
      close: () => {},
    };
    registerDashboardClient(ws, state);

    telemetry.ingest({
      session_id: "sess-ws",
      service_type: "claude",
      event_type: "tool_call",
      event_name: "claude_code.tool_result",
      detail: { tool: "Read" },
      token_count: 0,
      cost_cents: 0,
      source: "otel",
      timestamp: new Date(),
    });

    const types = messages.map((m) => JSON.parse(m).type);
    expect(types).toContain("agent.event");
    expect(types).toContain("agent.detected");
  });

  test("dead client is pruned after send failure", () => {
    const ws: DashboardWsLike = {
      send: () => {
        throw new Error("closed");
      },
      close: () => {},
    };
    registerDashboardClient(ws, state);
    expect(state.dashboardClients.size).toBe(1);
    telemetry.ingest({
      session_id: "sess-dead",
      service_type: "claude",
      event_type: "tool_call",
      event_name: "claude_code.tool_result",
      detail: {},
      token_count: 0,
      cost_cents: 0,
      source: "otel",
      timestamp: new Date(),
    });
    expect(state.dashboardClients.size).toBe(0);
  });
});
