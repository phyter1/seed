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
