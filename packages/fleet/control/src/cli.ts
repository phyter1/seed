/**
 * Seed Fleet CLI
 *
 * Usage:
 *   bun run src/cli.ts configure [--control-url <url>] [--operator-token <token>]
 *   bun run src/cli.ts status
 *   bun run src/cli.ts approve <machine_id>
 *   bun run src/cli.ts revoke <machine_id>
 *   bun run src/cli.ts config
 *   bun run src/cli.ts audit [--limit N]
 *   bun run src/cli.ts join <control_url> [--machine-id <id>] [--display-name <name>]
 *
 * Config resolution (env vars win over the config file):
 *   SEED_CONTROL_URL — control plane URL (default: http://localhost:4310)
 *   SEED_OPERATOR_TOKEN — operator bearer token
 *   ~/.config/seed-fleet/cli.json — { control_url, operator_token }
 *   SEED_CLI_CONFIG — override path to cli.json
 */

import { generateToken, hashToken } from "./auth";
import { SEED_VERSION, SEED_REPO } from "./version";
import { fetchRelease, runSelfUpdate } from "./self-update";

const DEFAULT_CONTROL_URL = "http://localhost:4310";

function cliConfigPath(): string {
  return (
    process.env.SEED_CLI_CONFIG ??
    `${process.env.HOME}/.config/seed-fleet/cli.json`
  );
}

interface CliConfigFile {
  control_url?: string;
  operator_token?: string;
}

function readCliConfig(): CliConfigFile {
  try {
    const text = require("fs").readFileSync(cliConfigPath(), "utf-8");
    const parsed = JSON.parse(text);
    return {
      control_url: parsed.control_url,
      operator_token: parsed.operator_token,
    };
  } catch {
    return {};
  }
}

function getControlUrl(): string {
  return (
    process.env.SEED_CONTROL_URL ??
    readCliConfig().control_url ??
    DEFAULT_CONTROL_URL
  );
}

function getOperatorToken(): string | undefined {
  return process.env.SEED_OPERATOR_TOKEN ?? readCliConfig().operator_token;
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getOperatorToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function printConnectionHint(url: string): void {
  console.error(`Could not reach control plane at ${url}.`);
  console.error("");
  console.error("To point the CLI at a control plane, do one of:");
  console.error("  • seed fleet configure --control-url <url> --operator-token <token>");
  console.error("  • export SEED_CONTROL_URL=<url> SEED_OPERATOR_TOKEN=<token>");
  console.error("");
  console.error(`Current config file: ${cliConfigPath()}`);
}

function printAuthHint(url: string, status: number, hasToken: boolean): void {
  if (status === 401 && !hasToken) {
    console.error(`Control plane at ${url} requires an operator token.`);
  } else if (status === 401) {
    console.error(`Control plane at ${url} did not accept the operator token (401).`);
  } else {
    console.error(`Control plane at ${url} rejected the operator token (403).`);
    console.error("The token is present but wrong — likely stale or rotated.");
  }
  console.error("");
  console.error("Set the token with:");
  console.error("  • seed fleet configure --operator-token <token>");
  console.error("  • export SEED_OPERATOR_TOKEN=<token>");
}

async function apiGet(path: string): Promise<any> {
  const url = `${getControlUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: getHeaders() });
  } catch (err: any) {
    printConnectionHint(getControlUrl());
    process.exit(1);
  }
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      printAuthHint(getControlUrl(), res.status, Boolean(getOperatorToken()));
    } else {
      console.error(`Error ${res.status}: ${body}`);
    }
    process.exit(1);
  }
  return res.json();
}

async function apiPost(path: string, body?: any): Promise<any> {
  const url = `${getControlUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err: any) {
    printConnectionHint(getControlUrl());
    process.exit(1);
  }
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      printAuthHint(getControlUrl(), res.status, Boolean(getOperatorToken()));
    } else {
      console.error(`Error ${res.status}: ${text}`);
    }
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

  // Compare against this CLI's own version — assumes the operator
  // has at least as recent a build as the fleet should be running.
  const latest = SEED_VERSION;

  console.log(
    `${"ID".padEnd(12)} ${"STATUS".padEnd(10)} ${"CONNECTED".padEnd(11)} ${"ARCH".padEnd(10)} ${"MEM".padEnd(8)} ${"VERSION".padEnd(10)} ${"LAST SEEN"}`
  );
  console.log("-".repeat(90));

  for (const m of machines) {
    const connected = m.connected ? "yes" : "no";
    const arch = m.arch ?? "-";
    const mem = m.memory_gb ? `${m.memory_gb}GB` : "-";
    const lastSeen = m.last_seen
      ? new Date(m.last_seen + "Z").toLocaleString()
      : "-";
    const ver = m.agent_version ?? "-";
    const marker =
      m.agent_version && m.agent_version !== latest ? " ⚠" : "  ";
    const verCell = `${ver}${marker}`.padEnd(10);
    console.log(
      `${m.id.padEnd(12)} ${m.status.padEnd(10)} ${connected.padEnd(11)} ${arch.padEnd(10)} ${mem.padEnd(8)} ${verCell} ${lastSeen}`
    );
  }
  console.log("");
  console.log(`CLI version: ${SEED_VERSION}  (⚠ = agent behind CLI version)`);
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

interface InstallSessionRow {
  install_id: string;
  machine_id: string | null;
  target: string;
  os: string | null;
  arch: string | null;
  started_at: string;
  completed_at: string | null;
  status: string;
  steps_completed: number;
  steps_total: number | null;
  last_step: string | null;
  last_error: string | null;
}

interface InstallEventRow {
  id: number;
  install_id: string;
  timestamp: string;
  step: string;
  status: string;
  details: Record<string, unknown> | null;
}

function formatInstallRow(s: InstallSessionRow): string {
  const id = (s.install_id ?? "-").padEnd(32);
  const mid = (s.machine_id ?? "-").padEnd(10);
  const target = (s.target ?? "-").padEnd(14);
  const status = (s.status ?? "-").padEnd(12);
  const progress = s.steps_total
    ? `${s.steps_completed}/${s.steps_total}`
    : `${s.steps_completed}`;
  const progressPadded = progress.padEnd(7);
  const last = s.last_step ?? "-";
  return `${id} ${mid} ${target} ${status} ${progressPadded} ${last}`;
}

function printInstallTable(sessions: InstallSessionRow[]) {
  if (sessions.length === 0) {
    console.log("No install sessions.");
    return;
  }
  console.log(
    `${"INSTALL ID".padEnd(32)} ${"MACHINE".padEnd(10)} ${"TARGET".padEnd(14)} ${"STATUS".padEnd(12)} ${"STEPS".padEnd(7)} LAST STEP`
  );
  console.log("-".repeat(100));
  for (const s of sessions) console.log(formatInstallRow(s));
}

async function cmdInstalls(args: string[]) {
  let status: string | undefined;
  let follow = false;
  let events = false;
  let installId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--status" && args[i + 1]) {
      status = args[++i];
    } else if (a === "--follow") {
      follow = true;
    } else if (a === "--events") {
      events = true;
    } else if (!a.startsWith("--") && !installId) {
      installId = a;
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }

  if (installId) {
    // Detail view — optionally follow events
    if (events || follow) {
      let since: string | undefined;
      // First call: fetch all events, then poll with ?since=
      const initial = await apiGet(`/v1/installs/${installId}`);
      console.log(`Install: ${initial.session.install_id}`);
      console.log(
        `  machine: ${initial.session.machine_id ?? "-"}  target: ${initial.session.target}  status: ${initial.session.status}`
      );
      console.log(
        `  started: ${initial.session.started_at}  last_step: ${initial.session.last_step ?? "-"}`
      );
      if (initial.session.last_error) {
        console.log(`  error: ${initial.session.last_error}`);
      }
      console.log("");
      console.log("Events:");
      for (const e of initial.events as InstallEventRow[]) {
        console.log(
          `  ${e.timestamp} ${e.step.padEnd(24)} ${e.status.padEnd(10)} ${
            e.details ? JSON.stringify(e.details) : ""
          }`
        );
        since = e.timestamp;
      }
      if (!follow) return;

      // Poll for new events
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((r) => setTimeout(r, 2000));
        const qs = since ? `?since=${encodeURIComponent(since)}` : "";
        const res = await apiGet(`/v1/installs/${installId}/events${qs}`);
        for (const e of res.data as InstallEventRow[]) {
          console.log(
            `  ${e.timestamp} ${e.step.padEnd(24)} ${e.status.padEnd(10)} ${
              e.details ? JSON.stringify(e.details) : ""
            }`
          );
          since = e.timestamp;
        }
        // Stop polling if session finished
        const sessRes = await apiGet(`/v1/installs/${installId}`);
        const st = sessRes.session.status;
        if (st === "success" || st === "failed" || st === "aborted") {
          console.log(`\nInstall ${st}.`);
          return;
        }
      }
    } else {
      const data = await apiGet(`/v1/installs/${installId}`);
      const s = data.session as InstallSessionRow;
      console.log(formatInstallRow(s));
      if (s.last_error) console.log(`  error: ${s.last_error}`);
      console.log(`  (run with --events to see full event log)`);
      return;
    }
  }

  // List view
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  if (!follow) {
    const data = await apiGet(`/v1/installs${q}`);
    printInstallTable(data.data);
    return;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await apiGet(`/v1/installs${q}`);
    // Clear screen between polls
    process.stdout.write("\x1b[2J\x1b[H");
    console.log(`Fleet installs (refreshing every 2s, Ctrl-C to stop)`);
    console.log("");
    printInstallTable(data.data);
    await new Promise((r) => setTimeout(r, 2000));
  }
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
 * Write the operator CLI config to ~/.config/seed-fleet/cli.json.
 *
 * Merges with any existing config — passing only --control-url leaves
 * the existing operator_token in place, and vice versa. At least one
 * field must be provided.
 *
 * Exported so tests can exercise it with injected IO.
 */
export interface ConfigureOptions {
  controlUrl?: string;
  operatorToken?: string;
  configPath?: string;
  existing?: CliConfigFile;
  writeFile?: (path: string, contents: string, mode: number) => void;
  mkdirp?: (dir: string) => void;
  log?: (msg: string) => void;
}

export interface ConfigureResult {
  configPath: string;
  controlUrl: string;
  operatorTokenSet: boolean;
}

export async function runConfigure(
  opts: ConfigureOptions
): Promise<ConfigureResult> {
  const log = opts.log ?? ((m: string) => console.log(m));

  if (!opts.controlUrl && !opts.operatorToken) {
    throw new Error(
      "at least one of --control-url or --operator-token is required"
    );
  }

  const configPath = opts.configPath ?? cliConfigPath();
  const existing = opts.existing ?? readCliConfig();

  const merged: CliConfigFile = {
    control_url: opts.controlUrl ?? existing.control_url,
    operator_token: opts.operatorToken ?? existing.operator_token,
  };

  if (!merged.control_url) {
    throw new Error("control_url is required (no existing value to fall back to)");
  }

  const contents = JSON.stringify(merged, null, 2);

  if (opts.writeFile) {
    if (opts.mkdirp) opts.mkdirp(dirname(configPath));
    opts.writeFile(configPath, contents, 0o600);
  } else {
    const fs = require("fs");
    fs.mkdirSync(dirname(configPath), { recursive: true });
    const tmp = configPath + ".tmp";
    fs.writeFileSync(tmp, contents, { mode: 0o600 });
    fs.renameSync(tmp, configPath);
  }

  log(`Wrote ${configPath}`);
  log(`  control_url:    ${merged.control_url}`);
  log(`  operator_token: ${merged.operator_token ? "[set]" : "[unset]"}`);

  return {
    configPath,
    controlUrl: merged.control_url,
    operatorTokenSet: Boolean(merged.operator_token),
  };
}

async function cmdConfigure(args: string[]) {
  let controlUrl: string | undefined;
  let operatorToken: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--control-url" && args[i + 1]) {
      controlUrl = args[++i];
    } else if (a === "--operator-token" && args[i + 1]) {
      operatorToken = args[++i];
    } else {
      console.error(`Unknown argument: ${a}`);
      console.error(
        "Usage: seed fleet configure [--control-url <url>] [--operator-token <token>]"
      );
      process.exit(1);
    }
  }

  try {
    await runConfigure({ controlUrl, operatorToken });
  } catch (err: any) {
    console.error(`Error: ${err?.message ?? err}`);
    process.exit(1);
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

// --- Fleet Upgrade ---

interface FleetMachineRow {
  id: string;
  status: string;
  connected?: boolean;
  arch: string | null;
  platform: string | null;
  agent_version: string | null;
}

interface UpgradeOptions {
  targetVersion?: string; // tag like "v0.3.0"; default latest
  machineId?: string; // upgrade only this machine
  dryRun: boolean;
  parallel: number; // how many to dispatch concurrently
  timeoutMs: number; // per-machine version-landed timeout
}

function parseUpgradeArgs(args: string[]): UpgradeOptions {
  const opts: UpgradeOptions = {
    dryRun: false,
    parallel: 1,
    timeoutMs: 120_000,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--version" && args[i + 1]) {
      opts.targetVersion = args[++i];
    } else if (a === "--machine" && args[i + 1]) {
      opts.machineId = args[++i];
    } else if (a === "--dry-run") {
      opts.dryRun = true;
    } else if (a === "--parallel" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (!isNaN(n) && n > 0) opts.parallel = n;
    } else if (a === "--timeout" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (!isNaN(n) && n > 0) opts.timeoutMs = n * 1000;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: seed fleet upgrade [--version <tag>] [--machine <id>] [--dry-run] [--parallel N] [--timeout SECONDS]"
      );
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return opts;
}

async function waitForVersion(
  machineId: string,
  targetVersion: string,
  timeoutMs: number
): Promise<{ ok: boolean; observed: string | null }> {
  const deadline = Date.now() + timeoutMs;
  let lastObserved: string | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const m = (await apiGet(
        `/v1/fleet/${machineId}`
      )) as FleetMachineRow & { connected?: boolean };
      lastObserved = m.agent_version ?? null;
      if (m.connected && m.agent_version === targetVersion) {
        return { ok: true, observed: lastObserved };
      }
    } catch {
      // connection dropped during upgrade is expected; keep polling
    }
  }
  return { ok: false, observed: lastObserved };
}

async function upgradeOneMachine(
  machineId: string,
  tag: string,
  targetVersion: string,
  timeoutMs: number
): Promise<{ machineId: string; ok: boolean; message: string }> {
  process.stdout.write(`  ${machineId}: dispatching agent.update ${tag}... `);
  try {
    await apiPost(`/v1/fleet/${machineId}/command`, {
      action: "agent.update",
      params: { version: tag },
      timeout_ms: 60_000,
    });
  } catch (err: any) {
    const message = `dispatch failed: ${err?.message ?? err}`;
    console.log(`FAIL (${message})`);
    return { machineId, ok: false, message };
  }
  process.stdout.write("dispatched. waiting for reconnect... ");
  const { ok, observed } = await waitForVersion(
    machineId,
    targetVersion,
    timeoutMs
  );
  if (ok) {
    console.log(`OK (${observed})`);
    return { machineId, ok: true, message: `upgraded to ${observed}` };
  }
  console.log(`TIMEOUT (last observed: ${observed ?? "none"})`);
  return {
    machineId,
    ok: false,
    message: `timeout; last observed version: ${observed ?? "none"}`,
  };
}

async function cmdUpgrade(args: string[]) {
  const opts = parseUpgradeArgs(args);

  // Resolve target release via the GitHub API.
  console.log(
    `Resolving release ${opts.targetVersion ?? "latest"} from ${SEED_REPO}...`
  );
  const release = await fetchRelease(opts.targetVersion ?? "latest");
  console.log(`Target: ${release.tag} (${release.version})`);

  // List machines.
  const machines = (await apiGet("/v1/fleet")) as FleetMachineRow[];
  let candidates = machines.filter((m) => m.connected && m.status === "accepted");
  if (opts.machineId) {
    candidates = candidates.filter((m) => m.id === opts.machineId);
    if (candidates.length === 0) {
      console.error(
        `machine '${opts.machineId}' is not a connected, accepted fleet member`
      );
      process.exit(1);
    }
  }

  const toUpgrade = candidates.filter(
    (m) => m.agent_version !== release.version
  );
  const skipped = candidates.filter(
    (m) => m.agent_version === release.version
  );

  console.log("");
  console.log("Plan:");
  for (const m of toUpgrade) {
    console.log(
      `  [upgrade] ${m.id}: ${m.agent_version ?? "unknown"} -> ${release.version}`
    );
  }
  for (const m of skipped) {
    console.log(`  [skip]    ${m.id}: already at ${release.version}`);
  }
  const disconnected = machines.filter(
    (m) => !m.connected && m.status === "accepted"
  );
  if (!opts.machineId) {
    for (const m of disconnected) {
      console.log(`  [offline] ${m.id}: not connected, skipping`);
    }
  }

  if (opts.dryRun || toUpgrade.length === 0) {
    if (toUpgrade.length === 0) console.log("\nNothing to do.");
    return;
  }

  console.log("");
  console.log(`Upgrading ${toUpgrade.length} machine(s)...`);

  // Process in batches of opts.parallel.
  const results: Array<{ machineId: string; ok: boolean; message: string }> = [];
  for (let i = 0; i < toUpgrade.length; i += opts.parallel) {
    const batch = toUpgrade.slice(i, i + opts.parallel);
    const batchResults = await Promise.all(
      batch.map((m) =>
        upgradeOneMachine(m.id, release.tag, release.version, opts.timeoutMs)
      )
    );
    results.push(...batchResults);
  }

  console.log("");
  console.log("Summary:");
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  for (const r of ok) console.log(`  ✓ ${r.machineId}: ${r.message}`);
  for (const r of failed) console.log(`  ✗ ${r.machineId}: ${r.message}`);
  if (failed.length > 0) process.exit(1);
}

// --- Self-update (for the CLI binary itself) ---

async function cmdSelfUpdate(args: string[]) {
  let version: string | undefined;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--version" && args[i + 1]) {
      version = args[++i];
    } else if (a === "--force") {
      force = true;
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }
  try {
    const result = await runSelfUpdate({
      binary: "seed-cli",
      version,
      currentVersion: SEED_VERSION,
      force,
    });
    if (result.updated) {
      console.log(
        `seed-cli updated ${result.fromVersion} -> ${result.toVersion}`
      );
    }
  } catch (err: any) {
    console.error(`self-update failed: ${err?.message ?? err}`);
    process.exit(1);
  }
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
  const rawArgs = process.argv.slice(2);
  // Accept both "seed status" and "seed fleet status" — strip leading "fleet" if present
  const args = rawArgs[0] === "fleet" ? rawArgs.slice(1) : rawArgs;
  const command = args[0];

  switch (command) {
    case "configure":
      await cmdConfigure(args.slice(1));
      break;

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

    case "upgrade":
      await cmdUpgrade(args.slice(1));
      break;

    case "self-update":
      await cmdSelfUpdate(args.slice(1));
      break;

    case "version":
    case "--version":
      console.log(SEED_VERSION);
      break;

    case "installs":
      await cmdInstalls(args.slice(1));
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
      console.log(
        "  configure [--control-url <url>] [--operator-token <token>]"
      );
      console.log("                      Write ~/.config/seed-fleet/cli.json");
      console.log("  status              List all machines with health");
      console.log("  approve <id>        Approve a pending machine");
      console.log("  revoke <id>         Revoke an accepted machine");
      console.log("  config              Display current fleet config");
      console.log("  audit [--limit N]   Display recent audit entries");
      console.log(
        "  upgrade [--version <tag>] [--machine <id>] [--dry-run] [--parallel N]"
      );
      console.log("                      Roll out a new agent version across the fleet");
      console.log("  self-update [--version <tag>] [--force]");
      console.log("                      Update the seed CLI binary in place");
      console.log("  version             Print CLI version");
      console.log(
        "  installs [<install_id>] [--status S] [--follow] [--events]"
      );
      console.log("                      Observe install sessions");
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
