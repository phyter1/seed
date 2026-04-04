import { describe, test, expect } from "bun:test";
import {
  ProxyForwarder,
  createProxyApp,
  createProxy,
  WS_OPEN,
  type WsSender,
  type ForwardableMessage,
} from "./proxy";

// --- Fake WebSocket ---

function makeFakeWs(initialOpen: boolean = true) {
  const sent: string[] = [];
  const ws: WsSender & { sent: string[]; setOpen: (o: boolean) => void; failNext: number } = {
    readyState: initialOpen ? WS_OPEN : 0,
    sent,
    failNext: 0,
    setOpen(o: boolean) {
      this.readyState = o ? WS_OPEN : 3;
    },
    send(data: string) {
      if (this.failNext > 0) {
        this.failNext--;
        throw new Error("simulated send failure");
      }
      sent.push(data);
    },
  };
  return ws;
}

const silentLogger = { log: () => {}, warn: () => {} };

function hookMsg(n: number): ForwardableMessage {
  return {
    type: "hook_event",
    machine_id: "ren1",
    received_at: new Date().toISOString(),
    payload: { event: "PreToolUse", n },
  };
}

// --- ProxyForwarder ---

describe("ProxyForwarder", () => {
  test("forwards immediately when ws is open", () => {
    const ws = makeFakeWs(true);
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });

    fwd.enqueue(hookMsg(1));
    fwd.enqueue(hookMsg(2));

    expect(ws.sent.length).toBe(2);
    expect(fwd.getBufferLength()).toBe(0);
    expect(fwd.getStats().forwarded).toBe(2);
    expect(fwd.getStats().buffered).toBe(0);

    const parsed = JSON.parse(ws.sent[0]);
    expect(parsed.type).toBe("hook_event");
    expect(parsed.machine_id).toBe("ren1");
    expect(parsed.payload.n).toBe(1);
  });

  test("buffers when ws is disconnected", () => {
    const ws = makeFakeWs(false);
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });

    fwd.enqueue(hookMsg(1));
    fwd.enqueue(hookMsg(2));
    fwd.enqueue(hookMsg(3));

    expect(ws.sent.length).toBe(0);
    expect(fwd.getBufferLength()).toBe(3);
    expect(fwd.getStats().buffered).toBe(3);
    expect(fwd.getStats().forwarded).toBe(0);
  });

  test("buffers when getWs returns null", () => {
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => null,
      logger: silentLogger,
    });

    fwd.enqueue(hookMsg(1));

    expect(fwd.getBufferLength()).toBe(1);
  });

  test("drops oldest when buffer is full", () => {
    const ws = makeFakeWs(false);
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 3,
      getWs: () => ws,
      logger: silentLogger,
    });

    for (let i = 1; i <= 5; i++) fwd.enqueue(hookMsg(i));

    expect(fwd.getBufferLength()).toBe(3);
    expect(fwd.getStats().dropped).toBe(2);

    // Oldest (1, 2) dropped — should retain 3, 4, 5
    const retained = fwd.peekBuffer().map((m) => (m.payload as any).n);
    expect(retained).toEqual([3, 4, 5]);
  });

  test("flushes buffered events on reconnect", () => {
    const ws = makeFakeWs(false);
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });

    // While disconnected, buffer up
    fwd.enqueue(hookMsg(1));
    fwd.enqueue(hookMsg(2));
    fwd.enqueue(hookMsg(3));
    expect(fwd.getBufferLength()).toBe(3);

    // Reconnect
    ws.setOpen(true);
    const flushed = fwd.flush();

    expect(flushed).toBe(3);
    expect(ws.sent.length).toBe(3);
    expect(fwd.getBufferLength()).toBe(0);
    expect(fwd.getStats().forwarded).toBe(3);

    // Order preserved
    const order = ws.sent.map((s) => JSON.parse(s).payload.n);
    expect(order).toEqual([1, 2, 3]);
  });

  test("flush is a no-op while ws is still down", () => {
    const ws = makeFakeWs(false);
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });

    fwd.enqueue(hookMsg(1));
    const flushed = fwd.flush();

    expect(flushed).toBe(0);
    expect(fwd.getBufferLength()).toBe(1);
  });

  test("flush stops on send failure without losing events", () => {
    const ws = makeFakeWs(true);
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });

    // Seed the buffer while pretending to be down
    ws.setOpen(false);
    fwd.enqueue(hookMsg(1));
    fwd.enqueue(hookMsg(2));
    fwd.enqueue(hookMsg(3));

    // Now allow send but fail on the 2nd one
    ws.setOpen(true);
    ws.failNext = 0;
    // Override send to fail on the second call
    const origSend = ws.send.bind(ws);
    let callCount = 0;
    ws.send = (data: string) => {
      callCount++;
      if (callCount === 2) throw new Error("simulated");
      origSend(data);
    };

    const flushed = fwd.flush();

    expect(flushed).toBe(1); // only the first made it
    expect(fwd.getBufferLength()).toBe(2); // 2 and 3 still in buffer
    const remaining = fwd.peekBuffer().map((m) => (m.payload as any).n);
    expect(remaining).toEqual([2, 3]);
  });

  test("send failure during enqueue buffers the event", () => {
    const ws = makeFakeWs(true);
    ws.failNext = 1;
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });

    fwd.enqueue(hookMsg(1));

    expect(ws.sent.length).toBe(0);
    expect(fwd.getBufferLength()).toBe(1);
  });
});

// --- Proxy HTTP app ---

describe("createProxyApp", () => {
  test("POST /hooks forwards hook_event messages", async () => {
    const ws = makeFakeWs(true);
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });
    const app = createProxyApp(fwd, "ren1");

    const res = await app.request("/hooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "PreToolUse", session_id: "abc" }),
    });

    expect(res.status).toBe(202);
    expect(ws.sent.length).toBe(1);
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.type).toBe("hook_event");
    expect(sent.machine_id).toBe("ren1");
    expect(sent.payload.event).toBe("PreToolUse");
    expect(sent.payload.session_id).toBe("abc");
    expect(typeof sent.received_at).toBe("string");
  });

  test("POST /hooks rejects non-object bodies", async () => {
    const ws = makeFakeWs(true);
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });
    const app = createProxyApp(fwd, "ren1");

    const res = await app.request("/hooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["not", "an", "object"]),
    });

    expect(res.status).toBe(400);
    expect(ws.sent.length).toBe(0);
  });

  test("POST /hooks rejects invalid JSON", async () => {
    const ws = makeFakeWs(true);
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });
    const app = createProxyApp(fwd, "ren1");

    const res = await app.request("/hooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });

    expect(res.status).toBe(400);
  });

  test("POST /otlp/v1/logs forwards otlp_event with signal=logs", async () => {
    const ws = makeFakeWs(true);
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });
    const app = createProxyApp(fwd, "ren1");

    const res = await app.request("/otlp/v1/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceLogs: [] }),
    });

    expect(res.status).toBe(202);
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.type).toBe("otlp_event");
    expect(sent.signal).toBe("logs");
  });

  test("POST /otlp/v1/metrics forwards otlp_event with signal=metrics", async () => {
    const ws = makeFakeWs(true);
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });
    const app = createProxyApp(fwd, "ren1");

    const res = await app.request("/otlp/v1/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceMetrics: [] }),
    });

    expect(res.status).toBe(202);
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.type).toBe("otlp_event");
    expect(sent.signal).toBe("metrics");
  });

  test("POST /hooks buffers when ws is down then flushes on reconnect", async () => {
    const ws = makeFakeWs(false);
    const fwd = new ProxyForwarder({
      machineId: "ren1",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });
    const app = createProxyApp(fwd, "ren1");

    // Three hook POSTs while disconnected
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/hooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "PreToolUse", n: i }),
      });
      expect(res.status).toBe(202);
    }

    expect(ws.sent.length).toBe(0);
    expect(fwd.getBufferLength()).toBe(3);

    // Reconnect and flush
    ws.setOpen(true);
    fwd.flush();

    expect(ws.sent.length).toBe(3);
    expect(fwd.getBufferLength()).toBe(0);
  });

  test("GET /health reports proxy stats", async () => {
    const ws = makeFakeWs(true);
    const fwd = new ProxyForwarder({
      machineId: "ren2",
      bufferMax: 10,
      getWs: () => ws,
      logger: silentLogger,
    });
    const app = createProxyApp(fwd, "ren2");

    fwd.enqueue(hookMsg(1));

    const res = await app.request("/health");
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.machine_id).toBe("ren2");
    expect(data.forwarded).toBe(1);
  });
});

// --- createProxy wiring ---

describe("createProxy", () => {
  test("applies default config and merges overrides", () => {
    const ws = makeFakeWs(true);
    const handle = createProxy({
      machineId: "ren1",
      config: { buffer_max: 42 },
      getWs: () => ws,
      logger: silentLogger,
    });

    expect(handle.config.buffer_max).toBe(42);
    expect(handle.config.listen_port).toBe(4312); // default
    expect(handle.config.enabled).toBe(true); // default

    handle.stop();
  });

  test("periodic flush interval drains buffered events", async () => {
    const ws = makeFakeWs(false);
    const handle = createProxy({
      machineId: "ren1",
      config: { flush_interval_ms: 20 },
      getWs: () => ws,
      logger: silentLogger,
    });

    handle.forwarder.enqueue(hookMsg(1));
    handle.forwarder.enqueue(hookMsg(2));
    expect(handle.forwarder.getBufferLength()).toBe(2);

    // Reconnect — next flush tick should drain the buffer
    ws.setOpen(true);
    await new Promise((r) => setTimeout(r, 60));

    expect(handle.forwarder.getBufferLength()).toBe(0);
    expect(ws.sent.length).toBe(2);

    handle.stop();
  });
});
