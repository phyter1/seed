import { accessSync, readFileSync, constants } from "node:fs";
import { basename } from "node:path";
import { networkInterfaces } from "node:os";

/**
 * Detect a LAN-reachable IPv4 address.
 * Prefers 192.168.x.x or 10.x.x.x ranges.
 */
function detectLanIp(): string {
  const ifaces = networkInterfaces();
  let fallback: string | undefined;

  for (const addrs of Object.values(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (addr.address.startsWith("192.168.") || addr.address.startsWith("10.")) {
        return addr.address;
      }
      fallback ??= addr.address;
    }
  }

  if (fallback) return fallback;
  throw new Error("No LAN-reachable IPv4 address found");
}

export interface StageServer {
  /** Full URL to fetch the staged artifact */
  url: string;
  /** Shut down the staging server */
  close: () => void;
}

/**
 * Start an ephemeral HTTP server that serves a single file.
 * The server binds to port 0 (OS-assigned) on all interfaces.
 */
export async function startStageServer(filePath: string): Promise<StageServer> {
  // Verify file exists and is readable before starting
  accessSync(filePath, constants.R_OK);

  const fileName = basename(filePath);
  const fileContent = readFileSync(filePath);
  const lanIp = detectLanIp();

  const server = Bun.serve({
    hostname: "0.0.0.0",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === `/${fileName}`) {
        return new Response(fileContent, {
          headers: { "content-type": "application/gzip" },
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const stageUrl = `http://${lanIp}:${server.port}/${fileName}`;

  return {
    url: stageUrl,
    close: () => server.stop(true),
  };
}
