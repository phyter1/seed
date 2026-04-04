import { MemoryDB } from "./db";
import type { Triple } from "./types";

/**
 * Extract + store knowledge-graph triples for a memory.
 * Returns the number of triples stored.
 */
export function storeTriples(
  db: MemoryDB,
  triples: Triple[],
  memoryId: number,
  project: string = ""
): number {
  let count = 0;
  for (const t of triples) {
    const subject = (t.subject ?? "").trim();
    const predicate = (t.predicate ?? "").trim();
    const object = (t.object ?? "").trim();
    if (!subject || !predicate || !object) continue;
    const srcId = db.upsertEntity(subject, t.subject_type ?? "", project);
    const tgtId = db.upsertEntity(object, t.object_type ?? "", project);
    db.storeRelationship(srcId, tgtId, predicate, memoryId);
    count++;
  }
  return count;
}
