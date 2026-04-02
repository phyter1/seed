import { QueueDB } from "./db";
import { createApp } from "./server";
import { publishServer } from "./discovery";

const PORT = Number(process.env.QUEUE_PORT ?? 7654);
const DB_PATH = process.env.QUEUE_DB ?? "queue.db";

const db = new QueueDB(DB_PATH);
const app = createApp(db);

console.log(`ren-queue server starting on port ${PORT}`);
console.log(`Database: ${DB_PATH}`);

// Broadcast on the local network so workers can find us
publishServer(PORT);

export default {
  port: PORT,
  fetch: app.fetch,
};
