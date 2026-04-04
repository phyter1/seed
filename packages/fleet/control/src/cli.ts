/**
 * Seed Fleet CLI
 *
 * Usage:
 *   bun run src/cli.ts status
 *   bun run src/cli.ts approve <machine_id>
 *   bun run src/cli.ts revoke <machine_id>
 *   bun run src/cli.ts config
 *   bun run src/cli.ts audit [--limit N]
 *   bun run src/cli.ts join <control_url> [--machine-id <id>] [--display-name <name>]
 *
 * Config:
 *   SEED_CONTROL_URL — control plane URL (default: http://localhost:4310)
 *   SEED_OPERATOR_TOKEN — operator bearer token
 */

import { generateToken, hashToken } from "./auth";

function getControlUrl(): string {
  return (
    process.env.SEED_CONTROL_URL ??
    (() => {
      try {
        const text = require("fs").readFileSync(
          `${process.env.HOME}/.config/seed-fleet/cli.json`,
          "utf-8"
        );
        return JSON.parse(text).control_url;
      } catch {
        return "http://localhost:4310";
      }
    })()
  );
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = process.env.SEED_OPERATOR_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function apiGet(path: string): Promise<any> {
  const url = `${getControlUrl()}${path}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Error ${res.status}: ${body}`);
    process.exit(1);
  }
  return res.json();
}

async function apiPost(path: string, body?: any): Promise<any> {
  const url = `${getControlUrl()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Error ${res.status}: ${text}`);
    process.exit(1);
  }
  return res.json();
}

// --- Commands ---

async function cmdStatus() {
  const machines = await apiGet("/v1/fleet");

  if (machines.length === 0) {
    console.log("No machines registered.");
    return;
  }

  console.log(
    `${"ID".padEnd(12)} ${"STATUS".padEnd(10)} ${"CONNECTED".padEnd(11)} ${"ARCH".padEnd(10)} ${"MEM".padEnd(8)} ${"LAST SEEN"}`
  );
  console.log("-".repeat(75));

  for (const m of machines) {
    const connected = m.connected ? "yes" : "no";
    const arch = m.arch ?? "-";
    const mem = m.memory_gb ? `${m.memory_gb}GB` : "-";
    const lastSeen = m.last_seen
      ? new Date(m.last_seen + "Z").toLocaleString()
      : "-";
    console.log(
      `${m.id.padEnd(12)} ${m.status.padEnd(10)} ${connected.padEnd(11)} ${arch.padEnd(10)} ${mem.padEnd(8)} ${lastSeen}`
    );
  }
}

async function cmdApprove(machineId: string) {
  const result = await apiPost(`/v1/fleet/approve/${machineId}`);
  console.log(`Machine '${machineId}' approved.`);
  if (result.token) {
    console.log(`Token: ${result.token}`);
    console.log(
      "This token is shown once. Save it to the machine's ~/.config/seed-fleet/agent.json"
    );
  }
}

async function cmdRevoke(machineId: string) {
  await apiPost(`/v1/fleet/revoke/${machineId}`);
  console.log(`Machine '${machineId}' revoked.`);
}

async function cmdConfig() {
  const data = await apiGet("/v1/config");
  console.log(`Config version: ${data.version}`);
  console.log(JSON.stringify(data.config, null, 2));
}

async function cmdAudit(limit: number) {
  const entries = await apiGet(`/v1/audit?limit=${limit}`);
  if (entries.length === 0) {
    console.log("No audit entries.");
    return;
  }

  console.log(
    `${"TIMESTAMP".padEnd(22)} ${"EVENT".padEnd(18)} ${"MACHINE".padEnd(12)} ${"ACTION".padEnd(20)} ${"RESULT"}`
  );
  console.log("-".repeat(90));

  for (const e of entries) {
    const ts = e.timestamp;
    const event = e.event_type;
    const machine = e.machine_id ?? "-";
    const action = e.action ?? "-";
    const result = e.result ?? "-";
    console.log(
      `${ts.padEnd(22)} ${event.padEnd(18)} ${machine.padEnd(12)} ${action.padEnd(20)} ${result}`
    );
  }
}

/**
 * Register this machine with a control plane.
 *
 * Flow:
 *   1. Generate a 256-bit random token client-side
 *   2. Hash it (SHA-256) and POST {machine_id, display_name, token_hash}
 *      to the control plane's /v1/fleet/register endpoint
 *   3. Persist the raw token + control URL to ~/.config/seed-fleet/agent.json
 *   4. Print next steps — the operator must run `seed fleet approve <id>`
 *
 * The raw token never leaves this machine. The control plane only sees
 * the hash until the agent WebSocket connection presents the token for
 * authentication.
 *
 * Exported so tests can exercise it with an injected fetch.
 */
export interface JoinOptions {
  controlUrl: string;
  machineId: string;
  displayName?: string;
  configPath?: string;
  fetchImpl?: typeof fetch;
  writeFile?: (path: string, contents: string) => void;
  mkdirp?: (dir: string) => void;
  log?: (msg: string) => void;
  nowToken?: () => string;
}

export interface JoinResult {
  machineId: string;
  controlUrl: string;
  configPath: string;
}

function defaultConfigPath(): string {
  return (
    process.env.SEED_AGENT_CONFIG ??
    `${process.env.HOME}/.config/seed-fleet/agent.json`
  );
}

/** Normalize a control URL to http(s) for REST calls. */
function toHttpUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "");
  if (/^wss:\/\//i.test(trimmed)) return "https://" + trimmed.slice(6);
  if (/^ws:\/\//i.test(trimmed)) return "http://" + trimmed.slice(5);
  return trimmed;
}

export async function runJoin(opts: JoinOptions): Promise<JoinResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const tokenFn = opts.nowToken ?? generateToken;
  const fetchFn = opts.fetchImpl ?? fetch;
  const configPath = opts.configPath ?? defaultConfigPath();

  if (!opts.controlUrl) throw new Error("control_url is required");
  if (!opts.machineId) throw new Error("machine_id is required");

  const token = tokenFn();
  const tokenHashHex = await hashToken(token);
  const restUrl = toHttpUrl(opts.controlUrl) + "/v1/fleet/register";

  const res = await fetchFn(restUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      machine_id: opts.machineId,
      display_name: opts.displayName,
      token_hash: tokenHashHex,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `registration failed: ${res.status} ${text || res.statusText}`
    );
  }

  // Persist config + token. 0o600 so other users can't steal the token.
  const contents = JSON.stringify(
    { machine_id: opts.machineId, control_url: opts.controlUrl, token },
    null,
    2
  );

  if (opts.writeFile) {
    if (opts.mkdirp) opts.mkdirp(dirname(configPath));
    opts.writeFile(configPath, contents);
  } else {
    const fs = require("fs");
    const path = require("path");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const tmp = configPath + ".tmp";
    fs.writeFileSync(tmp, contents, { mode: 0o600 });
    fs.renameSync(tmp, configPath);
  }

  log(`Registered as '${opts.machineId}' with ${opts.controlUrl}.`);
  log(`Token + config written to ${configPath}`);
  log("");
  log("Next steps:");
  log(`  1. On the control plane host, run: seed fleet approve ${opts.machineId}`);
  log("  2. The agent daemon (launchd) will pick up the token and connect.");
  log("  3. Verify with: seed fleet status");

  return { machineId: opts.machineId, controlUrl: opts.controlUrl, configPath };
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "." : p.slice(0, i);
}

async function cmdJoin(args: string[]) {
  const controlUrl = args[0];
  if (!controlUrl || controlUrl.startsWith("--")) {
    console.error(
      "Usage: seed fleet join <control_url> [--machine-id <id>] [--display-name <name>]"
    );
    process.exit(1);
  }

  let machineId: string | undefined;
  let displayName: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--machine-id" && args[i + 1]) {
      machineId = args[++i];
    } else if (a === "--display-name" && args[i + 1]) {
      displayName = args[++i];
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }

  if (!machineId) {
    // Default to short hostname
    const proc = Bun.spawnSync(["hostname", "-s"]);
    machineId = new TextDecoder().decode(proc.stdout).trim();
  }

  try {
    await runJoin({ controlUrl, machineId, displayName });
  } catch (err: any) {
    console.error(`Error: ${err?.message ?? err}`);
    process.exit(1);
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "status":
      await cmdStatus();
      break;

    case "approve":
      if (!args[1]) {
        console.error("Usage: seed fleet approve <machine_id>");
        process.exit(1);
      }
      await cmdApprove(args[1]);
      break;

    case "revoke":
      if (!args[1]) {
        console.error("Usage: seed fleet revoke <machine_id>");
        process.exit(1);
      }
      await cmdRevoke(args[1]);
      break;

    case "config":
      await cmdConfig();
      break;

    case "join":
      await cmdJoin(args.slice(1));
      break;

    case "audit": {
      let limit = 100;
      const limitIdx = args.indexOf("--limit");
      if (limitIdx !== -1 && args[limitIdx + 1]) {
        limit = parseInt(args[limitIdx + 1], 10);
      }
      await cmdAudit(limit);
      break;
    }

    default:
      console.log("Usage: seed fleet <command>");
      console.log("");
      console.log("Commands:");
      console.log("  status              List all machines with health");
      console.log("  approve <id>        Approve a pending machine");
      console.log("  revoke <id>         Revoke an accepted machine");
      console.log("  config              Display current fleet config");
      console.log("  audit [--limit N]   Display recent audit entries");
      console.log(
        "  join <url> [--machine-id <id>] [--display-name <name>]  Register this machine with a control plane"
      );
      process.exit(command ? 1 : 0);
  }
}

// Only run main() when executed directly, not when imported by tests.
if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
  });
}
