import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDB } from "./db";
import { MemoryService } from "./memory";
import { createFakeEmbedder, createFakeLLM } from "./test-helpers";
import { chunkText, CHUNK_THRESHOLD } from "./chunk";

function makeService(script: Parameters<typeof createFakeLLM>[0]) {
  const db = new MemoryDB(":memory:");
  const embedder = createFakeEmbedder();
  const llm = createFakeLLM(script);
  const service = new MemoryService({ db, embedder, llm });
  return { db, service };
}

describe("MemoryService.ingest", () => {
  test("stores a short memory with summary + embedding", async () => {
    const { db, service } = makeService({
      ingest: {
        summary: "A note about Seed",
        entities: ["Seed", "Ryan"],
        topics: ["fleet"],
        importance: 0.7,
      },
    });
    const result = await service.ingest("Seed is a fleet management plane.", "test", "seed");
    expect(result.status).toBe("stored");
    expect(result.memory_id).toBeGreaterThan(0);
    const mem = db.getMemory(result.memory_id!);
    expect(mem).not.toBeNull();
    expect(mem!.summary).toBe("A note about Seed");
    expect(mem!.entities).toEqual(["Seed", "Ryan"]);
    expect(mem!.project).toBe("seed");
    expect(mem!.source).toBe("test");
  });

  test("detects duplicates via cosine similarity", async () => {
    const { service } = makeService({
      ingest: {
        summary: "Identical note",
        entities: [],
        topics: [],
        importance: 0.5,
      },
    });
    const first = await service.ingest("same text", "a", "p");
    expect(first.status).toBe("stored");
    const second = await service.ingest("same text", "a", "p");
    expect(second.status).toBe("duplicate");
    expect(second.duplicate_of).toBe(first.memory_id);
    expect(second.similarity).toBeGreaterThanOrEqual(0.85);
  });

  test("stores knowledge graph triples", async () => {
    const { db, service } = makeService({
      ingest: {
        summary: "Seed uses Bun",
        entities: ["Seed", "Bun"],
        topics: ["tech"],
        importance: 0.6,
        triples: [
          { subject: "Seed", subject_type: "project", predicate: "uses", object: "Bun", object_type: "technology" },
        ],
      },
    });
    const result = await service.ingest("Seed uses Bun.", "note", "seed");
    expect(result.status).toBe("stored");
    const graph = db.getEntityGraph("Seed", "seed");
    expect(graph).not.toBeNull();
    expect(graph!.relationships.length).toBe(1);
    expect(graph!.relationships[0]!.relation).toBe("uses");
    expect(graph!.relationships[0]!.entity).toBe("Bun");
  });

  test("chunks long text into multiple child memories", async () => {
    const longText = "paragraph one.\n\n" + "long body sentence. ".repeat(200);
    expect(longText.length).toBeGreaterThan(CHUNK_THRESHOLD);
    const { db, service } = makeService({
      ingest: {
        summary: "A long doc",
        entities: [],
        topics: [],
        importance: 0.5,
      },
    });
    const result = await service.ingest(longText, "doc", "p");
    expect(result.status).toBe("stored");
    expect(result.chunks).toBeGreaterThan(1);
    const parent = db.getMemory(result.memory_id!);
    expect(parent!.parent_id).toBeNull();
    // Every child's parent_id points at the parent
    const children = db.raw
      .prepare("SELECT id, parent_id FROM memories WHERE parent_id = ?")
      .all(result.memory_id!) as Array<{ id: number; parent_id: number }>;
    expect(children.length).toBe(result.chunks!);
  });

  test("recovers gracefully when LLM returns invalid JSON", async () => {
    const { db, service } = makeService({ raw: "not json at all" });
    const result = await service.ingest("hello world", "src", "p");
    expect(result.status).toBe("stored");
    const mem = db.getMemory(result.memory_id!);
    expect(mem).not.toBeNull();
    expect(mem!.summary).toContain("not json");
  });
});

describe("MemoryService.query", () => {
  test("returns LLM answer, restricted to project scope", async () => {
    const { service } = makeService({
      ingest: { summary: "p1 note", entities: [], topics: [], importance: 0.6 },
      query: "Answer from memories",
    });
    await service.ingest("about project one", "src", "p1");
    const answer = await service.query("what about p1?", "p1");
    expect(answer).toBe("Answer from memories");
  });

  test("returns a message when no memories are stored", async () => {
    const { service } = makeService({ query: "nothing" });
    const answer = await service.query("anything?", "empty");
    expect(answer).toContain("No memories");
  });
});

describe("MemoryService.deepQuery", () => {
  test("stops when evaluator says sufficient on first pass", async () => {
    const script = {
      ingest: { summary: "note", entities: [], topics: [], importance: 0.6 },
      query: "final answer",
      evaluate: [{ sufficient: true, reason: "enough context" }],
    };
    const { service } = makeService(script);
    await service.ingest("about things", "src", "p");
    const answer = await service.query("q?", "p", { deep: true });
    expect(answer).toBe("final answer");
    // One evaluate call + one query call
    const evalCalls = script.evaluate!.length;
    expect(evalCalls).toBe(0); // shifted
  });

  test("does a second search when evaluator requests a refined query", async () => {
    const script = {
      ingest: { summary: "note", entities: [], topics: [], importance: 0.6 },
      query: "synthesized answer",
      evaluate: [
        { sufficient: false, reason: "need more", refined_query: "something else" },
        { sufficient: true, reason: "ok now" },
      ],
    };
    const { service } = makeService(script);
    await service.ingest("seed data", "s", "p");
    const answer = await service.query("q?", "p", { deep: true, maxIterations: 3 });
    expect(answer).toBe("synthesized answer");
    // Both evaluator responses consumed
    expect(script.evaluate!.length).toBe(0);
  });

  test("bails out after maxIterations even if still insufficient", async () => {
    const script = {
      ingest: { summary: "note", entities: [], topics: [], importance: 0.6 },
      query: "best-effort answer",
      evaluate: Array.from({ length: 5 }, () => ({
        sufficient: false,
        refined_query: "more more more",
      })),
    };
    const { service } = makeService(script);
    await service.ingest("data", "s", "p");
    const answer = await service.query("q?", "p", { deep: true, maxIterations: 2 });
    expect(answer).toBe("best-effort answer");
    // Only 2 evaluator calls made (maxIterations)
    expect(script.evaluate!.length).toBe(3);
  });

  test("returns no-memories message when DB is empty", async () => {
    const { service } = makeService({ query: "shouldn't be called" });
    const answer = await service.query("anything?", "empty", { deep: true });
    expect(answer).toContain("No memories");
  });
});

describe("MemoryService.consolidate", () => {
  test("skips when fewer than 2 memories", async () => {
    const { service } = makeService({
      ingest: { summary: "only one", entities: [], topics: [], importance: 0.5 },
    });
    await service.ingest("solo", "s", "p");
    const r = await service.consolidate();
    expect(r.status).toBe("skipped");
  });

  test("synthesizes insight across multiple unconsolidated memories", async () => {
    const { db, service } = makeService({
      ingest: { summary: "note", entities: ["X"], topics: ["t"], importance: 0.5 },
      consolidate: {
        summary: "shared theme",
        insight: "they all mention X",
        connections: [{ from_id: 1, to_id: 2, relationship: "about X" }],
      },
    });
    await service.ingest("first note about X", "a", "p");
    await service.ingest("second distinct note mentioning X", "b", "p");
    const r = await service.consolidate();
    expect(r.status).toBe("consolidated");
    expect(r.memories_processed).toBe(2);
    expect(r.insight).toBe("they all mention X");
    // source memories should now be marked consolidated
    const unconsolidated = db.readUnconsolidated();
    expect(unconsolidated.length).toBe(0);
  });
});

describe("chunkText", () => {
  test("returns single chunk for short text", () => {
    expect(chunkText("short text")).toEqual(["short text"]);
  });

  test("splits long text into multiple chunks", () => {
    const text = "paragraph one.\n\n" + "body sentence. ".repeat(500);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // All chunks should be non-empty
    for (const c of chunks) expect(c.length).toBeGreaterThan(0);
  });
});

describe("MemoryDB", () => {
  let db: MemoryDB;
  beforeEach(() => {
    db = new MemoryDB(":memory:");
  });

  test("stats reflect inserts", () => {
    expect(db.getStats().total_memories).toBe(0);
    db.storeMemory({
      raw_text: "hi",
      summary: "greet",
      entities: [],
      topics: [],
      importance: 0.5,
    });
    expect(db.getStats().total_memories).toBe(1);
  });

  test("delete removes memory and embedding", () => {
    const emb = new Array(1024).fill(0).map((_, i) => Math.sin(i));
    const id = db.storeMemory({
      raw_text: "x",
      summary: "y",
      entities: [],
      topics: [],
      importance: 0.5,
      embedding: emb,
    });
    expect(db.deleteMemory(id)).toBe(true);
    expect(db.getMemory(id)).toBeNull();
    expect(db.deleteMemory(id)).toBe(false);
  });

  test("upsertEntity deduplicates by name+type+project (case insensitive)", () => {
    const a = db.upsertEntity("Seed", "project", "p");
    const b = db.upsertEntity("seed", "project", "p");
    const c = db.upsertEntity("Seed", "project", "other");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test("listEntities filters by type and project", () => {
    db.upsertEntity("A", "person", "p");
    db.upsertEntity("B", "project", "p");
    db.upsertEntity("C", "person", "other");
    expect(db.listEntities("person").length).toBe(2);
    expect(db.listEntities("person", "p").length).toBe(1);
    expect(db.listEntities("", "p").length).toBe(2);
  });

  test("knn search returns nearest neighbors", () => {
    const emb1 = new Array(1024).fill(0).map((_, i) => Math.sin(i));
    const emb2 = new Array(1024).fill(0).map((_, i) => Math.cos(i));
    db.storeMemory({ raw_text: "a", summary: "a", entities: [], topics: [], importance: 0.5, embedding: emb1 });
    db.storeMemory({ raw_text: "b", summary: "b", entities: [], topics: [], importance: 0.5, embedding: emb2 });
    const results = db.knnSearch(emb1, 2);
    expect(results.length).toBe(2);
    expect(results[0]!.distance).toBeLessThan(results[1]!.distance);
  });
});

describe("MemoryDB provenance columns", () => {
  let db: MemoryDB;
  beforeEach(() => {
    db = new MemoryDB(":memory:");
  });

  test("schema includes source_url, fetched_at, refresh_policy, content_hash", () => {
    const cols = new Set<string>(
      (db.raw.prepare("PRAGMA table_info(memories)").all() as any[]).map((r) => r.name)
    );
    expect(cols.has("source_url")).toBe(true);
    expect(cols.has("fetched_at")).toBe(true);
    expect(cols.has("refresh_policy")).toBe(true);
    expect(cols.has("content_hash")).toBe(true);
  });

  test("round-trips all four provenance fields", () => {
    const fetchedAt = "2026-04-04T12:00:00.000Z";
    const id = db.storeMemory({
      raw_text: "page contents",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      source_url: "https://example.com/doc",
      fetched_at: fetchedAt,
      refresh_policy: "weekly",
      content_hash: "deadbeef".repeat(8),
    });
    const mem = db.getMemory(id);
    expect(mem).not.toBeNull();
    expect(mem!.source_url).toBe("https://example.com/doc");
    expect(mem!.fetched_at).toBe(fetchedAt);
    expect(mem!.refresh_policy).toBe("weekly");
    expect(mem!.content_hash).toBe("deadbeef".repeat(8));
  });

  test("omitting provenance yields null columns (backwards compat)", () => {
    const id = db.storeMemory({
      raw_text: "authored",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
    });
    const mem = db.getMemory(id);
    expect(mem).not.toBeNull();
    expect(mem!.source_url).toBeNull();
    expect(mem!.fetched_at).toBeNull();
    expect(mem!.refresh_policy).toBeNull();
    expect(mem!.content_hash).toBeNull();
  });

  test("explicit null is preserved", () => {
    const id = db.storeMemory({
      raw_text: "x",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      source_url: null,
      fetched_at: null,
      refresh_policy: null,
      content_hash: null,
    });
    const mem = db.getMemory(id);
    expect(mem!.source_url).toBeNull();
    expect(mem!.refresh_policy).toBeNull();
  });

  test("partial provenance (url only) round-trips with other fields null", () => {
    const id = db.storeMemory({
      raw_text: "x",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      source_url: "https://example.com",
    });
    const mem = db.getMemory(id);
    expect(mem!.source_url).toBe("https://example.com");
    expect(mem!.fetched_at).toBeNull();
    expect(mem!.refresh_policy).toBeNull();
    expect(mem!.content_hash).toBeNull();
  });

  test("migrations are idempotent across reopens", () => {
    const dir = mkdtempSync(join(tmpdir(), "memdb-provenance-"));
    const path = join(dir, "test.db");
    try {
      const db1 = new MemoryDB(path);
      const id = db1.storeMemory({
        raw_text: "hi",
        summary: "s",
        entities: [],
        topics: [],
        importance: 0.5,
        source_url: "https://example.com",
        content_hash: "abc",
      });
      db1.close();
      // Re-open; migration should no-op, existing row should read back intact.
      const db2 = new MemoryDB(path);
      const mem = db2.getMemory(id);
      expect(mem).not.toBeNull();
      expect(mem!.source_url).toBe("https://example.com");
      expect(mem!.content_hash).toBe("abc");
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
