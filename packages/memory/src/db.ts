import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { existsSync } from "node:fs";

function resolveSystemSqlite(): string | null {
  const env = process.env.SEED_SQLITE_PATH;
  if (env && existsSync(env)) return env;
  const candidates = [
    "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // Apple Silicon Homebrew
    "/usr/local/opt/sqlite/lib/libsqlite3.dylib", // Intel Homebrew
    "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0", // Debian/Ubuntu
    "/usr/lib/aarch64-linux-gnu/libsqlite3.so.0", // ARM Debian/Ubuntu
    "/usr/lib64/libsqlite3.so.0", // RHEL/Fedora
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
import type {
  Memory,
  Entity,
  EntityGraph,
  MemoryStats,
  Origin,
  RefreshPolicy,
} from "./types";

/**
 * MemoryDB — bun:sqlite wrapper around the existing Rusty Memory Haiku schema.
 *
 * The schema here is intentionally identical to the Python version so the
 * existing memory.db file (with ~6 months of accumulated 384-dim embeddings)
 * can be opened without migration. Do not "improve" it during the port.
 */
/**
 * Embedding dimension for the vec_memories table. Must match the
 * output dimension of whatever embedder the MemoryService is wired
 * to. qwen3-embedding:0.6b returns 1024 floats. The original Rusty
 * Memory Haiku used all-MiniLM-L6-v2 (384 floats).
 *
 * Override via the MEMORY_EMBED_DIM env var if the deployment uses
 * a different model.
 */
export const DEFAULT_EMBED_DIM = Number(
  process.env.MEMORY_EMBED_DIM ?? "1024"
);

export class MemoryDB {
  private db: Database;
  public readonly hasVec: boolean;
  public readonly embedDim: number;

  constructor(path: string = "memory.db", embedDim: number = DEFAULT_EMBED_DIM) {
    this.embedDim = embedDim;
    // Bun's embedded sqlite lacks extension loading. Use a system sqlite if
    // one is available so sqlite-vec can load. SEED_SQLITE_PATH overrides.
    const customSqlite = resolveSystemSqlite();
    if (customSqlite) {
      try {
        Database.setCustomSQLite(customSqlite);
      } catch {
        // Already set in this process — safe to ignore.
      }
    }

    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");

    // Load sqlite-vec extension. Prefer an explicit path (for compiled
    // binaries that ship vec0 alongside the executable), then fall back
    // to the node-resolvable path inside node_modules.
    let hasVec = false;
    const explicitVec = process.env.SEED_VEC_PATH;
    try {
      if (explicitVec) {
        this.db.loadExtension(explicitVec);
      } else {
        sqliteVec.load(this.db);
      }
      hasVec = true;
    } catch (err) {
      console.warn(`[memory] sqlite-vec not available: ${err}. Vector search disabled.`);
      hasVec = false;
    }
    this.hasVec = hasVec;

    this.migrate();
  }

  get raw(): Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL DEFAULT '',
        raw_text TEXT NOT NULL,
        summary TEXT NOT NULL,
        entities TEXT NOT NULL DEFAULT '[]',
        topics TEXT NOT NULL DEFAULT '[]',
        connections TEXT NOT NULL DEFAULT '[]',
        importance REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        consolidated INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS consolidations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_ids TEXT NOT NULL,
        summary TEXT NOT NULL,
        insight TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS processed_files (
        path TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT '',
        project TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_entity_id INTEGER NOT NULL,
        target_entity_id INTEGER NOT NULL,
        relation_type TEXT NOT NULL,
        memory_id INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_entity_id) REFERENCES entities(id),
        FOREIGN KEY (target_entity_id) REFERENCES entities(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_name_type_project
        ON entities(name COLLATE NOCASE, type, project);
      CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_entity_id);
      CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_entity_id);
    `);

    // Idempotent column migrations (match the Python version)
    const memoriesCols = new Set<string>(
      (this.db.prepare("PRAGMA table_info(memories)").all() as any[]).map((r) => r.name)
    );
    if (!memoriesCols.has("project")) {
      this.db.exec("ALTER TABLE memories ADD COLUMN project TEXT NOT NULL DEFAULT ''");
    }
    if (!memoriesCols.has("access_count")) {
      this.db.exec("ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0");
    }
    if (!memoriesCols.has("last_accessed")) {
      this.db.exec("ALTER TABLE memories ADD COLUMN last_accessed TEXT NOT NULL DEFAULT ''");
    }
    if (!memoriesCols.has("parent_id")) {
      this.db.exec("ALTER TABLE memories ADD COLUMN parent_id INTEGER DEFAULT NULL");
    }
    // Provenance columns — added in memory@0.3.0. All nullable; existing
    // rows stay null until re-ingested or backfilled.
    if (!memoriesCols.has("source_url")) {
      this.db.exec("ALTER TABLE memories ADD COLUMN source_url TEXT DEFAULT NULL");
    }
    if (!memoriesCols.has("fetched_at")) {
      this.db.exec("ALTER TABLE memories ADD COLUMN fetched_at TEXT DEFAULT NULL");
    }
    if (!memoriesCols.has("refresh_policy")) {
      this.db.exec("ALTER TABLE memories ADD COLUMN refresh_policy TEXT DEFAULT NULL");
    }
    if (!memoriesCols.has("content_hash")) {
      this.db.exec("ALTER TABLE memories ADD COLUMN content_hash TEXT DEFAULT NULL");
    }
    // Origin column — added in memory@0.4.0. Nullable; existing rows stay
    // null until backfilled. Enforcement (origin='external' requires
    // source_url + fetched_at) lives in the service/server layer, not
    // the DB, so callers can still store legacy rows directly for
    // backfill migrations.
    if (!memoriesCols.has("origin")) {
      this.db.exec("ALTER TABLE memories ADD COLUMN origin TEXT DEFAULT NULL");
    }

    if (this.hasVec) {
      this.ensureVecTable();
    }
  }

  /**
   * Create or re-create the vec_memories virtual table at the
   * configured embedding dimension. If an existing table uses a
   * different dim, it's dropped — callers should run backfill
   * afterward to re-populate embeddings with the new model.
   */
  private ensureVecTable(): void {
    try {
      // Inspect existing table dim, if present.
      const existingDim = this.detectVecDim();
      if (existingDim !== null && existingDim !== this.embedDim) {
        console.warn(
          `[memory] vec_memories dim ${existingDim} ≠ configured ${this.embedDim}; ` +
            `dropping table — run /backfill to re-embed.`
        );
        this.db.exec("DROP TABLE IF EXISTS vec_memories");
      }
      this.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories
         USING vec0(memory_id INTEGER PRIMARY KEY, embedding float[${this.embedDim}] distance_metric=cosine)`
      );
    } catch (err) {
      console.warn(`[memory] Could not create vec_memories table: ${err}`);
    }
  }

  /**
   * Read the embedding dimension from the existing vec_memories
   * table. Returns null if the table doesn't exist or the dim can't
   * be parsed. sqlite_master stores the CREATE statement verbatim,
   * so we grep it for the `float[N]` declaration.
   */
  private detectVecDim(): number | null {
    const row = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vec_memories'")
      .get() as { sql?: string } | undefined;
    if (!row?.sql) return null;
    const m = /float\[(\d+)\]/.exec(row.sql);
    return m ? parseInt(m[1], 10) : null;
  }

  // --- Serialization helpers ---

  static serializeFloat32(vec: number[]): Buffer {
    const buf = Buffer.alloc(vec.length * 4);
    for (let i = 0; i < vec.length; i++) {
      buf.writeFloatLE(vec[i]!, i * 4);
    }
    return buf;
  }

  // --- Memory ops ---

  private rowToMemory(row: any): Memory {
    const parseJson = <T>(v: unknown, fallback: T): T => {
      if (v == null) return fallback;
      if (typeof v !== "string") return v as T;
      try {
        return JSON.parse(v);
      } catch {
        return fallback;
      }
    };
    return {
      id: row.id,
      source: row.source ?? "",
      summary: row.summary ?? "",
      raw_text: row.raw_text ?? "",
      entities: parseJson(row.entities, []),
      topics: parseJson(row.topics, []),
      importance: row.importance ?? 0.5,
      connections: parseJson(row.connections, []),
      created_at: row.created_at,
      consolidated: !!row.consolidated,
      project: row.project ?? "",
      access_count: row.access_count ?? 0,
      last_accessed: row.last_accessed ?? "",
      parent_id: row.parent_id ?? null,
      source_url: row.source_url ?? null,
      fetched_at: row.fetched_at ?? null,
      refresh_policy: (row.refresh_policy ?? null) as RefreshPolicy | null,
      content_hash: row.content_hash ?? null,
      origin: (row.origin ?? null) as Origin | null,
    };
  }

  storeMemory(params: {
    raw_text: string;
    summary: string;
    entities: string[];
    topics: string[];
    importance: number;
    source?: string;
    project?: string;
    embedding?: number[] | null;
    parent_id?: number | null;
    source_url?: string | null;
    fetched_at?: string | null;
    refresh_policy?: RefreshPolicy | null;
    content_hash?: string | null;
    origin?: Origin | null;
  }): number {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO memories (source, raw_text, summary, entities, topics, importance, created_at, project, parent_id, source_url, fetched_at, refresh_policy, content_hash, origin)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          params.source ?? "",
          params.raw_text,
          params.summary,
          JSON.stringify(params.entities),
          JSON.stringify(params.topics),
          params.importance,
          now,
          params.project ?? "",
          params.parent_id ?? null,
          params.source_url ?? null,
          params.fetched_at ?? null,
          params.refresh_policy ?? null,
          params.content_hash ?? null,
          params.origin ?? null
        );
      const row = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
      return row.id;
    });
    const mid = tx();

    if (this.hasVec && params.embedding) {
      const result = this.safeInsertEmbedding(mid, params.embedding);
      if (!result.ok) {
        console.warn(`[memory] vec insert after store mid=${mid} skipped: ${result.reason}`);
      }
    }
    return mid;
  }

  getMemory(id: number): Memory | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as any;
    return row ? this.rowToMemory(row) : null;
  }

  readAllMemories(project: string = "", limit: number = 50): Memory[] {
    const rows = project
      ? (this.db
          .prepare(
            "SELECT * FROM memories WHERE project = ? OR project = '' ORDER BY created_at DESC LIMIT ?"
          )
          .all(project, limit) as any[])
      : (this.db
          .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT ?")
          .all(limit) as any[]);
    return rows.map((r) => this.rowToMemory(r));
  }

  readUnconsolidated(limit: number = 10): Memory[] {
    const rows = this.db
      .prepare("SELECT * FROM memories WHERE consolidated = 0 ORDER BY created_at DESC LIMIT ?")
      .all(limit) as any[];
    return rows.map((r) => this.rowToMemory(r));
  }

  deleteMemory(id: number): boolean {
    const existing = this.db.prepare("SELECT 1 FROM memories WHERE id = ?").get(id);
    if (!existing) return false;
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
      if (this.hasVec) {
        try {
          this.db.prepare("DELETE FROM vec_memories WHERE memory_id = ?").run(id);
        } catch {}
      }
    });
    tx();
    return true;
  }

  clearAll(): number {
    const memCount = (this.db.prepare("SELECT COUNT(*) as c FROM memories").get() as any).c as number;
    const tx = this.db.transaction(() => {
      this.db.exec("DELETE FROM memories");
      this.db.exec("DELETE FROM consolidations");
      this.db.exec("DELETE FROM processed_files");
      this.db.exec("DELETE FROM relationships");
      this.db.exec("DELETE FROM entities");
      if (this.hasVec) {
        try {
          this.db.exec("DELETE FROM vec_memories");
        } catch {}
      }
    });
    tx();
    return memCount;
  }

  // --- Dedup / vector search ---

  /**
   * Find a memory with the given content_hash in the given project.
   * Returns the earliest-inserted matching memory_id, or null if none.
   * Cheap indexed lookup — callers with a caller-supplied hash can use
   * this to short-circuit ingest before spending LLM + embedding cycles
   * on byte-identical content. Only returns top-level memories (not
   * chunk children) so re-ingesting a long doc matches the parent.
   */
  findByContentHash(hash: string, project: string = ""): number | null {
    const row = this.db
      .prepare(
        `SELECT id FROM memories
         WHERE content_hash = ? AND project = ? AND parent_id IS NULL
         ORDER BY id ASC LIMIT 1`
      )
      .get(hash, project) as { id: number } | undefined;
    return row?.id ?? null;
  }

  /**
   * Backfill origin on existing rows where it is NULL. Idempotent —
   * only touches rows with `origin IS NULL`, so repeated runs are
   * no-ops after the first. Optionally sets `source` to a default
   * value for rows where source is empty or NULL (leaves rows with
   * an explicit source alone).
   *
   * Used to one-shot migrate memories written before memory@0.4.0
   * (which added the origin column) to a known origin value — for
   * the ren1 deployment this is {origin: 'internal', default_source:
   * 'journal'} per the extraction plan.
   */
  backfillOrigin(params: {
    origin: Origin;
    default_source?: string;
  }): { updated: number } {
    const { origin, default_source } = params;
    if (default_source !== undefined) {
      const result = this.db
        .prepare(
          `UPDATE memories
           SET origin = ?,
               source = CASE WHEN source IS NULL OR source = '' THEN ? ELSE source END
           WHERE origin IS NULL`
        )
        .run(origin, default_source);
      return { updated: Number(result.changes) };
    }
    const result = this.db
      .prepare(`UPDATE memories SET origin = ? WHERE origin IS NULL`)
      .run(origin);
    return { updated: Number(result.changes) };
  }

  checkDuplicate(
    embedding: number[],
    threshold: number
  ): { isDup: boolean; existingId: number | null; similarity: number } {
    if (!this.hasVec) return { isDup: false, existingId: null, similarity: 0 };
    try {
      const rows = this.db
        .prepare(
          "SELECT memory_id, distance FROM vec_memories WHERE embedding MATCH ? AND k = 3 ORDER BY distance"
        )
        .all(MemoryDB.serializeFloat32(embedding)) as Array<{ memory_id: number; distance: number }>;
      for (const r of rows) {
        const sim = 1.0 - r.distance;
        if (sim >= threshold) {
          return { isDup: true, existingId: r.memory_id, similarity: sim };
        }
      }
    } catch (err) {
      console.warn(`[memory] dedup check failed: ${err}`);
    }
    return { isDup: false, existingId: null, similarity: 0 };
  }

  knnSearch(embedding: number[], k: number = 10): Array<{ memory_id: number; distance: number }> {
    if (!this.hasVec) return [];
    try {
      return this.db
        .prepare(
          "SELECT memory_id, distance FROM vec_memories WHERE embedding MATCH ? AND k = ? ORDER BY distance"
        )
        .all(MemoryDB.serializeFloat32(embedding), k) as Array<{
        memory_id: number;
        distance: number;
      }>;
    } catch (err) {
      console.warn(`[memory] knn failed: ${err}`);
      return [];
    }
  }

  getMemoriesByIds(ids: number[]): Memory[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE id IN (${placeholders})`)
      .all(...ids) as any[];
    return rows.map((r) => this.rowToMemory(r));
  }

  touchAccess(id: number): void {
    this.db
      .prepare(
        "UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?"
      )
      .run(new Date().toISOString(), id);
  }

  hasEmbedding(memoryId: number): boolean {
    if (!this.hasVec) return false;
    const row = this.db
      .prepare("SELECT 1 FROM vec_memories WHERE memory_id = ?")
      .get(memoryId);
    return !!row;
  }

  insertEmbedding(memoryId: number, embedding: number[]): void {
    if (!this.hasVec) return;
    this.db
      .prepare("INSERT INTO vec_memories (memory_id, embedding) VALUES (?, ?)")
      .run(memoryId, MemoryDB.serializeFloat32(embedding));
  }

  /**
   * Insert an embedding into vec_memories, classifying any failure into
   * a discrete reason instead of throwing. Non-pk_conflict failures are
   * logged at warn level with the memory_id so operators can investigate.
   *
   * Exists as a single handler to replace the call-site try/catch
   * fan-out that accumulated while chasing the vec0 LEFT JOIN / INSERT
   * PK disagreement in backfill paths. Having all vec inserts flow
   * through one place means: (a) the policy lives in one location;
   * (b) skipped rows are classified, not silently swallowed; and
   * (c) non-PK errors (dim mismatch, zero-length, NaN) surface in
   * logs instead of hiding behind a bare catch.
   */
  safeInsertEmbedding(
    memoryId: number,
    embedding: number[]
  ): InsertEmbeddingResult {
    if (!this.hasVec) {
      return { ok: false, reason: "no_vec_extension", error: "vec extension not loaded" };
    }
    try {
      this.db
        .prepare("INSERT INTO vec_memories (memory_id, embedding) VALUES (?, ?)")
        .run(memoryId, MemoryDB.serializeFloat32(embedding));
      return { ok: true };
    } catch (err: any) {
      const message = err?.message ?? String(err);
      const reason = classifyEmbeddingInsertError(message);
      if (reason !== "pk_conflict") {
        console.warn(
          `[memory] vec insert skipped memory_id=${memoryId} reason=${reason}: ${message}`
        );
      }
      return { ok: false, reason, error: message };
    }
  }

  memoriesMissingEmbeddings(): Array<{
    id: number;
    summary: string;
    raw_text: string;
    parent_id: number | null;
    source: string;
    entities: string;
    topics: string;
    importance: number;
    project: string;
    source_url: string | null;
    fetched_at: string | null;
    refresh_policy: string | null;
    content_hash: string | null;
    origin: string | null;
  }> {
    if (!this.hasVec) return [];
    return this.db
      .prepare(
        `SELECT m.id, m.summary, m.raw_text, m.parent_id, m.source, m.entities,
                m.topics, m.importance, m.project,
                m.source_url, m.fetched_at, m.refresh_policy, m.content_hash, m.origin
         FROM memories m
         LEFT JOIN vec_memories v ON m.id = v.memory_id
         WHERE v.memory_id IS NULL AND m.parent_id IS NULL`
      )
      .all() as any[];
  }

  /**
   * Child chunk rows (parent_id IS NOT NULL) that have no entry in
   * vec_memories. These exist when chunk rows were written by an
   * earlier memory service version that didn't commit embeddings to
   * the vec table. The top-level /backfill path only touches parent
   * rows, so chunks in this state are stranded until this method
   * surfaces them.
   */
  chunksMissingEmbeddings(): Array<{
    id: number;
    summary: string;
    raw_text: string;
  }> {
    if (!this.hasVec) return [];
    return this.db
      .prepare(
        `SELECT m.id, m.summary, m.raw_text
         FROM memories m
         LEFT JOIN vec_memories v ON m.id = v.memory_id
         WHERE v.memory_id IS NULL AND m.parent_id IS NOT NULL`
      )
      .all() as any[];
  }

  hasChildren(parentId: number): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM memories WHERE parent_id = ?")
      .get(parentId);
    return !!row;
  }

  // --- Consolidations ---

  storeConsolidation(params: {
    source_ids: number[];
    summary: string;
    insight: string;
    connections: Array<{ from_id?: number; to_id?: number; relationship?: string }>;
  }): void {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO consolidations (source_ids, summary, insight, created_at) VALUES (?, ?, ?, ?)"
        )
        .run(JSON.stringify(params.source_ids), params.summary, params.insight, now);

      for (const conn of params.connections) {
        const fromId = conn.from_id;
        const toId = conn.to_id;
        const rel = conn.relationship ?? "";
        if (!fromId || !toId) continue;
        for (const mid of [fromId, toId]) {
          const row = this.db
            .prepare("SELECT connections FROM memories WHERE id = ?")
            .get(mid) as any;
          if (row) {
            const existing = JSON.parse(row.connections || "[]");
            existing.push({
              linked_to: mid === fromId ? toId : fromId,
              relationship: rel,
            });
            this.db
              .prepare("UPDATE memories SET connections = ? WHERE id = ?")
              .run(JSON.stringify(existing), mid);
          }
        }
      }

      if (params.source_ids.length > 0) {
        const placeholders = params.source_ids.map(() => "?").join(",");
        this.db
          .prepare(`UPDATE memories SET consolidated = 1 WHERE id IN (${placeholders})`)
          .run(...params.source_ids);
      }
    });
    tx();
  }

  readConsolidations(
    limit: number = 10
  ): Array<{ summary: string; insight: string; source_ids: string }> {
    return this.db
      .prepare(
        "SELECT summary, insight, source_ids FROM consolidations ORDER BY created_at DESC LIMIT ?"
      )
      .all(limit) as any[];
  }

  // --- Stats ---

  getStats(): MemoryStats {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM memories").get() as any).c;
    const unconsolidated = (
      this.db.prepare("SELECT COUNT(*) as c FROM memories WHERE consolidated = 0").get() as any
    ).c;
    const consolidations = (
      this.db.prepare("SELECT COUNT(*) as c FROM consolidations").get() as any
    ).c;

    const stats: MemoryStats = {
      total_memories: total,
      unconsolidated,
      consolidations,
      vector_search: this.hasVec,
      projects: [],
      total_entities: 0,
      total_relationships: 0,
    };

    if (this.hasVec) {
      try {
        const row = this.db.prepare("SELECT COUNT(*) as c FROM vec_memories").get() as any;
        stats.embedded_memories = row?.c ?? 0;
      } catch {
        stats.embedded_memories = 0;
      }
    }

    const projects = this.db
      .prepare("SELECT DISTINCT project FROM memories WHERE project != ''")
      .all() as Array<{ project: string }>;
    stats.projects = projects.map((r) => r.project);

    stats.total_entities = (this.db.prepare("SELECT COUNT(*) as c FROM entities").get() as any).c;
    stats.total_relationships = (
      this.db.prepare("SELECT COUNT(*) as c FROM relationships").get() as any
    ).c;
    return stats;
  }

  // --- Knowledge graph ---

  upsertEntity(name: string, entityType: string = "", project: string = ""): number {
    const existing = this.db
      .prepare(
        "SELECT id FROM entities WHERE name = ? COLLATE NOCASE AND type = ? AND project = ?"
      )
      .get(name, entityType, project) as any;
    if (existing) return existing.id;
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO entities (name, type, project, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(name, entityType, project, now);
    return (this.db.prepare("SELECT last_insert_rowid() as id").get() as any).id;
  }

  storeRelationship(
    sourceId: number,
    targetId: number,
    relationType: string,
    memoryId: number | null = null
  ): number {
    const existing = this.db
      .prepare(
        "SELECT id FROM relationships WHERE source_entity_id = ? AND target_entity_id = ? AND relation_type = ?"
      )
      .get(sourceId, targetId, relationType) as any;
    if (existing) return existing.id;
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO relationships (source_entity_id, target_entity_id, relation_type, memory_id, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(sourceId, targetId, relationType, memoryId, now);
    return (this.db.prepare("SELECT last_insert_rowid() as id").get() as any).id;
  }

  getEntityGraph(entityName: string, project: string = ""): EntityGraph | null {
    const entity = (
      project
        ? this.db
            .prepare(
              "SELECT * FROM entities WHERE name = ? COLLATE NOCASE AND (project = ? OR project = '')"
            )
            .get(entityName, project)
        : this.db
            .prepare("SELECT * FROM entities WHERE name = ? COLLATE NOCASE")
            .get(entityName)
    ) as Entity | undefined;
    if (!entity) return null;

    const outgoing = this.db
      .prepare(
        `SELECT r.*, e.name as target_name, e.type as target_type
         FROM relationships r JOIN entities e ON r.target_entity_id = e.id
         WHERE r.source_entity_id = ?`
      )
      .all(entity.id) as any[];
    const incoming = this.db
      .prepare(
        `SELECT r.*, e.name as source_name, e.type as source_type
         FROM relationships r JOIN entities e ON r.source_entity_id = e.id
         WHERE r.target_entity_id = ?`
      )
      .all(entity.id) as any[];

    const relationships: EntityGraph["relationships"] = [];
    for (const r of outgoing) {
      relationships.push({
        direction: "outgoing",
        relation: r.relation_type,
        entity: r.target_name,
        entity_type: r.target_type,
        memory_id: r.memory_id,
      });
    }
    for (const r of incoming) {
      relationships.push({
        direction: "incoming",
        relation: r.relation_type,
        entity: r.source_name,
        entity_type: r.source_type,
        memory_id: r.memory_id,
      });
    }

    return {
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        project: entity.project,
      },
      relationships,
    };
  }

  listEntities(entityType: string = "", project: string = ""): Entity[] {
    let sql = "SELECT * FROM entities WHERE 1=1";
    const params: any[] = [];
    if (entityType) {
      sql += " AND type = ?";
      params.push(entityType);
    }
    if (project) {
      sql += " AND (project = ? OR project = '')";
      params.push(project);
    }
    sql += " ORDER BY name";
    return this.db.prepare(sql).all(...params) as Entity[];
  }
}

// --- Embedding insert classification ---------------------------------

/**
 * Discrete reasons a `safeInsertEmbedding` call can be skipped instead
 * of succeeding. Each corresponds to a known failure mode of either
 * the vec0 virtual table or the caller-supplied embedding buffer.
 *
 * `pk_conflict` is the one we expected and tolerate silently. Every
 * other reason indicates a caller bug or a vec0 surprise worth
 * investigating — those are logged.
 */
export type InsertEmbeddingSkipReason =
  | "pk_conflict"
  | "dim_mismatch"
  | "zero_length"
  | "nan_or_inf"
  | "no_vec_extension"
  | "other";

export const INSERT_EMBEDDING_SKIP_REASONS: InsertEmbeddingSkipReason[] = [
  "pk_conflict",
  "dim_mismatch",
  "zero_length",
  "nan_or_inf",
  "no_vec_extension",
  "other",
];

export type InsertEmbeddingResult =
  | { ok: true }
  | { ok: false; reason: InsertEmbeddingSkipReason; error: string };

/**
 * Classify an error message from a failed vec_memories INSERT into a
 * discrete skip reason. Pattern-matches bun:sqlite + sqlite-vec error
 * text; anything unrecognized falls through to "other".
 */
export function classifyEmbeddingInsertError(
  message: string
): InsertEmbeddingSkipReason {
  const m = message.toLowerCase();
  if (m.includes("unique constraint") && m.includes("vec_memories")) {
    return "pk_conflict";
  }
  if (m.includes("dimension mismatch")) return "dim_mismatch";
  if (m.includes("zero-length") || m.includes("zero length")) {
    return "zero_length";
  }
  if (
    m.includes("nan") ||
    m.includes("infinity") ||
    /\binfinite\b/.test(m) ||
    m.includes("non-finite")
  ) {
    return "nan_or_inf";
  }
  return "other";
}

export function emptySkipCounts(): Record<InsertEmbeddingSkipReason, number> {
  return {
    pk_conflict: 0,
    dim_mismatch: 0,
    zero_length: 0,
    nan_or_inf: 0,
    no_vec_extension: 0,
    other: 0,
  };
}
