import { MemoryDB } from "./db";
import { MemoryService } from "./memory";
import { createOllamaEmbedClient } from "./embed";
import { createFleetRouterClient } from "./summarize";
import { createMemoryApp } from "./server";
import { copyFileSync, existsSync } from "node:fs";

const PORT = Number(process.env.MEMORY_PORT ?? 19888);
const DB_PATH = process.env.MEMORY_DB ?? "memory.db";
const SEED_DB = process.env.MEMORY_SEED_DB ?? "";

async function main() {
  // Seed the database from a backup if the target file doesn't exist yet.
  if (!existsSync(DB_PATH) && SEED_DB && existsSync(SEED_DB)) {
    console.log(`[memory] seeding ${DB_PATH} from ${SEED_DB}`);
    copyFileSync(SEED_DB, DB_PATH);
  }

  const db = new MemoryDB(DB_PATH);
  const embedder = createOllamaEmbedClient();
  const llm = createFleetRouterClient();
  const service = new MemoryService({ db, embedder, llm });
  const app = createMemoryApp({ db, service });

  console.log(`[memory] starting on port ${PORT}`);
  console.log(`[memory] database: ${DB_PATH}`);
  console.log(`[memory] vector search: ${db.hasVec ? `enabled (dim=${db.embedDim})` : "disabled"}`);
  const stats = db.getStats();
  console.log(
    `[memory] ${stats.total_memories} memories, ${stats.total_entities} entities, ` +
      `${stats.total_relationships} relationships, ${stats.embedded_memories ?? 0} embedded`
  );

  const server = Bun.serve({
    port: PORT,
    hostname: "0.0.0.0",
    fetch: app.fetch,
  });

  console.log(`[memory] listening on ${server.hostname}:${server.port}`);

  const shutdown = (sig: string) => {
    console.log(`[memory] received ${sig}, shutting down`);
    server.stop();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[memory] fatal:", err);
  process.exit(1);
});
