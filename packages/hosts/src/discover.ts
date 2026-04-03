import { listHostAdapters } from "./index";

async function main() {
  const results = await Promise.all(
    listHostAdapters().map(async (adapter) => ({
      id: adapter.id,
      displayName: adapter.displayName,
      capabilities: adapter.capabilities,
      detection: await adapter.detect(),
    }))
  );

  process.stdout.write(`${JSON.stringify({ hosts: results }, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
