import {
  MemoryDB,
  emptySkipCounts,
  type InsertEmbeddingSkipReason,
} from "./db";
import type { EmbedClient } from "./embed";
import type { LLMClient } from "./summarize";
import {
  INGEST_SYSTEM_PROMPT,
  CONSOLIDATE_SYSTEM_PROMPT,
  QUERY_SYSTEM_PROMPT,
  EVALUATE_SYSTEM_PROMPT,
  parseJsonResponse,
} from "./summarize";
import { chunkText } from "./chunk";
import { storeTriples } from "./graph";
import type {
  IngestResult,
  Memory,
  Origin,
  ProvenanceInput,
  RefreshPolicy,
  ScoredMemory,
  Triple,
} from "./types";

export const DEDUP_THRESHOLD = 0.85;

/**
 * Result of MemoryService.backfillEmbeddings. `embedded` is the count
 * of rows where INSERT INTO vec_memories succeeded. `skipped` breaks
 * down by reason — pk_conflict is the benign case where the vec row
 * already exists; anything else merits investigation (logged at warn).
 * `total` = embedded + sum(skipped) = the number of rows backfill
 * attempted to embed this run.
 */
export interface BackfillResult {
  embedded: number;
  skipped: Record<InsertEmbeddingSkipReason, number>;
  total: number;
}

export interface MemoryServiceOptions {
  db: MemoryDB;
  embedder: EmbedClient;
  llm: LLMClient;
  dedupThreshold?: number;
}

interface IngestLLMResponse {
  summary?: string;
  entities?: string[];
  topics?: string[];
  importance?: number;
  triples?: Triple[];
}

interface ConsolidateLLMResponse {
  summary?: string;
  insight?: string;
  connections?: Array<{ from_id?: number; to_id?: number; relationship?: string }>;
}

export class MemoryService {
  private readonly db: MemoryDB;
  private readonly embedder: EmbedClient;
  private readonly llm: LLMClient;
  private readonly dedupThreshold: number;

  constructor(opts: MemoryServiceOptions) {
    this.db = opts.db;
    this.embedder = opts.embedder;
    this.llm = opts.llm;
    this.dedupThreshold = opts.dedupThreshold ?? DEDUP_THRESHOLD;
  }

  // --- Ingest ----------------------------------------------------------

  async ingest(
    text: string,
    source: string = "",
    project: string = "",
    provenance?: ProvenanceInput
  ): Promise<IngestResult> {
    const trimmed = text.slice(0, 8000);

    // Cheap content-hash short-circuit. When the caller supplies a
    // content_hash and a byte-identical top-level memory already exists
    // in this project, skip LLM summarization + embedding entirely.
    // Costs a single indexed lookup; saves a full ingest cycle.
    if (provenance?.content_hash) {
      const existing = this.db.findByContentHash(
        provenance.content_hash,
        project
      );
      if (existing != null) {
        return { status: "duplicate", duplicate_of: existing };
      }
    }

    let userPrompt = "Process this information for memory storage";
    if (source) userPrompt += ` (source: ${source})`;
    userPrompt += `:\n\n${trimmed}`;

    let parsed: IngestLLMResponse;
    let rawResponse = "";
    try {
      rawResponse = await this.llm.complete([
        { role: "system", content: INGEST_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ]);
      parsed = parseJsonResponse<IngestLLMResponse>(rawResponse);
    } catch (err) {
      // Fall back to storing with whatever we got — same as Python version.
      const mid = this.db.storeMemory({
        raw_text: trimmed,
        summary: rawResponse ? rawResponse.slice(0, 200) : "Failed to summarize",
        entities: [],
        topics: [],
        importance: 0.5,
        source,
        project,
        ...provenance,
      });
      return { status: "stored", memory_id: mid, summary: "Failed to summarize" };
    }

    const summary = parsed.summary ?? "No summary";
    const entities = parsed.entities ?? [];
    const topics = parsed.topics ?? [];
    const importance = Number(parsed.importance ?? 0.5);
    const triples = parsed.triples ?? [];

    const chunks = chunkText(trimmed);
    const isChunked = chunks.length > 1;

    if (isChunked) {
      if (this.db.hasVec) {
        const summaryEmbedding = await this.embedder.embed(summary);
        const dup = this.db.checkDuplicate(summaryEmbedding, this.dedupThreshold);
        if (dup.isDup && dup.existingId != null) {
          return {
            status: "duplicate",
            duplicate_of: dup.existingId,
            similarity: round3(dup.similarity),
          };
        }
      }

      const parentId = this.db.storeMemory({
        raw_text: trimmed,
        summary,
        entities,
        topics,
        importance,
        source,
        project,
        ...provenance,
      });

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const chunkEmb = this.db.hasVec ? await this.embedder.embed(chunk) : null;
        this.db.storeMemory({
          raw_text: chunk,
          summary: `[Chunk ${i + 1}/${chunks.length}] ${summary.slice(0, 100)}`,
          entities,
          topics,
          importance,
          source,
          project,
          embedding: chunkEmb,
          parent_id: parentId,
          ...provenance,
        });
      }

      if (triples.length > 0) storeTriples(this.db, triples, parentId, project);
      return {
        status: "stored",
        memory_id: parentId,
        summary,
        chunks: chunks.length,
      };
    }

    // Short text — single memory with embedding
    let embedding: number[] | null = null;
    if (this.db.hasVec) {
      const embInput = `${summary}\n${trimmed.slice(0, 500)}`;
      embedding = await this.embedder.embed(embInput);
      const dup = this.db.checkDuplicate(embedding, this.dedupThreshold);
      if (dup.isDup && dup.existingId != null) {
        return {
          status: "duplicate",
          duplicate_of: dup.existingId,
          similarity: round3(dup.similarity),
        };
      }
    }

    const mid = this.db.storeMemory({
      raw_text: trimmed,
      summary,
      entities,
      topics,
      importance,
      source,
      project,
      embedding,
      ...provenance,
    });
    if (triples.length > 0) storeTriples(this.db, triples, mid, project);
    return { status: "stored", memory_id: mid, summary };
  }

  // --- Query -----------------------------------------------------------

  async query(
    question: string,
    project: string = "",
    opts: { deep?: boolean; maxIterations?: number } = {}
  ): Promise<string> {
    if (opts.deep) return this.deepQuery(question, project, opts.maxIterations ?? 3);
    if (!this.db.hasVec) return this.legacyQuery(question, project);
    const scored = await this.searchMemories(question, project);
    if (scored.length === 0) return this.legacyQuery(question, project);

    const context = this.buildContext(scored, project);
    const prompt = `Memories:\n${context}\n\nQuestion: ${question}`;
    try {
      return await this.llm.complete([
        { role: "system", content: QUERY_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);
    } catch (err) {
      return `Error querying memories: ${(err as Error).message}`;
    }
  }

  /**
   * Iterative retrieval query. After the initial KNN search, an evaluator
   * LLM decides whether the context is sufficient. If not, it proposes a
   * refined_query and/or entities to explore in the knowledge graph. Up to
   * `maxIterations` refinement rounds before synthesizing a final answer.
   */
  async deepQuery(
    question: string,
    project: string = "",
    maxIterations: number = 3
  ): Promise<string> {
    const allScored: ScoredMemory[] = [];
    const seenIds = new Set<number>();
    const extraEntities: string[] = [];

    const addResults = (results: ScoredMemory[]) => {
      for (const r of results) {
        if (!seenIds.has(r.memory.id)) {
          seenIds.add(r.memory.id);
          allScored.push(r);
        }
      }
    };

    addResults(await this.searchMemories(question, project));

    for (let i = 0; i < maxIterations; i++) {
      const context = this.buildContext(allScored, project, extraEntities);
      if (!context.trim()) break;

      const evalPrompt = `Question: ${question}\n\nRetrieved context:\n${context}`;
      let evaluation: {
        sufficient?: boolean;
        reason?: string;
        refined_query?: string;
        explore_entities?: string[];
      };
      try {
        const raw = await this.llm.complete([
          { role: "system", content: EVALUATE_SYSTEM_PROMPT },
          { role: "user", content: evalPrompt },
        ]);
        evaluation = parseJsonResponse(raw);
      } catch {
        // Treat parse failure as sufficient — fall through to synthesis.
        break;
      }

      if (evaluation.sufficient ?? true) break;

      if (evaluation.refined_query && evaluation.refined_query.trim()) {
        addResults(await this.searchMemories(evaluation.refined_query, project, seenIds));
      }
      if (Array.isArray(evaluation.explore_entities)) {
        for (const e of evaluation.explore_entities) {
          if (e && !extraEntities.includes(e)) extraEntities.push(e);
        }
      }
    }

    const context = this.buildContext(allScored, project, extraEntities);
    if (!context.trim()) {
      return "No memories stored yet. POST to /ingest to add one.";
    }
    const prompt = `Memories:\n${context}\n\nQuestion: ${question}`;
    try {
      return await this.llm.complete([
        { role: "system", content: QUERY_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);
    } catch (err) {
      return `Error querying memories: ${(err as Error).message}`;
    }
  }

  async searchMemories(
    queryText: string,
    project: string = "",
    excludeIds?: Set<number>,
    limit: number = 10
  ): Promise<ScoredMemory[]> {
    if (!this.db.hasVec) return [];
    const embedding = await this.embedder.embed(queryText);
    // Overfetch so project/exclude filtering doesn't starve results below
    // the requested limit. The KNN call is the only cost here.
    const fetchK = Math.max(limit * 3, 10);
    const results = this.db.knnSearch(embedding, fetchK);
    if (results.length === 0) return [];

    const distances = new Map<number, number>(results.map((r) => [r.memory_id, r.distance]));
    let memories = this.db.getMemoriesByIds(results.map((r) => r.memory_id));
    if (project) {
      memories = memories.filter((m) => m.project === project || m.project === "");
    }
    if (excludeIds) memories = memories.filter((m) => !excludeIds.has(m.id));

    for (const m of memories) this.db.touchAccess(m.id);

    const now = Date.now();
    const scored: ScoredMemory[] = [];
    for (const m of memories) {
      const dist = distances.get(m.id) ?? 1.0;
      const created = Date.parse(m.created_at);
      const ageDays = Number.isFinite(created)
        ? Math.floor((now - created) / (1000 * 60 * 60 * 24))
        : 0;
      const score = relevanceScore(m.importance, m.access_count, dist, ageDays);
      scored.push({ score, distance: dist, memory: m });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  buildContext(scored: ScoredMemory[], project: string, extraEntities: string[] = []): string {
    const parts: string[] = [];
    for (const { distance, memory: m } of scored) {
      const similarity = 1.0 - distance;
      parts.push(
        `Memory #${m.id} (source: ${m.source}, importance: ${m.importance}, ` +
          `similarity: ${similarity.toFixed(2)}):\n${m.summary}\n` +
          `Entities: ${m.entities.join(", ")}\nTopics: ${m.topics.join(", ")}`
      );
    }

    const consolidations = this.db.readConsolidations();
    if (consolidations.length > 0) {
      parts.push("\n--- Consolidation Insights ---");
      for (const c of consolidations) {
        parts.push(`Insight: ${c.insight}\nSummary: ${c.summary}`);
      }
    }

    const graphParts: string[] = [];
    const seen = new Set<string>();
    const addGraphFor = (name: string) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const graph = this.db.getEntityGraph(name, project);
      if (graph && graph.relationships.length > 0) {
        const rels = graph.relationships
          .slice(0, 5)
          .map((r) =>
            r.direction === "outgoing"
              ? `${r.relation} → ${r.entity}`
              : `${r.entity} → ${r.relation}`
          )
          .join(", ");
        graphParts.push(`${name} (${graph.entity.type}): ${rels}`);
      }
    };
    for (const { memory: m } of scored) {
      for (const ent of m.entities) addGraphFor(ent);
    }
    for (const ent of extraEntities) addGraphFor(ent);

    if (graphParts.length > 0) {
      parts.push("\n--- Knowledge Graph ---");
      parts.push(...graphParts);
    }
    return parts.join("\n\n");
  }

  private async legacyQuery(question: string, project: string): Promise<string> {
    const memories = this.db.readAllMemories(project);
    const consolidations = this.db.readConsolidations();
    const parts: string[] = [];
    for (const m of memories) {
      parts.push(
        `Memory #${m.id} (source: ${m.source}, importance: ${m.importance}):\n${m.summary}\n` +
          `Entities: ${m.entities.join(", ")}\nTopics: ${m.topics.join(", ")}`
      );
    }
    if (consolidations.length > 0) {
      parts.push("\n--- Consolidation Insights ---");
      for (const c of consolidations) {
        parts.push(`Insight: ${c.insight}\nSummary: ${c.summary}`);
      }
    }
    if (parts.length === 0) {
      return "No memories stored yet. POST to /ingest to add one.";
    }
    const context = parts.join("\n\n");
    const prompt = `Memories:\n${context}\n\nQuestion: ${question}`;
    try {
      return await this.llm.complete([
        { role: "system", content: QUERY_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);
    } catch (err) {
      return `Error querying memories: ${(err as Error).message}`;
    }
  }

  // --- Consolidation --------------------------------------------------

  async consolidate(): Promise<{
    status: string;
    reason?: string;
    memories_processed?: number;
    insight?: string;
  }> {
    const memories = this.db.readUnconsolidated();
    if (memories.length < 2) {
      return { status: "skipped", reason: "fewer than 2 unconsolidated memories" };
    }
    const formatted = memories
      .map(
        (m) =>
          `Memory #${m.id} (importance: ${m.importance}):\n` +
          `Summary: ${m.summary}\n` +
          `Entities: ${m.entities.join(", ")}\n` +
          `Topics: ${m.topics.join(", ")}`
      )
      .join("\n\n");
    const prompt = `Consolidate these ${memories.length} memories:\n\n${formatted}`;
    let parsed: ConsolidateLLMResponse;
    try {
      const raw = await this.llm.complete([
        { role: "system", content: CONSOLIDATE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);
      parsed = parseJsonResponse<ConsolidateLLMResponse>(raw);
    } catch (err) {
      return { status: "error", reason: (err as Error).message };
    }

    const sourceIds = memories.map((m) => m.id);
    this.db.storeConsolidation({
      source_ids: sourceIds,
      summary: parsed.summary ?? "",
      insight: parsed.insight ?? "",
      connections: parsed.connections ?? [],
    });
    return {
      status: "consolidated",
      memories_processed: sourceIds.length,
      insight: parsed.insight ?? "",
    };
  }

  // --- Backfill -------------------------------------------------------

  async backfillEmbeddings(): Promise<BackfillResult> {
    const skipped = emptySkipCounts();
    let embedded = 0;
    const record = (result: { ok: boolean; reason?: InsertEmbeddingSkipReason }) => {
      if (result.ok) embedded++;
      else skipped[result.reason!]++;
    };

    if (!this.db.hasVec) {
      return { embedded: 0, skipped, total: 0 };
    }

    const rows = this.db.memoriesMissingEmbeddings();
    for (const row of rows) {
      if (this.db.hasChildren(row.id)) continue;
      const chunks = chunkText(row.raw_text);
      if (chunks.length > 1) {
        const entities = parseJsonArray(row.entities);
        const topics = parseJsonArray(row.topics);
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!;
          const emb = await this.embedder.embed(chunk);
          // Persist the chunk row first (no embedding), then attempt
          // the vec insert separately. This decouples the memories
          // INSERT from the vec_memories INSERT so that a vec failure
          // does NOT roll back the chunk row — the chunk stays and
          // becomes eligible for re-embed on the next backfill run,
          // while the failure reason is logged for investigation.
          const mid = this.db.storeMemory({
            raw_text: chunk,
            summary: `[Chunk ${i + 1}/${chunks.length}] ${row.summary.slice(0, 100)}`,
            entities,
            topics,
            importance: row.importance,
            source: row.source,
            project: row.project,
            embedding: null,
            parent_id: row.id,
            source_url: row.source_url,
            fetched_at: row.fetched_at,
            refresh_policy: row.refresh_policy as RefreshPolicy | null,
            content_hash: row.content_hash,
            origin: row.origin as Origin | null,
          });
          record(this.db.safeInsertEmbedding(mid, emb));
        }
      } else {
        const text = `${row.summary}\n${row.raw_text.slice(0, 500)}`;
        const emb = await this.embedder.embed(text);
        record(this.db.safeInsertEmbedding(row.id, emb));
      }
    }

    // Also embed stranded chunk rows (parent_id IS NOT NULL) that
    // were created by an earlier version without committing to
    // vec_memories. Uses the same single-chunk embedding text
    // pattern as the parent path above.
    //
    // All vec_memories INSERTs flow through safeInsertEmbedding which
    // classifies failures (pk_conflict, dim_mismatch, zero_length,
    // nan_or_inf, other) and logs non-pk_conflict skips at warn, so
    // the shape of failures in production is observable instead of
    // swallowed by a bare catch.
    const chunkRows = this.db.chunksMissingEmbeddings();
    for (const row of chunkRows) {
      if (this.db.hasEmbedding(row.id)) continue;
      const text = `${row.summary}\n${row.raw_text.slice(0, 500)}`;
      const emb = await this.embedder.embed(text);
      record(this.db.safeInsertEmbedding(row.id, emb));
    }

    const total =
      embedded +
      Object.values(skipped).reduce((sum, n) => sum + n, 0);
    return { embedded, skipped, total };
  }
}

// --- Helpers ----------------------------------------------------------

function relevanceScore(
  importance: number,
  accessCount: number,
  distance: number,
  ageDays: number
): number {
  const semantic = 1.0 - distance;
  const recency = 1.0 / (1.0 + ageDays / 30.0);
  const accessFactor = Math.min(1.0, Math.log(accessCount + 1) / 3.0);
  return 0.3 * semantic + 0.3 * importance + 0.25 * recency + 0.15 * accessFactor;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function parseJsonArray(v: string | unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v !== "string") return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
