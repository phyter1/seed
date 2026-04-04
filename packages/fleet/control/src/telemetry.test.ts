import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { ControlDB } from "./db";
import { TelemetryEventBus } from "./event-bus";
import { SessionTracker } from "./session-tracker";
import { CostTracker } from "./cost-tracker";
import { AnomalyDetector } from "./anomaly-detector";
import { createTelemetryPipeline } from "./telemetry";
import {
  detectServiceType,
  normalizeHookPayload,
  normalizeLogRecord,
  normalizeMetricDataPoint,
} from "./normalizer";
import type { NormalizedEvent, ServiceType } from "./types";

const TEST_DB = "/tmp/seed-control-telemetry-test.db";

let db: ControlDB;

function cleanup() {
  for (const ext of ["", "-shm", "-wal"]) {
    const p = TEST_DB + ext;
    if (existsSync(p)) unlinkSync(p);
  }
}

beforeEach(() => {
  cleanup();
  db = new ControlDB(TEST_DB);
});

afterEach(() => {
  db.close();
  cleanup();
});

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    session_id: "session-1",
    service_type: "claude" as ServiceType,
    event_type: "tool_call",
    event_name: "claude_code.tool_result",
    detail: {},
    token_count: 0,
    cost_cents: 0,
    source: "otel",
    timestamp: new Date(),
    ...overrides,
  };
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

describe("normalizer: detectServiceType", () => {
  test("claude by default", () => {
    expect(detectServiceType(undefined)).toBe("claude");
    expect(detectServiceType([])).toBe("claude");
  });

  test("codex from service.name", () => {
    expect(
      detectServiceType([{ key: "service.name", value: { stringValue: "codex" } }])
    ).toBe("codex");
  });

  test("fleet-router recognized", () => {
    expect(
      detectServiceType([
        { key: "service.name", value: { stringValue: "fleet-router" } },
      ])
    ).toBe("fleet-router");
  });

  test("inference-worker recognized", () => {
    expect(
      detectServiceType([
        { key: "service.name", value: { stringValue: "inference-worker" } },
      ])
    ).toBe("inference-worker");
  });
});

describe("normalizer: log records", () => {
  test("claude tool_result populates session_id", () => {
    const ev = normalizeLogRecord(
      {
        body: { stringValue: "claude_code.tool_result" },
        attributes: [
          { key: "claude_code.session.id", value: { stringValue: "sess-42" } },
          { key: "tool_name", value: { stringValue: "Read" } },
        ],
      },
      [{ key: "service.name", value: { stringValue: "claude" } }]
    );
    expect(ev.session_id).toBe("sess-42");
    expect(ev.service_type).toBe("claude");
    expect(ev.event_type).toBe("tool_call");
    expect(ev.detail.tool_name).toBe("Read");
  });

  test("fleet-router inference_request extracts token counts", () => {
    const ev = normalizeLogRecord(
      {
        body: { stringValue: "inference_request" },
        attributes: [
          { key: "tokens_prompt", value: { intValue: "120" } },
          { key: "tokens_completion", value: { intValue: "80" } },
          { key: "cost_cents", value: { intValue: "0" } },
          { key: "model", value: { stringValue: "qwen3-coder" } },
        ],
      },
      [
        { key: "service.name", value: { stringValue: "fleet-router" } },
        { key: "machine.id", value: { stringValue: "ren3" } },
      ]
    );
    expect(ev.service_type).toBe("fleet-router");
    expect(ev.event_type).toBe("inference_request");
    expect(ev.token_count).toBe(200);
    expect(ev.cost_cents).toBe(0);
    expect(ev.machine_id).toBe("ren3");
    expect(ev.session_id).toBe("fleet-router:ren3");
  });

  test("unknown events fall through to category=unknown", () => {
    const ev = normalizeLogRecord(
      {
        body: { stringValue: "my.custom.event" },
        attributes: [{ key: "session.id", value: { stringValue: "x" } }],
      },
      undefined
    );
    expect(ev.event_type).toBe("unknown");
    expect(ev.event_name).toBe("my.custom.event");
  });
});

describe("normalizer: metrics", () => {
  test("claude token.usage → token_count", () => {
    const ev = normalizeMetricDataPoint(
      "claude_code.token.usage",
      {
        asInt: "500",
        attributes: [
          { key: "claude_code.session.id", value: { stringValue: "sess-1" } },
        ],
      },
      undefined
    );
    expect(ev.token_count).toBe(500);
    expect(ev.cost_cents).toBe(0);
  });

  test("claude cost.usage → cost_cents (USD→cents)", () => {
    const ev = normalizeMetricDataPoint(
      "claude_code.cost.usage",
      {
        asDouble: 0.0325,
        attributes: [
          { key: "claude_code.session.id", value: { stringValue: "sess-1" } },
        ],
      },
      undefined
    );
    expect(ev.cost_cents).toBe(3);
  });

  test("context.usage → percentage", () => {
    const ev = normalizeMetricDataPoint(
      "claude_code.context.usage",
      {
        asDouble: 0.72,
        attributes: [
          { key: "claude_code.session.id", value: { stringValue: "sess-1" } },
        ],
      },
      undefined
    );
    expect(ev.context_usage_percent).toBe(72);
  });
});

describe("normalizer: hook payloads", () => {
  test("claude hook recognized via event field", () => {
    const ev = normalizeHookPayload({
      event: "PreToolUse",
      session_id: "sess-1",
      tool_name: "Bash",
    });
    expect(ev).not.toBeNull();
    expect(ev!.service_type).toBe("claude");
    expect(ev!.event_type).toBe("tool_decision");
    expect(ev!.session_id).toBe("sess-1");
  });

  test("codex hook recognized via hookEventName", () => {
    const ev = normalizeHookPayload({
      hookEventName: "PostToolUse",
      session_id: "sess-c",
    });
    expect(ev!.service_type).toBe("codex");
    expect(ev!.event_type).toBe("tool_call");
  });

  test("gemini hook recognized via event_type", () => {
    const ev = normalizeHookPayload({
      event_type: "BeforeTool",
      session_id: "sess-g",
    });
    expect(ev!.service_type).toBe("gemini");
  });

  test("unrecognized payload returns null", () => {
    expect(normalizeHookPayload({ foo: "bar" })).toBeNull();
  });
});

// ─── Event Bus ────────────────────────────────────────────────────────────────

describe("event bus", () => {
  test("emits to all handlers", () => {
    const bus = new TelemetryEventBus();
    const received: string[] = [];
    bus.onEvent((e) => received.push(`a:${e.session_id}`));
    bus.onEvent((e) => received.push(`b:${e.session_id}`));
    bus.emit(makeEvent({ session_id: "x" }));
    expect(received).toEqual(["a:x", "b:x"]);
  });

  test("bad handler doesn't block others", () => {
    const bus = new TelemetryEventBus();
    const received: string[] = [];
    bus.onEvent(() => {
      throw new Error("boom");
    });
    bus.onEvent((e) => received.push(e.session_id));
    bus.emit(makeEvent({ session_id: "ok" }));
    expect(received).toEqual(["ok"]);
  });

  test("unsubscribe removes handler", () => {
    const bus = new TelemetryEventBus();
    const received: string[] = [];
    const unsub = bus.onEvent((e) => received.push(e.session_id));
    bus.emit(makeEvent({ session_id: "1" }));
    unsub();
    bus.emit(makeEvent({ session_id: "2" }));
    expect(received).toEqual(["1"]);
  });
});

// ─── DB: sessions + events ────────────────────────────────────────────────────

describe("db telemetry: sessions", () => {
  test("upsertSession creates and returns session", () => {
    const s = db.upsertSession({
      id: "s1",
      service_type: "claude",
      session_kind: "cli",
    });
    expect(s.id).toBe("s1");
    expect(s.status).toBe("active");
    expect(s.health_level).toBe("green");
  });

  test("insertEvent accumulates tokens/cost on session", () => {
    db.insertEvent(
      makeEvent({
        session_id: "s1",
        token_count: 100,
        cost_cents: 50,
      })
    );
    db.insertEvent(
      makeEvent({
        session_id: "s1",
        token_count: 200,
        cost_cents: 75,
      })
    );
    const session = db.getSession("s1")!;
    expect(session.total_tokens).toBe(300);
    expect(session.total_cost_cents).toBe(125);
  });

  test("insertEvent for inference source creates inference session", () => {
    db.insertEvent(
      makeEvent({
        session_id: "fleet-router:ren3",
        service_type: "fleet-router",
        event_type: "inference_request",
        token_count: 500,
        cost_cents: 0,
      })
    );
    const session = db.getSession("fleet-router:ren3")!;
    expect(session.session_kind).toBe("inference");
    expect(session.total_tokens).toBe(500);
    expect(session.total_cost_cents).toBe(0);
  });

  test("context_usage_percent is replaced, not accumulated", () => {
    db.insertEvent(
      makeEvent({ session_id: "s1", context_usage_percent: 30 })
    );
    db.insertEvent(
      makeEvent({ session_id: "s1", context_usage_percent: 60 })
    );
    expect(db.getSession("s1")!.context_usage_percent).toBe(60);
  });

  test("getSessionEvents cursor pagination", () => {
    for (let i = 0; i < 5; i++) {
      db.insertEvent(
        makeEvent({
          session_id: "s1",
          event_name: `evt-${i}`,
          timestamp: new Date(Date.now() + i * 1000),
        })
      );
    }
    const page1 = db.getSessionEvents("s1", { limit: 2 })!;
    expect(page1.events.length).toBe(2);
    expect(page1.has_more).toBe(true);
    const page2 = db.getSessionEvents("s1", {
      cursor: page1.next_cursor!,
      limit: 2,
    })!;
    expect(page2.events.length).toBe(2);
    expect(page2.has_more).toBe(true);
  });

  test("listSessions filters by service_type and session_kind", () => {
    db.insertEvent(makeEvent({ session_id: "a", service_type: "claude" }));
    db.insertEvent(
      makeEvent({
        session_id: "fleet-router:ren1",
        service_type: "fleet-router",
        event_type: "inference_request",
      })
    );
    const cli = db.listSessions({ session_kind: "cli" });
    expect(cli.total).toBe(1);
    expect(cli.sessions[0].id).toBe("a");
    const inf = db.listSessions({ session_kind: "inference" });
    expect(inf.total).toBe(1);
    expect(inf.sessions[0].service_type).toBe("fleet-router");
  });
});

// ─── Session Tracker ─────────────────────────────────────────────────────────

describe("session tracker", () => {
  test("fires AgentDetected on first event per session", () => {
    const bus = new TelemetryEventBus();
    const tracker = new SessionTracker(db, bus);
    tracker.start();

    const detections: string[] = [];
    tracker.onAgentDetected((e) => detections.push(e.session_id));

    // Simulate the pipeline: persist then emit
    const ev = makeEvent({ session_id: "s1" });
    db.insertEvent(ev);
    bus.emit(ev);

    const ev2 = makeEvent({ session_id: "s1" });
    db.insertEvent(ev2);
    bus.emit(ev2);

    expect(detections).toEqual(["s1"]);
    tracker.stop();
  });

  test("ignores events without session_id", () => {
    const bus = new TelemetryEventBus();
    const tracker = new SessionTracker(db, bus);
    tracker.start();
    let detected = 0;
    tracker.onAgentDetected(() => detected++);
    bus.emit(makeEvent({ session_id: "" }));
    expect(detected).toBe(0);
    tracker.stop();
  });
});

// ─── Cost Tracker ────────────────────────────────────────────────────────────

describe("cost tracker", () => {
  test("aggregates into windows and flushes", () => {
    const bus = new TelemetryEventBus();
    const tracker = new CostTracker(db, bus);
    tracker.start();

    const base = new Date("2026-04-04T10:00:05.000Z");
    const ev1 = makeEvent({
      session_id: "s1",
      token_count: 100,
      cost_cents: 50,
      timestamp: base,
    });
    const ev2 = makeEvent({
      session_id: "s1",
      token_count: 200,
      cost_cents: 75,
      timestamp: new Date(base.getTime() + 10_000),
    });
    db.insertEvent(ev1);
    bus.emit(ev1);
    db.insertEvent(ev2);
    bus.emit(ev2);

    tracker.flushAll();

    const summary = db.getCostBreakdown("all", "session");
    expect(summary.total_tokens).toBe(300);
    expect(summary.total_cost_cents).toBe(125);
    tracker.stop();
  });

  test("splits into separate windows across the 1-minute boundary", () => {
    const bus = new TelemetryEventBus();
    const tracker = new CostTracker(db, bus);
    tracker.start();

    const base = new Date("2026-04-04T10:00:10.000Z");
    const later = new Date("2026-04-04T10:01:15.000Z"); // next minute
    db.insertEvent(
      makeEvent({
        session_id: "s1",
        token_count: 100,
        cost_cents: 10,
        timestamp: base,
      })
    );
    bus.emit(
      makeEvent({
        session_id: "s1",
        token_count: 100,
        cost_cents: 10,
        timestamp: base,
      })
    );
    db.insertEvent(
      makeEvent({
        session_id: "s1",
        token_count: 200,
        cost_cents: 20,
        timestamp: later,
      })
    );
    bus.emit(
      makeEvent({
        session_id: "s1",
        token_count: 200,
        cost_cents: 20,
        timestamp: later,
      })
    );
    tracker.flushAll();

    const breakdown = db.getCostBreakdown("all", "session");
    expect(breakdown.total_tokens).toBe(300);
    expect(breakdown.total_cost_cents).toBe(30);
    tracker.stop();
  });

  test("local models (fleet-router) have zero cost by default", () => {
    const tracker = new CostTracker(db, new TelemetryEventBus());
    const cost = tracker.computeCost("fleet-router", 1_000_000, 1_000_000);
    expect(cost).toBe(0);
  });

  test("CLI cost rate fallback is non-zero", () => {
    const tracker = new CostTracker(db, new TelemetryEventBus());
    const cost = tracker.computeCost("claude", 1_000_000, 1_000_000);
    expect(cost).toBeGreaterThan(0);
  });

  test("ignores events without tokens/cost", () => {
    const bus = new TelemetryEventBus();
    const tracker = new CostTracker(db, bus);
    tracker.start();
    const ev = makeEvent({ session_id: "s1" });
    db.insertEvent(ev);
    bus.emit(ev);
    const flushed = tracker.flushAll();
    expect(flushed).toBe(0);
    tracker.stop();
  });
});

// ─── Anomaly Detector ────────────────────────────────────────────────────────

describe("anomaly detector", () => {
  function insertWindow(
    sessionId: string,
    serviceType: ServiceType,
    minutesAgo: number,
    tokens: number,
    costCents: number
  ) {
    db.upsertSession({
      id: sessionId,
      service_type: serviceType,
      session_kind: "cli",
    });
    const start = new Date(Date.now() - minutesAgo * 60_000);
    const end = new Date(start.getTime() + 60_000);
    db.insertMetricWindow({
      session_id: sessionId,
      window_start: start.toISOString(),
      window_end: end.toISOString(),
      token_count: tokens,
      cost_cents: costCents,
      event_count: 1,
    });
  }

  test("detects cost spike when ratio exceeds multiplier", () => {
    // session A: 1000 tokens over 2 minutes -> 500/min
    insertWindow("sA", "claude", 2, 500, 50);
    insertWindow("sA", "claude", 1, 500, 50);
    // session B: 10000 over 2 minutes -> 5000/min (10x)
    insertWindow("sB", "claude", 2, 5000, 500);
    insertWindow("sB", "claude", 1, 5000, 500);

    const detector = new AnomalyDetector(db, {
      costMultiplier: 3.0,
      tokenRateCeiling: 999_999_999,
    });
    const anomalies = detector.check();
    const spikes = anomalies.filter((a) => a.type === "cost_spike");
    expect(spikes.length).toBeGreaterThan(0);
    expect(spikes[0].session_id).toBe("sB");
  });

  test("detects absolute token rate ceiling", () => {
    insertWindow("s-fast", "claude", 2, 200_000, 0);
    insertWindow("s-fast", "claude", 1, 200_000, 0);
    insertWindow("s-slow", "claude", 2, 10, 0);
    insertWindow("s-slow", "claude", 1, 10, 0);
    const detector = new AnomalyDetector(db, {
      costMultiplier: 100_000, // effectively disable spike
      tokenRateCeiling: 50_000,
    });
    const anomalies = detector.check();
    const rates = anomalies.filter((a) => a.type === "token_rate");
    expect(rates.some((r) => r.session_id === "s-fast")).toBe(true);
  });

  test("dedup suppresses repeat alerts within window", () => {
    insertWindow("sA", "claude", 2, 500, 50);
    insertWindow("sA", "claude", 1, 500, 50);
    insertWindow("sB", "claude", 2, 5000, 500);
    insertWindow("sB", "claude", 1, 5000, 500);

    const detector = new AnomalyDetector(db, {
      costMultiplier: 3.0,
      dedupMinutes: 15,
    });
    const first = detector.check();
    const second = detector.check();
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(0);
  });

  test("writes anomaly to audit log", () => {
    insertWindow("sA", "claude", 2, 500, 50);
    insertWindow("sA", "claude", 1, 500, 50);
    insertWindow("sB", "claude", 2, 5000, 500);
    insertWindow("sB", "claude", 1, 5000, 500);

    const detector = new AnomalyDetector(db, { costMultiplier: 3.0 });
    detector.check();
    const audit = db.getAuditLog({ event_type: "anomaly_cost_spike" });
    expect(audit.length).toBeGreaterThan(0);
  });

  test("health scoring: green for fresh, yellow for idle 5-15m, red for >15m", () => {
    const detector = new AnomalyDetector(db);
    db.upsertSession({
      id: "fresh",
      service_type: "claude",
      session_kind: "cli",
      last_event_at: new Date().toISOString(),
    });
    db.upsertSession({
      id: "idle-yellow",
      service_type: "claude",
      session_kind: "cli",
      last_event_at: new Date(Date.now() - 7 * 60_000).toISOString(),
    });
    db.upsertSession({
      id: "idle-red",
      service_type: "claude",
      session_kind: "cli",
      last_event_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    });
    expect(detector.scoreHealth("fresh")).toBe("green");
    expect(detector.scoreHealth("idle-yellow")).toBe("yellow");
    expect(detector.scoreHealth("idle-red")).toBe("red");
  });
});

// ─── Pipeline Integration ────────────────────────────────────────────────────

describe("telemetry pipeline", () => {
  test("ingest persists + emits to all subscribers", () => {
    const pipeline = createTelemetryPipeline(db);
    pipeline.start();

    const detections: string[] = [];
    const events: string[] = [];
    pipeline.onAgentDetected((e) => detections.push(e.session_id));
    pipeline.onEvent((e) => events.push(e.session_id));

    pipeline.ingest(
      makeEvent({
        session_id: "s1",
        token_count: 100,
        cost_cents: 10,
      })
    );

    expect(events).toEqual(["s1"]);
    expect(detections).toEqual(["s1"]);
    expect(db.getSession("s1")!.total_tokens).toBe(100);

    pipeline.stop();
  });

  test("events without session_id are dropped silently", () => {
    const pipeline = createTelemetryPipeline(db);
    pipeline.start();
    let count = 0;
    pipeline.onEvent(() => count++);
    pipeline.ingest(makeEvent({ session_id: "" }));
    expect(count).toBe(0);
    pipeline.stop();
  });

  test("flushing cost tracker populates metrics for dashboard queries", () => {
    const pipeline = createTelemetryPipeline(db);
    pipeline.start();
    pipeline.ingest(
      makeEvent({
        session_id: "s1",
        token_count: 100,
        cost_cents: 20,
      })
    );
    pipeline.costs.flushAll();
    const summary = db.getCostSummary();
    expect(summary.today.tokens).toBe(100);
    expect(summary.today.cost_cents).toBe(20);
    pipeline.stop();
  });
});
