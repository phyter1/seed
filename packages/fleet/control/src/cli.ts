/**
 * Seed Fleet CLI
 *
 * Usage:
 *   bun run src/cli.ts status
 *   bun run src/cli.ts approve <machine_id>
 *   bun run src/cli.ts revoke <machine_id>
 *   bun run src/cli.ts config
 *   bun run src/cli.ts audit [--limit N]
 *
 * Config:
 *   SEED_CONTROL_URL — control plane URL (default: http://localhost:4310)
 *   SEED_OPERATOR_TOKEN — operator bearer token
 */

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
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
