/**
 * repro-pk-conflict.ts — Reproduce vec0 PK conflict race conditions.
 *
 * DO NOT COMMIT. Diagnosis-only script.
 *
 * Tests three scenarios:
 * 1. Ingest-then-backfill (single-chunk): does backfill pk_conflict on
 *    a memory that ingest already embedded?
 * 2. Concurrent backfill calls: do two backfills race on the same rows?
 * 3. Ingest parent + backfill race on childless parent window.
 */
import { MemoryDB } from "../src/db";
import { MemoryService } from "../src/memory";
import { createFakeEmbedder, createFakeLLM } from "../src/test-helpers";

function setup() {
  const db = new MemoryDB(":memory:");
  const embedder = createFakeEmbedder();
  const llm = createFakeLLM({
    ingest: {
      summary: "Test memory",
      entities: ["test"],
      topics: ["testing"],
      importance: 0.5,
    },
  });
  const service = new MemoryService({ db, embedder, llm });
  return { db, embedder, service };
}

async function scenario1_ingestThenBackfill() {
  console.log("\n=== Scenario 1: Ingest short text (embeds inline), then backfill ===");
  const { db, service } = setup();

  if (!db.hasVec) {
    console.log("SKIP: sqlite-vec not available");
    return;
  }

  // Ingest short text — will go through single-memory path (memory.ts:202)
  // which calls storeMemory with embedding, inserting into BOTH tables atomically.
  const result = await service.ingest("Short test memory content", "test");
  console.log("Ingest result:", result);

  if (result.status !== "stored") {
    console.log("SKIP: ingest did not store (maybe duplicate?)");
    return;
  }

  // Check: vec entry should exist
  const hasVec = db.hasEmbedding(result.memory_id!);
  console.log(`Memory ${result.memory_id} has vec entry: ${hasVec}`);

  // Now run backfill — should be a no-op since embedding already exists
  const backfill = await service.backfillEmbeddings();
  console.log("Backfill result:", backfill);
  console.log(
    `pk_conflict count: ${backfill.skipped.pk_conflict}`,
    backfill.skipped.pk_conflict > 0 ? "⚠️ REPRODUCED" : "✓ clean"
  );
}

async function scenario2_concurrentBackfills() {
  console.log("\n=== Scenario 2: Concurrent backfill calls ===");
  const { db, service } = setup();

  if (!db.hasVec) {
    console.log("SKIP: sqlite-vec not available");
    return;
  }

  // Pre-populate memories WITHOUT embeddings (simulate earlier ingest
  // that didn't have vec, or a failed embed).
  for (let i = 0; i < 5; i++) {
    db.storeMemory({
      raw_text: `Memory number ${i} with unique content for embedding`,
      summary: `Summary ${i}`,
      entities: ["test"],
      topics: ["testing"],
      importance: 0.5,
      source: "test",
      embedding: null, // no vec entry
    });
  }

  // Verify: all 5 should show as missing embeddings
  const missing = db.memoriesMissingEmbeddings();
  console.log(`Memories missing embeddings: ${missing.length}`);

  // Fire two backfills concurrently — they both query the same stale list
  const [r1, r2] = await Promise.all([
    service.backfillEmbeddings(),
    service.backfillEmbeddings(),
  ]);

  console.log("Backfill 1:", r1);
  console.log("Backfill 2:", r2);

  const totalPkConflicts = r1.skipped.pk_conflict + r2.skipped.pk_conflict;
  console.log(
    `Total pk_conflict: ${totalPkConflicts}`,
    totalPkConflicts > 0 ? "⚠️ REPRODUCED" : "✓ clean (no race hit)"
  );
}

async function scenario3_ingestChunkedPlusBackfillRace() {
  console.log("\n=== Scenario 3: Chunked ingest + concurrent backfill ===");
  const { db, service } = setup();

  if (!db.hasVec) {
    console.log("SKIP: sqlite-vec not available");
    return;
  }

  // Generate text long enough to trigger chunking (>2000 chars).
  const longText = Array(50)
    .fill("This is a paragraph of text that serves as content for chunking. ")
    .join("\n");

  // Fire ingest and backfill concurrently.
  // The race window: ingest creates parent (no embedding, no children),
  // then awaits embedder.embed() for first chunk. During that yield,
  // backfill can see the parent as childless + missing embedding.
  const [ingestResult, backfillResult] = await Promise.all([
    service.ingest(longText, "test"),
    // Small delay so ingest creates parent before backfill queries
    new Promise<Awaited<ReturnType<typeof service.backfillEmbeddings>>>(
      (resolve) => setTimeout(async () => resolve(await service.backfillEmbeddings()), 5)
    ),
  ]);

  console.log("Ingest result:", ingestResult);
  console.log("Backfill result:", backfillResult);
  console.log(
    `pk_conflict: ${backfillResult.skipped.pk_conflict}`,
    backfillResult.skipped.pk_conflict > 0 ? "⚠️ REPRODUCED" : "✓ clean"
  );

  // Check for duplicate chunks
  if (ingestResult.status === "stored" && ingestResult.memory_id) {
    const missing = db.memoriesMissingEmbeddings();
    const chunksMissing = db.chunksMissingEmbeddings();
    console.log("Parent rows still missing embeddings:", missing.length);
    console.log("Chunk rows still missing embeddings:", chunksMissing.length);
  }
}

async function main() {
  console.log("=== vec0 PK Conflict Reproduction Script ===");
  console.log("This script does NOT modify production data.\n");

  await scenario1_ingestThenBackfill();
  await scenario2_concurrentBackfills();
  await scenario3_ingestChunkedPlusBackfillRace();

  console.log("\n=== Done ===");
}

main().catch(console.error);
