import { Hono } from "hono";
import { MemoryDB } from "./db";
import { MemoryService } from "./memory";
import {
  ORIGINS,
  REFRESH_POLICIES,
  type Origin,
  type ProvenanceInput,
  type RefreshPolicy,
} from "./types";

export interface MemoryServerDeps {
  db: MemoryDB;
  service: MemoryService;
}

/**
 * Build a Hono app that preserves compatibility with the existing
 * rusty-memory-haiku REST surface at http://localhost:19888.
 *
 * The existing skills in ~/.claude/skills hit these paths verbatim,
 * so do not rename them.
 */
export function createMemoryApp(deps: MemoryServerDeps): Hono {
  const app = new Hono();
  const { db, service } = deps;

  app.onError((err, c) => {
    console.error("[memory] server error:", err);
    return c.json({ error: err.message }, 500);
  });

  // GET /query?q=&project=&deep=
  app.get("/query", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (!q) return c.json({ error: "missing ?q= parameter" }, 400);
    const project = c.req.query("project") ?? "";
    const deepParam = (c.req.query("deep") ?? "").toLowerCase();
    const deep = deepParam === "true" || deepParam === "1" || deepParam === "yes";
    const answer = await service.query(q, project, { deep });
    return c.json({ question: q, answer });
  });

  // GET /search?q=&k=&project= — raw top-k vector search results
  // Unlike /query, no LLM synthesis: returns scored memory chunks for
  // callers that want to format their own context (e.g. prompt injection).
  app.get("/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (!q) return c.json({ error: "missing ?q= parameter" }, 400);
    const project = c.req.query("project") ?? "";
    const kRaw = c.req.query("k");
    let k = 5;
    if (kRaw !== undefined) {
      const parsed = Number(kRaw);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 50) {
        return c.json({ error: "invalid 'k'; must be a positive integer <= 50" }, 400);
      }
      k = Math.floor(parsed);
    }
    const scored = await service.searchMemories(q, project, undefined, k);
    const results = scored.map(({ score, distance, memory: m }) => ({
      memory_id: m.id,
      score,
      distance,
      similarity: 1.0 - distance,
      summary: m.summary,
      source: m.source,
      project: m.project,
      importance: m.importance,
      entities: m.entities,
      topics: m.topics,
      created_at: m.created_at,
      source_url: m.source_url,
      origin: m.origin,
    }));
    return c.json({ query: q, k, count: results.length, results });
  });

  // POST /ingest {text, source?, project?, source_url?, fetched_at?, refresh_policy?, content_hash?, origin?}
  app.post("/ingest", async (c) => {
    let data: any;
    try {
      data = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) return c.json({ error: "missing 'text' field" }, 400);
    const source = typeof data.source === "string" ? data.source : "api";
    const project = typeof data.project === "string" ? data.project : "";

    const provenance: ProvenanceInput = {};
    if (typeof data.source_url === "string") provenance.source_url = data.source_url;
    if (typeof data.fetched_at === "string") provenance.fetched_at = data.fetched_at;
    if (typeof data.content_hash === "string") provenance.content_hash = data.content_hash;
    if (data.refresh_policy !== undefined) {
      if (!REFRESH_POLICIES.includes(data.refresh_policy)) {
        return c.json(
          {
            error: `invalid refresh_policy; expected one of: ${REFRESH_POLICIES.join(", ")}`,
          },
          400
        );
      }
      provenance.refresh_policy = data.refresh_policy as RefreshPolicy;
    }
    if (data.origin !== undefined) {
      if (!ORIGINS.includes(data.origin)) {
        return c.json(
          { error: `invalid origin; expected one of: ${ORIGINS.join(", ")}` },
          400
        );
      }
      provenance.origin = data.origin as Origin;
    }

    // Enforcement: external content must declare where it came from and when.
    // Null origin (back-compat) and internal origin both skip this check.
    if (provenance.origin === "external") {
      const missing: string[] = [];
      if (!provenance.source_url) missing.push("source_url");
      if (!provenance.fetched_at) missing.push("fetched_at");
      if (missing.length > 0) {
        return c.json(
          {
            error: `origin='external' requires: ${missing.join(", ")}`,
          },
          400
        );
      }
    }

    const result = await service.ingest(text, source, project, provenance);
    return c.json({ status: "ingested", response: JSON.stringify(result) });
  });

  // POST /consolidate
  app.post("/consolidate", async (c) => {
    const result = await service.consolidate();
    return c.json({ status: "done", response: JSON.stringify(result) });
  });

  // GET /status — stats
  app.get("/status", (c) => {
    return c.json(db.getStats());
  });

  // GET /memories?project=
  app.get("/memories", (c) => {
    const project = c.req.query("project") ?? "";
    const memories = db.readAllMemories(project);
    return c.json({ memories, count: memories.length });
  });

  // POST /delete {memory_id}
  app.post("/delete", async (c) => {
    let data: any;
    try {
      data = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const memoryId = Number(data?.memory_id);
    if (!Number.isFinite(memoryId) || memoryId <= 0) {
      return c.json({ error: "missing 'memory_id' field" }, 400);
    }
    const deleted = db.deleteMemory(memoryId);
    return c.json(
      deleted
        ? { status: "deleted", memory_id: memoryId }
        : { status: "not_found", memory_id: memoryId }
    );
  });

  // POST /clear
  app.post("/clear", (c) => {
    const count = db.clearAll();
    return c.json({ status: "cleared", memories_deleted: count });
  });

  // POST /backfill
  app.post("/backfill", async (c) => {
    const result = await service.backfillEmbeddings();
    return c.json({
      status: "done",
      backfilled: result.embedded, // kept for backward compat
      embedded: result.embedded,
      skipped: result.skipped,
      total: result.total,
    });
  });

  // POST /backfill-origin {origin, default_source?}
  // Idempotent one-shot migration for rows written before memory@0.4.0.
  app.post("/backfill-origin", async (c) => {
    let data: any;
    try {
      data = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (!ORIGINS.includes(data?.origin)) {
      return c.json(
        { error: `missing or invalid 'origin'; expected one of: ${ORIGINS.join(", ")}` },
        400
      );
    }
    const params: { origin: Origin; default_source?: string } = {
      origin: data.origin as Origin,
    };
    if (typeof data.default_source === "string") {
      params.default_source = data.default_source;
    }
    const result = db.backfillOrigin(params);
    return c.json({ status: "done", updated: result.updated });
  });

  // GET /graph?entity=&project=
  app.get("/graph", (c) => {
    const entity = (c.req.query("entity") ?? "").trim();
    if (!entity) return c.json({ error: "missing ?entity= parameter" }, 400);
    const project = c.req.query("project") ?? "";
    const graph = db.getEntityGraph(entity, project);
    if (!graph) return c.json({ error: "entity not found" }, 404);
    return c.json(graph);
  });

  // GET /entities?type=&project=
  app.get("/entities", (c) => {
    const type = c.req.query("type") ?? "";
    const project = c.req.query("project") ?? "";
    const entities = db.listEntities(type, project);
    return c.json({ entities, count: entities.length });
  });

  return app;
}
