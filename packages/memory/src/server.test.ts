import { describe, expect, test } from "bun:test";
import { MemoryDB } from "./db";
import { MemoryService } from "./memory";
import { createMemoryApp } from "./server";
import { createFakeEmbedder, createFakeLLM } from "./test-helpers";

function makeApp(script: Parameters<typeof createFakeLLM>[0] = {}) {
  const db = new MemoryDB(":memory:");
  const embedder = createFakeEmbedder();
  const llm = createFakeLLM(script);
  const service = new MemoryService({ db, embedder, llm });
  const app = createMemoryApp({ db, service });
  return { app, db, service };
}

describe("memory HTTP API", () => {
  test("GET /status returns stats", async () => {
    const { app } = makeApp();
    const res = await app.request("/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total_memories).toBe(0);
    expect(body.vector_search).toBe(true);
  });

  test("POST /ingest stores a memory", async () => {
    const { app, db } = makeApp({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    const res = await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello world", source: "api", project: "p" }),
    });
    expect(res.status).toBe(200);
    expect(db.getStats().total_memories).toBe(1);
  });

  test("POST /ingest returns 400 on missing text", async () => {
    const { app } = makeApp();
    const res = await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "api" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /ingest returns 400 on invalid JSON", async () => {
    const { app } = makeApp();
    const res = await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("POST /ingest stores provenance fields", async () => {
    const { app, db } = makeApp({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    const res = await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "page content",
        source: "web",
        project: "p",
        source_url: "https://example.com/doc",
        fetched_at: "2026-04-04T10:00:00.000Z",
        refresh_policy: "weekly",
        content_hash: "sha256hex",
      }),
    });
    expect(res.status).toBe(200);
    const mem = db.getMemory(1)!;
    expect(mem.source_url).toBe("https://example.com/doc");
    expect(mem.fetched_at).toBe("2026-04-04T10:00:00.000Z");
    expect(mem.refresh_policy).toBe("weekly");
    expect(mem.content_hash).toBe("sha256hex");
  });

  test("POST /ingest 400 on invalid refresh_policy", async () => {
    const { app } = makeApp({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    const res = await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hi", refresh_policy: "hourly" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toContain("refresh_policy");
  });

  test("POST /ingest without provenance stores null fields", async () => {
    const { app, db } = makeApp({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    const res = await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hi", project: "p" }),
    });
    expect(res.status).toBe(200);
    const mem = db.getMemory(1)!;
    expect(mem.source_url).toBeNull();
    expect(mem.fetched_at).toBeNull();
    expect(mem.refresh_policy).toBeNull();
    expect(mem.content_hash).toBeNull();
  });

  test("POST /ingest accepts each valid refresh_policy value", async () => {
    const policies = ["static", "daily", "weekly", "monthly", "on-demand"];
    for (const policy of policies) {
      const { app, db } = makeApp({
        ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
      });
      const res = await app.request("/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "x", refresh_policy: policy }),
      });
      expect(res.status).toBe(200);
      expect(db.getMemory(1)!.refresh_policy).toBe(policy as any);
    }
  });

  test("GET /query returns answer", async () => {
    const { app } = makeApp({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
      query: "the answer",
    });
    await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", project: "p" }),
    });
    const res = await app.request("/query?q=hi&project=p");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.answer).toBe("the answer");
    expect(body.question).toBe("hi");
  });

  test("GET /query returns 400 without q param", async () => {
    const { app } = makeApp();
    const res = await app.request("/query");
    expect(res.status).toBe(400);
  });

  test("GET /query?deep=true routes through deep query pipeline", async () => {
    const script = {
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
      query: "deep answer",
      evaluate: [{ sufficient: true }],
    };
    const { app } = makeApp(script);
    await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", project: "p" }),
    });
    const res = await app.request("/query?q=hi&project=p&deep=true");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.answer).toBe("deep answer");
    expect(script.evaluate!.length).toBe(0);
  });

  test("GET /memories lists stored memories", async () => {
    const { app } = makeApp({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "a", project: "p" }),
    });
    const res = await app.request("/memories?project=p");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.count).toBe(1);
    expect(body.memories[0].summary).toBe("s");
  });

  test("POST /delete removes a memory", async () => {
    const { app, db } = makeApp({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "gone" }),
    });
    const id = 1;
    const res = await app.request("/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory_id: id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("deleted");
    expect(db.getMemory(id)).toBeNull();
  });

  test("POST /delete returns not_found for missing id", async () => {
    const { app } = makeApp();
    const res = await app.request("/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memory_id: 999 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("not_found");
  });

  test("POST /clear wipes memories", async () => {
    const { app, db } = makeApp({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "a" }),
    });
    expect(db.getStats().total_memories).toBe(1);
    const res = await app.request("/clear", { method: "POST" });
    expect(res.status).toBe(200);
    expect(db.getStats().total_memories).toBe(0);
  });

  test("GET /entities lists stored entities", async () => {
    const { app, db } = makeApp();
    db.upsertEntity("Alpha", "project", "p");
    db.upsertEntity("Beta", "person", "p");
    const res = await app.request("/entities?project=p");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.count).toBe(2);
  });

  test("GET /graph returns entity with relationships", async () => {
    const { app, db } = makeApp();
    const a = db.upsertEntity("A", "project", "p");
    const b = db.upsertEntity("B", "technology", "p");
    db.storeRelationship(a, b, "uses");
    const res = await app.request("/graph?entity=A&project=p");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.entity.name).toBe("A");
    expect(body.relationships.length).toBe(1);
    expect(body.relationships[0].relation).toBe("uses");
  });

  test("GET /graph 404 on missing entity", async () => {
    const { app } = makeApp();
    const res = await app.request("/graph?entity=ghost");
    expect(res.status).toBe(404);
  });

  test("POST /consolidate", async () => {
    const { app } = makeApp({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
      consolidate: { summary: "x", insight: "y", connections: [] },
    });
    await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "one" }),
    });
    await app.request("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "two different" }),
    });
    const res = await app.request("/consolidate", { method: "POST" });
    expect(res.status).toBe(200);
  });

  test("POST /backfill returns count", async () => {
    const { app } = makeApp();
    const res = await app.request("/backfill", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("done");
    expect(typeof body.backfilled).toBe("number");
  });
});
