import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { ControlDB } from "./db";
import { createApp, createState, stopState } from "./server";
import { generateHints } from "./install-hints";
import type { InstallEvent, InstallSession } from "./types";
import type { Hono } from "hono";
import type { ControlPlaneState } from "./server";

const TEST_DB = "/tmp/seed-control-install-test.db";

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

async function post(path: string, body?: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function get(path: string) {
  return app.request(path);
}

// --- DB Layer ---

describe("install session DB methods", () => {
  test("createInstallSession + getInstallSession round-trip", () => {
    const s = db.createInstallSession({
      install_id: "i-1",
      machine_id: "ren3",
      target: "agent",
      os: "darwin",
      arch: "arm64",
      env: { has_sudo: true },
    });
    expect(s.install_id).toBe("i-1");
    expect(s.target).toBe("agent");
    expect(s.env).toEqual({ has_sudo: true });
    expect(s.status).toBe("in_progress");

    const loaded = db.getInstallSession("i-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.os).toBe("darwin");
  });

  test("createInstallSession is idempotent on duplicate id", () => {
    db.createInstallSession({ install_id: "i-1", target: "agent" });
    db.createInstallSession({ install_id: "i-1", target: "control-plane" });
    const loaded = db.getInstallSession("i-1");
    // First write wins
    expect(loaded!.target).toBe("agent");
  });

  test("recordInstallEvent persists with details", () => {
    db.createInstallSession({ install_id: "i-1", target: "agent" });
    const e = db.recordInstallEvent({
      install_id: "i-1",
      step: "download.binary",
      status: "failed",
      details: { error_type: "network_error", url: "https://x" },
    });
    expect(e.id).toBeGreaterThan(0);
    expect(e.details).toEqual({
      error_type: "network_error",
      url: "https://x",
    });
  });

  test("updateInstallSession patches fields", () => {
    db.createInstallSession({ install_id: "i-1", target: "agent" });
    const updated = db.updateInstallSession("i-1", {
      machine_id: "ren3",
      steps_total: 8,
      steps_completed: 3,
      last_step: "verify.checksum",
      status: "in_progress",
    });
    expect(updated).not.toBeNull();
    expect(updated!.machine_id).toBe("ren3");
    expect(updated!.steps_total).toBe(8);
    expect(updated!.steps_completed).toBe(3);
  });

  test("listInstallSessions filters by status and machine_id", () => {
    db.createInstallSession({ install_id: "a", target: "agent", machine_id: "ren1" });
    db.createInstallSession({ install_id: "b", target: "agent", machine_id: "ren2" });
    db.createInstallSession({ install_id: "c", target: "agent", machine_id: "ren1" });
    db.updateInstallSession("b", { status: "failed" });

    const all = db.listInstallSessions();
    expect(all.length).toBe(3);

    const failed = db.listInstallSessions({ status: "failed" });
    expect(failed.length).toBe(1);
    expect(failed[0].install_id).toBe("b");

    const ren1 = db.listInstallSessions({ machine_id: "ren1" });
    expect(ren1.length).toBe(2);
  });

  test("listInstallEvents supports since filter", async () => {
    db.createInstallSession({ install_id: "i-1", target: "agent" });
    db.recordInstallEvent({
      install_id: "i-1",
      step: "a",
      status: "ok",
      timestamp: "2026-01-01T00:00:00Z",
    });
    db.recordInstallEvent({
      install_id: "i-1",
      step: "b",
      status: "ok",
      timestamp: "2026-01-01T00:00:05Z",
    });
    db.recordInstallEvent({
      install_id: "i-1",
      step: "c",
      status: "ok",
      timestamp: "2026-01-01T00:00:10Z",
    });

    const all = db.listInstallEvents("i-1");
    expect(all.length).toBe(3);

    const after = db.listInstallEvents("i-1", {
      since: "2026-01-01T00:00:05Z",
    });
    expect(after.length).toBe(1);
    expect(after[0].step).toBe("c");
  });

  test("latestInstallEvent returns most recent", () => {
    db.createInstallSession({ install_id: "i-1", target: "agent" });
    db.recordInstallEvent({ install_id: "i-1", step: "a", status: "ok" });
    db.recordInstallEvent({ install_id: "i-1", step: "b", status: "failed" });
    const latest = db.latestInstallEvent("i-1");
    expect(latest!.step).toBe("b");
  });
});

// --- Hints Engine ---

describe("install hints engine", () => {
  const session: InstallSession = {
    install_id: "i-1",
    machine_id: null,
    target: "agent",
    os: "darwin",
    arch: "arm64",
    started_at: new Date().toISOString(),
    completed_at: null,
    status: "in_progress",
    steps_total: null,
    steps_completed: 0,
    last_step: null,
    last_error: null,
    env: null,
  };

  test("successful event returns continue", () => {
    const hints = generateHints(
      { install_id: "i-1", step: "download.binary", status: "ok" },
      session,
      []
    );
    expect(hints.length).toBe(1);
    expect(hints[0].action).toBe("continue");
  });

  test("checksum_mismatch on first failure suggests retry with 5s backoff", () => {
    const hints = generateHints(
      {
        install_id: "i-1",
        step: "verify.checksum",
        status: "failed",
        details: { error_type: "checksum_mismatch" },
      },
      session,
      []
    );
    expect(hints[0].action).toBe("retry");
    expect(hints[0].delay_ms).toBe(5000);
  });

  test("checksum_mismatch after 3 failures suggests abort", () => {
    const prior: InstallEvent[] = [1, 2, 3].map((i) => ({
      id: i,
      install_id: "i-1",
      timestamp: new Date().toISOString(),
      step: "verify.checksum",
      status: "failed",
      details: { error_type: "checksum_mismatch" },
    }));
    const hints = generateHints(
      {
        install_id: "i-1",
        step: "verify.checksum",
        status: "failed",
        details: { error_type: "checksum_mismatch" },
      },
      session,
      prior
    );
    expect(hints[0].action).toBe("abort");
  });

  test("network_error suggests retry with 10s backoff", () => {
    const hints = generateHints(
      {
        install_id: "i-1",
        step: "download.binary",
        status: "failed",
        details: { error_type: "network_error" },
      },
      session,
      []
    );
    expect(hints[0].action).toBe("retry");
    expect(hints[0].delay_ms).toBe(10000);
  });

  test("permission_denied suggests abort", () => {
    const hints = generateHints(
      {
        install_id: "i-1",
        step: "install.binary",
        status: "failed",
        details: { error_type: "permission_denied" },
      },
      session,
      []
    );
    expect(hints[0].action).toBe("abort");
  });

  test("port_in_use suggests abort", () => {
    const hints = generateHints(
      {
        install_id: "i-1",
        step: "service.start",
        status: "failed",
        details: { error_type: "port_in_use" },
      },
      session,
      []
    );
    expect(hints[0].action).toBe("abort");
  });
});

// --- Endpoint ---

describe("POST /v1/install/event", () => {
  test("first event creates session and records event", async () => {
    const res = await post("/v1/install/event", {
      install_id: "i-1",
      machine_id: "ren3",
      target: "agent",
      os: "darwin",
      arch: "arm64",
      step: "install.started",
      status: "ok",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ack).toBe(true);
    expect(body.install_id).toBe("i-1");
    expect(Array.isArray(body.hints)).toBe(true);
    expect(body.abort).toBe(false);

    const session = db.getInstallSession("i-1");
    expect(session).not.toBeNull();
    expect(session!.machine_id).toBe("ren3");
    expect(session!.target).toBe("agent");

    const events = db.listInstallEvents("i-1");
    expect(events.length).toBe(1);
    expect(events[0].step).toBe("install.started");
  });

  test("rejects missing fields", async () => {
    const res = await post("/v1/install/event", { install_id: "i-1" });
    expect(res.status).toBe(400);
  });

  test("rejects invalid status", async () => {
    const res = await post("/v1/install/event", {
      install_id: "i-1",
      step: "x",
      status: "bogus",
    });
    expect(res.status).toBe(400);
  });

  test("rejects invalid JSON", async () => {
    const res = await app.request("/v1/install/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("failed event returns retry hint for network_error", async () => {
    const res = await post("/v1/install/event", {
      install_id: "i-1",
      target: "agent",
      step: "download.binary",
      status: "failed",
      details: { error_type: "network_error" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hints[0].action).toBe("retry");
    expect(body.abort).toBe(false);
  });

  test("permission_denied surfaces abort:true in response", async () => {
    const res = await post("/v1/install/event", {
      install_id: "i-1",
      target: "agent",
      step: "install.binary",
      status: "failed",
      details: { error_type: "permission_denied" },
    });
    const body = await res.json();
    expect(body.abort).toBe(true);
  });

  test("install.complete with status=ok marks session success", async () => {
    await post("/v1/install/event", {
      install_id: "i-1",
      target: "agent",
      step: "install.started",
      status: "ok",
    });
    await post("/v1/install/event", {
      install_id: "i-1",
      step: "install.complete",
      status: "ok",
    });
    const session = db.getInstallSession("i-1");
    expect(session!.status).toBe("success");
    expect(session!.completed_at).not.toBeNull();
  });

  test("install.complete with status=failed marks session failed", async () => {
    await post("/v1/install/event", {
      install_id: "i-1",
      target: "agent",
      step: "install.started",
      status: "ok",
    });
    await post("/v1/install/event", {
      install_id: "i-1",
      step: "install.complete",
      status: "failed",
    });
    const session = db.getInstallSession("i-1");
    expect(session!.status).toBe("failed");
  });

  test("rate limit: 60 req/min per install_id", async () => {
    // Send 60 ok events — all should succeed
    for (let i = 0; i < 60; i++) {
      const res = await post("/v1/install/event", {
        install_id: "rate-test",
        target: "agent",
        step: `step.${i}`,
        status: "ok",
      });
      expect(res.status).toBe(200);
    }
    // 61st should be rate limited
    const over = await post("/v1/install/event", {
      install_id: "rate-test",
      target: "agent",
      step: "step.61",
      status: "ok",
    });
    expect(over.status).toBe(429);

    // Different install_id still works
    const other = await post("/v1/install/event", {
      install_id: "other-id",
      target: "agent",
      step: "step.1",
      status: "ok",
    });
    expect(other.status).toBe(200);
  });

  test("steps_completed increments on ok events", async () => {
    await post("/v1/install/event", {
      install_id: "i-1",
      target: "agent",
      step: "a",
      status: "ok",
    });
    await post("/v1/install/event", {
      install_id: "i-1",
      step: "b",
      status: "ok",
    });
    await post("/v1/install/event", {
      install_id: "i-1",
      step: "c",
      status: "ok",
    });
    const session = db.getInstallSession("i-1");
    expect(session!.steps_completed).toBe(3);
  });

  test("failed event captures last_error", async () => {
    await post("/v1/install/event", {
      install_id: "i-1",
      target: "agent",
      step: "download.binary",
      status: "failed",
      details: { error_type: "network_error", error: "connection refused" },
    });
    const session = db.getInstallSession("i-1");
    expect(session!.last_error).toBe("connection refused");
    expect(session!.last_step).toBe("download.binary");
  });

  test("endpoint does NOT require operator auth", async () => {
    // Rebuild state with operator token required
    stopState(state);
    db.close();
    cleanup();
    db = new ControlDB(TEST_DB);
    state = createState(db, "fake-hash-for-operator");
    app = createApp(state);

    const res = await post("/v1/install/event", {
      install_id: "i-no-auth",
      target: "agent",
      step: "install.started",
      status: "ok",
    });
    expect(res.status).toBe(200);
  });
});

// --- Observation endpoints ---

describe("GET /v1/installs", () => {
  test("lists installs (operator-only, requires auth when token set)", async () => {
    // No operator token set: should work without auth.
    db.createInstallSession({ install_id: "i-1", target: "agent" });
    db.createInstallSession({ install_id: "i-2", target: "control-plane" });
    const res = await get("/v1/installs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(2);
  });

  test("filters by status", async () => {
    db.createInstallSession({ install_id: "i-1", target: "agent" });
    db.createInstallSession({ install_id: "i-2", target: "agent" });
    db.updateInstallSession("i-2", { status: "failed" });
    const res = await get("/v1/installs?status=failed");
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].install_id).toBe("i-2");
  });

  test("returns 404 for unknown install id", async () => {
    const res = await get("/v1/installs/nope");
    expect(res.status).toBe(404);
  });

  test("detail view returns session + events", async () => {
    db.createInstallSession({ install_id: "i-1", target: "agent" });
    db.recordInstallEvent({ install_id: "i-1", step: "a", status: "ok" });
    db.recordInstallEvent({ install_id: "i-1", step: "b", status: "ok" });
    const res = await get("/v1/installs/i-1");
    const body = await res.json();
    expect(body.session.install_id).toBe("i-1");
    expect(body.events.length).toBe(2);
  });

  test("events endpoint supports since param", async () => {
    db.createInstallSession({ install_id: "i-1", target: "agent" });
    db.recordInstallEvent({
      install_id: "i-1",
      step: "a",
      status: "ok",
      timestamp: "2026-01-01T00:00:00Z",
    });
    db.recordInstallEvent({
      install_id: "i-1",
      step: "b",
      status: "ok",
      timestamp: "2026-01-01T00:00:10Z",
    });
    const res = await get(
      "/v1/installs/i-1/events?since=2026-01-01T00:00:05Z"
    );
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].step).toBe("b");
  });
});
