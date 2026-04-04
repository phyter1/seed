import { ControlDB } from "./db";
import {
  createApp,
  createState,
  handleWsMessage,
  handleWsClose,
  registerDashboardClient,
} from "./server";
import { hashToken } from "./auth";
import { createTelemetryPipeline } from "./telemetry";
import type { ServerWebSocket } from "bun";
import { SEED_VERSION } from "./version";
import { runSelfUpdate } from "./self-update";

const PORT = Number(process.env.CONTROL_PORT ?? 4310);
const DB_PATH = process.env.CONTROL_DB ?? "/data/seed-control.db";
const OPERATOR_TOKEN = process.env.OPERATOR_TOKEN;

type WsKind = "agent" | "dashboard";

interface WsData {
  kind: WsKind;
  authorization?: string;
  machine_id?: string;
}

async function main() {
  const db = new ControlDB(DB_PATH);
  const operatorTokenHash = OPERATOR_TOKEN
    ? await hashToken(OPERATOR_TOKEN)
    : null;
  const telemetry = createTelemetryPipeline(db);
  telemetry.start();
  const state = createState(db, operatorTokenHash ?? undefined, telemetry);
  const app = createApp(state);

  if (!OPERATOR_TOKEN) {
    console.log("[control] WARNING: no OPERATOR_TOKEN set, REST API is unauthenticated");
  }

  console.log(`[control] fleet control plane starting on port ${PORT}`);
  console.log(`[control] database: ${DB_PATH}`);

  const server = Bun.serve<WsData>({
    port: PORT,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req, {
          data: {
            kind: "agent" as WsKind,
            authorization: req.headers.get("authorization") ?? undefined,
            machine_id: url.searchParams.get("machine_id") ?? undefined,
          },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      if (url.pathname === "/ws/dashboard") {
        const upgraded = server.upgrade(req, {
          data: { kind: "dashboard" as WsKind },
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return app.fetch(req, server);
    },
    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        if (ws.data.kind === "dashboard") {
          registerDashboardClient(ws as any, state);
        }
      },
      async message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
        if (ws.data.kind === "dashboard") {
          // Dashboards don't send anything meaningful yet; ignore.
          return;
        }
        const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
        await handleWsMessage(ws as any, raw, state, ws.data);
      },
      close(ws: ServerWebSocket<WsData>) {
        handleWsClose(ws as any, state);
      },
    },
  });

  console.log(`[control] listening on ${server.hostname}:${server.port}`);
}

async function runSelfUpdateSubcommand(args: string[]): Promise<void> {
  let version: string | undefined;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--version" && args[i + 1]) {
      version = args[++i];
    } else if (a === "--force") {
      force = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: seed-control-plane self-update [--version <tag>] [--force]"
      );
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }

  try {
    const result = await runSelfUpdate({
      binary: "seed-control-plane",
      version,
      currentVersion: SEED_VERSION,
      force,
    });
    if (result.updated) {
      console.log(
        "[control] self-update complete — exit and restart the control plane to pick up the new binary"
      );
    }
    process.exit(0);
  } catch (err: any) {
    console.error(`[control] self-update failed: ${err?.message ?? err}`);
    process.exit(1);
  }
}

async function entrypoint() {
  const subcommand = process.argv[2];
  if (subcommand === "self-update") {
    await runSelfUpdateSubcommand(process.argv.slice(3));
    return;
  }
  if (subcommand === "--version" || subcommand === "version") {
    console.log(SEED_VERSION);
    process.exit(0);
  }
  await main();
}

entrypoint().catch((err) => {
  console.error("[control] fatal:", err);
  process.exit(1);
});
