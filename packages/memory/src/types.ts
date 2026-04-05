/**
 * How often a piece of content should be re-fetched from its source.
 * 'static' means never auto-refresh. Narrow this union later once the
 * fetcher scheduler lands and chooses an enforcement model.
 */
export type RefreshPolicy =
  | "static"
  | "daily"
  | "weekly"
  | "monthly"
  | "on-demand";

export const REFRESH_POLICIES: readonly RefreshPolicy[] = [
  "static",
  "daily",
  "weekly",
  "monthly",
  "on-demand",
] as const;

/**
 * Where a memory came from. 'internal' = authored by this system (journal
 * entries, reflections, generated summaries). 'external' = fetched from
 * somewhere with a URL (web content, APIs, documents). Enforcement kicks
 * in when origin='external': the caller must also supply source_url and
 * fetched_at. Null is allowed for back-compat with rows written before
 * this column existed.
 */
export type Origin = "internal" | "external";

export const ORIGINS: readonly Origin[] = ["internal", "external"] as const;

/**
 * Provenance attached to an ingest call. All fields optional — callers
 * with authored content should omit this entirely; fetchers supplying
 * external content should fill what they know.
 */
export interface ProvenanceInput {
  source_url?: string | null;
  fetched_at?: string | null;
  refresh_policy?: RefreshPolicy | null;
  content_hash?: string | null;
  origin?: Origin | null;
}

export interface Memory {
  id: number;
  source: string;
  summary: string;
  raw_text: string;
  entities: string[];
  topics: string[];
  importance: number;
  connections: unknown[];
  created_at: string;
  consolidated: boolean;
  project: string;
  access_count: number;
  last_accessed: string;
  parent_id: number | null;
  /** URL this memory was fetched from (if external). Null for authored content. */
  source_url: string | null;
  /** ISO timestamp of when source_url was last fetched. */
  fetched_at: string | null;
  /** Cadence at which source_url should be re-fetched. */
  refresh_policy: RefreshPolicy | null;
  /** SHA-256 hex digest of raw_text. Used for exact-dup detection. */
  content_hash: string | null;
  /**
   * Whether this memory was authored locally ('internal') or fetched from
   * an external source ('external'). Null for rows predating this column.
   */
  origin: Origin | null;
}

export interface Entity {
  id: number;
  name: string;
  type: string;
  project: string;
  created_at: string;
}

export interface Relationship {
  id: number;
  source_entity_id: number;
  target_entity_id: number;
  relation_type: string;
  memory_id: number | null;
  created_at: string;
}

export interface Triple {
  subject: string;
  subject_type?: string;
  predicate: string;
  object: string;
  object_type?: string;
}

export interface IngestResult {
  memory_id?: number;
  status: "stored" | "duplicate" | "error";
  summary?: string;
  duplicate_of?: number;
  similarity?: number;
  chunks?: number;
  error?: string;
}

export interface MemoryStats {
  total_memories: number;
  unconsolidated: number;
  consolidations: number;
  vector_search: boolean;
  embedded_memories?: number;
  projects: string[];
  total_entities: number;
  total_relationships: number;
}

export interface EntityGraph {
  entity: { id: number; name: string; type: string; project: string };
  relationships: Array<{
    direction: "outgoing" | "incoming";
    relation: string;
    entity: string;
    entity_type: string;
    memory_id: number | null;
  }>;
}

export interface ScoredMemory {
  score: number;
  distance: number;
  memory: Memory;
}
