import { Hono } from "hono";
import { MemoryDB } from "./db";
import { MemoryService } from "./memory";

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

  // GET /query?q=&project=&deep= — deep mode currently ignored (P1).
  app.get("/query", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (!q) return c.json({ error: "missing ?q= parameter" }, 400);
    const project = c.req.query("project") ?? "";
    const answer = await service.query(q, project);
    return c.json({ question: q, answer });
  });

  // POST /ingest {text, source?, project?}
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
    const result = await service.ingest(text, source, project);
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
    const count = await service.backfillEmbeddings();
    return c.json({ status: "done", backfilled: count });
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
