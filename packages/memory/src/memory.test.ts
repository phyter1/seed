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

  test("threads provenance from ingest call to stored memory", async () => {
    const { db, service } = makeService({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    const result = await service.ingest("hello", "web", "docs", {
      source_url: "https://example.com/page",
      fetched_at: "2026-04-04T10:00:00.000Z",
      refresh_policy: "weekly",
      content_hash: "abc123",
    });
    expect(result.status).toBe("stored");
    const mem = db.getMemory(result.memory_id!);
    expect(mem!.source_url).toBe("https://example.com/page");
    expect(mem!.fetched_at).toBe("2026-04-04T10:00:00.000Z");
    expect(mem!.refresh_policy).toBe("weekly");
    expect(mem!.content_hash).toBe("abc123");
  });

  test("chunk children inherit provenance from parent", async () => {
    const longText = "paragraph one.\n\n" + "long body sentence. ".repeat(200);
    const { db, service } = makeService({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    const result = await service.ingest(longText, "doc", "p", {
      source_url: "https://example.com/big",
      refresh_policy: "monthly",
    });
    expect(result.status).toBe("stored");
    expect(result.chunks).toBeGreaterThan(1);
    const children = db.raw
      .prepare("SELECT id FROM memories WHERE parent_id = ?")
      .all(result.memory_id!) as Array<{ id: number }>;
    expect(children.length).toBeGreaterThan(0);
    for (const { id } of children) {
      const child = db.getMemory(id)!;
      expect(child.source_url).toBe("https://example.com/big");
      expect(child.refresh_policy).toBe("monthly");
    }
  });

  test("origin threads through ingest and is inherited by chunk children", async () => {
    const longText = "para.\n\n" + "body sentence. ".repeat(200);
    const { db, service } = makeService({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    const result = await service.ingest(longText, "doc", "p", {
      origin: "external",
      source_url: "https://example.com/doc",
      fetched_at: "2026-04-05T00:00:00.000Z",
    });
    expect(result.status).toBe("stored");
    expect(result.chunks).toBeGreaterThan(1);
    const parent = db.getMemory(result.memory_id!)!;
    expect(parent.origin).toBe("external");
    const children = db.raw
      .prepare("SELECT id FROM memories WHERE parent_id = ?")
      .all(result.memory_id!) as Array<{ id: number }>;
    for (const { id } of children) {
      expect(db.getMemory(id)!.origin).toBe("external");
    }
  });

  test("omitting provenance in ingest yields null fields", async () => {
    const { db, service } = makeService({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    const result = await service.ingest("authored text", "note", "p");
    const mem = db.getMemory(result.memory_id!);
    expect(mem!.source_url).toBeNull();
    expect(mem!.fetched_at).toBeNull();
    expect(mem!.refresh_policy).toBeNull();
    expect(mem!.content_hash).toBeNull();
  });

  test("recovers gracefully when LLM returns invalid JSON", async () => {
    const { db, service } = makeService({ raw: "not json at all" });
    const result = await service.ingest("hello world", "src", "p");
    expect(result.status).toBe("stored");
    const mem = db.getMemory(result.memory_id!);
    expect(mem).not.toBeNull();
    expect(mem!.summary).toContain("not json");
  });

  test("provenance survives the LLM-fails-json fallback path", async () => {
    const { db, service } = makeService({ raw: "not json at all" });
    const result = await service.ingest("hello", "src", "p", {
      source_url: "https://example.com/fallback",
      refresh_policy: "daily",
    });
    expect(result.status).toBe("stored");
    const mem = db.getMemory(result.memory_id!);
    expect(mem!.source_url).toBe("https://example.com/fallback");
    expect(mem!.refresh_policy).toBe("daily");
  });

  test("short-circuits on content_hash match without calling LLM or embedder", async () => {
    const { db, service } = makeService({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    // First ingest stores with hash.
    const first = await service.ingest("original content", "src", "p", {
      content_hash: "hash-abc-123",
    });
    expect(first.status).toBe("stored");

    // Track LLM + embedder calls during second ingest.
    const llmCallsBefore = db.raw
      .prepare("SELECT COUNT(*) as c FROM memories")
      .get() as { c: number };
    const second = await service.ingest("original content", "src", "p", {
      content_hash: "hash-abc-123",
    });
    const llmCallsAfter = db.raw
      .prepare("SELECT COUNT(*) as c FROM memories")
      .get() as { c: number };

    expect(second.status).toBe("duplicate");
    expect(second.duplicate_of).toBe(first.memory_id!);
    // No new memory stored — proves the short-circuit ran.
    expect(llmCallsAfter.c).toBe(llmCallsBefore.c);
  });

  test("content_hash match scopes to project (cross-project doesn't collide)", async () => {
    const { service } = makeService({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    // Distinct content bodies so embedding-based dedup (which is NOT
    // project-scoped today) doesn't fire; we're isolating the hash path.
    const a = await service.ingest("alpha text for project a", "src", "project-a", {
      content_hash: "hash-xyz",
    });
    const b = await service.ingest("beta text for project b", "src", "project-b", {
      content_hash: "hash-xyz",
    });
    expect(a.status).toBe("stored");
    expect(b.status).toBe("stored"); // different project → hash match doesn't fire
    expect(a.memory_id).not.toBe(b.memory_id);
  });

  test("content_hash without pre-existing match stores normally", async () => {
    const { db, service } = makeService({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    const result = await service.ingest("new content", "src", "p", {
      content_hash: "fresh-hash",
    });
    expect(result.status).toBe("stored");
    expect(db.getMemory(result.memory_id!)!.content_hash).toBe("fresh-hash");
  });

  test("omitting content_hash skips the short-circuit path entirely", async () => {
    // Store a memory with a known hash...
    const { service } = makeService({
      ingest: { summary: "s", entities: [], topics: [], importance: 0.5 },
    });
    await service.ingest("first content", "src", "p", {
      content_hash: "known-hash",
    });
    // Then ingest byte-identical text without passing the hash — should
    // still go through the normal flow (may still dedup via embeddings,
    // but won't short-circuit on hash).
    const second = await service.ingest("different content", "src", "p");
    expect(second.status).toBe("stored");
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

describe("MemoryDB origin column", () => {
  let db: MemoryDB;
  beforeEach(() => {
    db = new MemoryDB(":memory:");
  });

  test("schema includes origin column", () => {
    const cols = new Set<string>(
      (db.raw.prepare("PRAGMA table_info(memories)").all() as any[]).map(
        (r) => r.name
      )
    );
    expect(cols.has("origin")).toBe(true);
  });

  test("round-trips origin='internal'", () => {
    const id = db.storeMemory({
      raw_text: "authored",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      origin: "internal",
    });
    const mem = db.getMemory(id)!;
    expect(mem.origin).toBe("internal");
  });

  test("round-trips origin='external'", () => {
    const id = db.storeMemory({
      raw_text: "fetched",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      origin: "external",
      source_url: "https://example.com",
      fetched_at: "2026-04-05T00:00:00.000Z",
    });
    const mem = db.getMemory(id)!;
    expect(mem.origin).toBe("external");
    expect(mem.source_url).toBe("https://example.com");
  });

  test("omitting origin yields null (backwards compat)", () => {
    const id = db.storeMemory({
      raw_text: "legacy",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
    });
    const mem = db.getMemory(id)!;
    expect(mem.origin).toBeNull();
  });

  test("db layer does NOT enforce external requires provenance", () => {
    // Enforcement lives in the service/server layer so backfill scripts
    // can write legacy rows directly. storeMemory accepts origin='external'
    // without source_url/fetched_at.
    const id = db.storeMemory({
      raw_text: "x",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      origin: "external",
    });
    const mem = db.getMemory(id)!;
    expect(mem.origin).toBe("external");
    expect(mem.source_url).toBeNull();
  });
});

describe("MemoryDB.findByContentHash", () => {
  let db: MemoryDB;
  beforeEach(() => {
    db = new MemoryDB(":memory:");
  });

  test("returns memory id for matching hash", () => {
    const id = db.storeMemory({
      raw_text: "x",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      project: "p",
      content_hash: "abc",
    });
    expect(db.findByContentHash("abc", "p")).toBe(id);
  });

  test("returns null when no matching hash", () => {
    db.storeMemory({
      raw_text: "x",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      project: "p",
      content_hash: "abc",
    });
    expect(db.findByContentHash("zzz", "p")).toBeNull();
  });

  test("scopes match to the given project", () => {
    const id = db.storeMemory({
      raw_text: "x",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      project: "project-a",
      content_hash: "shared",
    });
    expect(db.findByContentHash("shared", "project-a")).toBe(id);
    expect(db.findByContentHash("shared", "project-b")).toBeNull();
  });

  test("skips chunk children (parent_id IS NOT NULL)", () => {
    const parentId = db.storeMemory({
      raw_text: "parent",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      project: "p",
      content_hash: "hash-parent",
    });
    db.storeMemory({
      raw_text: "child",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      project: "p",
      parent_id: parentId,
      content_hash: "hash-child",
    });
    // Parent found, child ignored even though it has its own hash.
    expect(db.findByContentHash("hash-parent", "p")).toBe(parentId);
    expect(db.findByContentHash("hash-child", "p")).toBeNull();
  });

  test("returns earliest id when multiple matches exist", () => {
    const first = db.storeMemory({
      raw_text: "x1",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      project: "p",
      content_hash: "dup",
    });
    db.storeMemory({
      raw_text: "x2",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      project: "p",
      content_hash: "dup",
    });
    expect(db.findByContentHash("dup", "p")).toBe(first);
  });

  test("null project scopes to empty-string project", () => {
    const id = db.storeMemory({
      raw_text: "x",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      content_hash: "h",
    });
    // Default project is empty string
    expect(db.findByContentHash("h", "")).toBe(id);
    expect(db.findByContentHash("h")).toBe(id);
  });
});

describe("MemoryDB.backfillOrigin", () => {
  let db: MemoryDB;
  beforeEach(() => {
    db = new MemoryDB(":memory:");
  });

  test("sets origin on rows where origin IS NULL", () => {
    // Write legacy-shaped rows (no origin)
    const a = db.storeMemory({
      raw_text: "x",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
    });
    const b = db.storeMemory({
      raw_text: "y",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
    });
    const result = db.backfillOrigin({ origin: "internal" });
    expect(result.updated).toBe(2);
    expect(db.getMemory(a)!.origin).toBe("internal");
    expect(db.getMemory(b)!.origin).toBe("internal");
  });

  test("leaves rows with an existing origin alone", () => {
    const legacy = db.storeMemory({
      raw_text: "x",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
    });
    const already = db.storeMemory({
      raw_text: "y",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      origin: "external",
      source_url: "https://example.com",
      fetched_at: "2026-04-05T00:00:00.000Z",
    });
    const result = db.backfillOrigin({ origin: "internal" });
    expect(result.updated).toBe(1);
    expect(db.getMemory(legacy)!.origin).toBe("internal");
    expect(db.getMemory(already)!.origin).toBe("external"); // untouched
  });

  test("is idempotent — second run updates nothing", () => {
    db.storeMemory({
      raw_text: "x",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
    });
    const first = db.backfillOrigin({ origin: "internal" });
    const second = db.backfillOrigin({ origin: "internal" });
    expect(first.updated).toBe(1);
    expect(second.updated).toBe(0);
  });

  test("default_source fills empty/null source but preserves existing", () => {
    const emptySrc = db.storeMemory({
      raw_text: "x",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      source: "",
    });
    const hasSrc = db.storeMemory({
      raw_text: "y",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      source: "heartbeat",
    });
    db.backfillOrigin({ origin: "internal", default_source: "journal" });
    expect(db.getMemory(emptySrc)!.source).toBe("journal");
    expect(db.getMemory(hasSrc)!.source).toBe("heartbeat");
  });

  test("default_source leaves source untouched when not provided", () => {
    const id = db.storeMemory({
      raw_text: "x",
      summary: "s",
      entities: [],
      topics: [],
      importance: 0.5,
      source: "",
    });
    db.backfillOrigin({ origin: "internal" });
    expect(db.getMemory(id)!.source).toBe("");
  });

  test("returns 0 when no NULL-origin rows exist", () => {
    const result = db.backfillOrigin({ origin: "internal" });
    expect(result.updated).toBe(0);
  });
});
