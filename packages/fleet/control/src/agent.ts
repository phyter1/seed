/**
 * Seed Fleet Agent
 *
 * Lightweight daemon that runs on each fleet machine.
 * Maintains a WebSocket connection to the control plane,
 * reports health, executes whitelisted commands, and caches config.
 *
 * Usage:
 *   bun run src/agent.ts
 *
 * Config source (in order of precedence):
 *   1. Environment variables: SEED_CONTROL_URL, SEED_MACHINE_ID, SEED_AGENT_TOKEN
 *   2. Config file: ~/.config/seed-fleet/agent.json
 */

import { Hono } from "hono";
import type {
  ControlMessage,
  AgentMessage,
  AnnounceMessage,
  HealthMessage,
  CommandResultMessage,
  ConfigAckMessage,
  MachineConfig,
  ServiceConfig,
  HealthTier,
  ServiceHealth,
  LoadedModel,
  GpuMetrics,
  ActionName,
  CommandEnvelope,
  ProxyConfig,
} from "./types";
import { ACTION_WHITELIST, DEFAULT_PROXY_CONFIG } from "./types";
import { createProxy, type ProxyHandle, type WsSender } from "./proxy";
import { SEED_VERSION } from "./version";
import { runSelfUpdate } from "./self-update";
import { WorkloadDB } from "./workload-db";
import { createLaunchdDriver } from "./supervisors/launchd";
import {
  reconcile as reconcileWorkloads,
  type ReconcileSummary,
} from "./workload-runner";
import type { WorkloadDeclaration } from "./types";

function summarizeReconcile(s: ReconcileSummary): string {
  const parts: string[] = [];
  if (s.installed.length) parts.push(`installed=${s.installed.join(",")}`);
  if (s.upgraded.length) parts.push(`upgraded=${s.upgraded.join(",")}`);
  if (s.reloaded.length) parts.push(`reloaded=${s.reloaded.join(",")}`);
  if (s.failed.length)
    parts.push(`failed=${s.failed.map((f) => f.workload_id).join(",")}`);
  if (s.skipped.length) parts.push(`skipped=${s.skipped.join(",")}`);
  return parts.length ? parts.join(" ") : "no changes";
}

const AGENT_VERSION = SEED_VERSION;
const HEALTH_INTERVAL_MS = 30_000;
const BREAK_GLASS_PORT = 4311;

// --- Config Loading ---

interface AgentRunConfig {
  machineId: string;
  controlUrl: string;
  token: string | null;
  proxy: ProxyConfig;
}

function resolveProxyConfig(
  fileProxy: Partial<ProxyConfig> | undefined
): ProxyConfig {
  // Env-var overrides layer on top of file config and defaults.
  const envPort = process.env.SEED_PROXY_PORT
    ? Number(process.env.SEED_PROXY_PORT)
    : undefined;
  const envEnabled = process.env.SEED_PROXY_ENABLED
    ? process.env.SEED_PROXY_ENABLED !== "false"
    : undefined;
  const envBufferMax = process.env.SEED_PROXY_BUFFER_MAX
    ? Number(process.env.SEED_PROXY_BUFFER_MAX)
    : undefined;

  return {
    ...DEFAULT_PROXY_CONFIG,
    ...(fileProxy ?? {}),
    ...(envEnabled !== undefined ? { enabled: envEnabled } : {}),
    ...(envPort !== undefined && !isNaN(envPort) ? { listen_port: envPort } : {}),
    ...(envBufferMax !== undefined && !isNaN(envBufferMax)
      ? { buffer_max: envBufferMax }
      : {}),
  };
}

function loadConfig(): AgentRunConfig {
  // Env vars take precedence
  const machineId = process.env.SEED_MACHINE_ID;
  const controlUrl = process.env.SEED_CONTROL_URL;
  const token = process.env.SEED_AGENT_TOKEN ?? null;

  // Fall back to config file — always read it if it exists so we can
  // pick up the proxy block even when machine_id/control_url come
  // from env vars.
  const configPath =
    process.env.SEED_AGENT_CONFIG ??
    `${process.env.HOME}/.config/seed-fleet/agent.json`;
  let fileConfig: {
    machine_id?: string;
    control_url?: string;
    token?: string;
    proxy?: Partial<ProxyConfig>;
  } = {};
  try {
    const text = require("fs").readFileSync(configPath, "utf-8");
    fileConfig = JSON.parse(text);
  } catch {
    // no file — fine, we may still have env vars
  }

  const resolvedMachineId = machineId ?? fileConfig.machine_id;
  const resolvedControlUrl = controlUrl ?? fileConfig.control_url;
  const resolvedToken = token ?? fileConfig.token ?? null;

  if (!resolvedMachineId || !resolvedControlUrl) {
    console.error(
      "SEED_MACHINE_ID and SEED_CONTROL_URL are required (env vars or ~/.config/seed-fleet/agent.json)"
    );
    process.exit(1);
  }

  return {
    machineId: resolvedMachineId,
    controlUrl: resolvedControlUrl,
    token: resolvedToken,
    proxy: resolveProxyConfig(fileConfig.proxy),
  };
}

// --- Cached Config ---

let cachedConfig: MachineConfig | null = null;
let cachedConfigVersion = 0;

const CONFIG_CACHE_PATH =
  process.env.SEED_CONFIG_CACHE ??
  `${process.env.HOME}/.config/seed-fleet/config.json`;

function loadCachedConfig(): void {
  try {
    const text = require("fs").readFileSync(CONFIG_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(text);
    cachedConfig = parsed.config ?? null;
    cachedConfigVersion = parsed.version ?? 0;
    console.log(
      `[agent] loaded cached config v${cachedConfigVersion}`
    );
  } catch {
    console.log("[agent] no cached config found");
  }
}

function saveCachedConfig(config: MachineConfig, version: number): void {
  const fs = require("fs");
  const path = require("path");
  const dir = path.dirname(CONFIG_CACHE_PATH);
  fs.mkdirSync(dir, { recursive: true });

  // Atomic write: write to temp, then rename
  const tmpPath = CONFIG_CACHE_PATH + ".tmp";
  fs.writeFileSync(
    tmpPath,
    JSON.stringify({ config, version }, null, 2),
    { mode: 0o600 }
  );
  fs.renameSync(tmpPath, CONFIG_CACHE_PATH);
  console.log(`[agent] config v${version} cached to disk`);
}

// --- Save Agent Token ---

function saveAgentToken(token: string, machineId: string, controlUrl: string): void {
  const fs = require("fs");
  const path = require("path");
  const configPath =
    process.env.SEED_AGENT_CONFIG ??
    `${process.env.HOME}/.config/seed-fleet/agent.json`;
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = configPath + ".tmp";
  fs.writeFileSync(
    tmpPath,
    JSON.stringify({ machine_id: machineId, control_url: controlUrl, token }, null, 2),
    { mode: 0o600 }
  );
  fs.renameSync(tmpPath, configPath);
  console.log(`[agent] token saved to ${configPath}`);
}

// --- System Info ---

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

async function getHostname(): Promise<string> {
  const proc = Bun.spawn(["hostname"], { stdout: "pipe" });
  return (await readStream(proc.stdout)).trim();
}

async function getArch(): Promise<string> {
  const proc = Bun.spawn(["uname", "-m"], { stdout: "pipe" });
  return (await readStream(proc.stdout)).trim();
}

async function getPlatform(): Promise<string> {
  const proc = Bun.spawn(["uname", "-s"], { stdout: "pipe" });
  return (await readStream(proc.stdout)).trim().toLowerCase();
}

async function getCpuCores(): Promise<number> {
  // Try platform-appropriate command first, with try/catch because
  // Bun.spawn throws ENOENT when the binary doesn't exist.
  if (process.platform === "darwin") {
    try {
      const proc = Bun.spawn(["sysctl", "-n", "hw.ncpu"], { stdout: "pipe" });
      const n = parseInt((await readStream(proc.stdout)).trim(), 10);
      if (!isNaN(n)) return n;
    } catch {}
  } else {
    try {
      const proc = Bun.spawn(["nproc"], { stdout: "pipe" });
      const n = parseInt((await readStream(proc.stdout)).trim(), 10);
      if (!isNaN(n)) return n;
    } catch {}
  }
  return 1;
}

async function getMemoryGB(): Promise<number> {
  try {
    // macOS
    const proc = Bun.spawn(["sysctl", "-n", "hw.memsize"], { stdout: "pipe" });
    const bytes = parseInt((await readStream(proc.stdout)).trim(), 10);
    if (!isNaN(bytes)) return Math.round((bytes / 1073741824) * 10) / 10;
  } catch {}
  try {
    // Linux
    const text = require("fs").readFileSync("/proc/meminfo", "utf-8");
    const match = text.match(/MemTotal:\s+(\d+)\s+kB/);
    if (match) return Math.round((parseInt(match[1], 10) / 1048576) * 10) / 10;
  } catch {}
  return 0;
}

// --- Health Collection ---

async function collectSystemMetrics(): Promise<{
  cpu_percent: number;
  memory_used_gb: number;
  memory_total_gb: number;
  disk_free_gb: number;
}> {
  const totalGb = await getMemoryGB();

  // CPU percent (rough — 1 second sample)
  let cpuPercent = 0;
  try {
    // Use `top` for a quick snapshot on macOS or `cat /proc/stat` on Linux
    const platform = process.platform;
    if (platform === "darwin") {
      const proc = Bun.spawn(
        ["ps", "-A", "-o", "%cpu"],
        { stdout: "pipe" }
      );
      const text = await readStream(proc.stdout);
      const lines = text.trim().split("\n").slice(1);
      cpuPercent = lines.reduce((sum, line) => sum + parseFloat(line.trim() || "0"), 0);
      cpuPercent = Math.min(100, Math.round(cpuPercent * 10) / 10);
    }
  } catch {}

  // Memory used
  let memUsedGb = 0;
  try {
    if (process.platform === "darwin") {
      const proc = Bun.spawn(["vm_stat"], { stdout: "pipe" });
      const text = await readStream(proc.stdout);
      const pageSize = 16384; // typical on M1
      const activeMatch = text.match(/Pages active:\s+(\d+)/);
      const wiredMatch = text.match(/Pages wired down:\s+(\d+)/);
      const compressedMatch = text.match(/Pages occupied by compressor:\s+(\d+)/);
      const active = parseInt(activeMatch?.[1] ?? "0", 10);
      const wired = parseInt(wiredMatch?.[1] ?? "0", 10);
      const compressed = parseInt(compressedMatch?.[1] ?? "0", 10);
      memUsedGb =
        Math.round(((active + wired + compressed) * pageSize) / 1073741824 * 10) / 10;
    }
  } catch {}

  // Disk free
  let diskFreeGb = 0;
  try {
    const proc = Bun.spawn(["df", "-g", "/"], { stdout: "pipe" });
    const text = await readStream(proc.stdout);
    const lines = text.trim().split("\n");
    if (lines.length > 1) {
      const parts = lines[1].trim().split(/\s+/);
      diskFreeGb = parseInt(parts[3] ?? "0", 10);
    }
  } catch {}

  return {
    cpu_percent: cpuPercent,
    memory_used_gb: memUsedGb,
    memory_total_gb: totalGb,
    disk_free_gb: diskFreeGb,
  };
}

async function probeService(
  service: ServiceConfig
): Promise<ServiceHealth> {
  const result: ServiceHealth = {
    id: service.id,
    health_tier: "process_alive",
    port: service.port,
    details: {},
  };

  if (service.probe.type === "process") {
    // Just check if port is reachable
    try {
      const sock = await Bun.connect({
        hostname: "localhost",
        port: service.port,
        socket: {
          data() {},
          open(socket) { socket.end(); },
          error() {},
          close() {},
        },
      });
      result.health_tier = "accepting_connections";
    } catch {
      result.health_tier = "process_alive";
      result.details = { error: "port not reachable" };
    }
    return result;
  }

  if (service.probe.type === "tcp") {
    try {
      const sock = await Bun.connect({
        hostname: "localhost",
        port: service.port,
        socket: {
          data() {},
          open(socket) { socket.end(); },
          error() {},
          close() {},
        },
      });
      result.health_tier = "accepting_connections";
    } catch {
      result.details = { error: "connection refused" };
    }
    return result;
  }

  if (service.probe.type === "http") {
    const url = `http://localhost:${service.port}${service.probe.path ?? "/"}`;
    const start = performance.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const elapsed = performance.now() - start;
      if (res.ok) {
        result.health_tier = elapsed < 2000 ? "within_sla" : "serving_requests";
        result.details = { status: res.status, latency_ms: Math.round(elapsed) };
      } else {
        result.health_tier = "accepting_connections";
        result.details = { status: res.status };
      }
    } catch (err: any) {
      result.details = { error: err?.message ?? "probe failed" };
    }
    return result;
  }

  return result;
}

async function collectGpuMetrics(): Promise<GpuMetrics | undefined> {
  // nvidia-smi is the only supported path — available on Linux hosts with
  // NVIDIA drivers. macOS and GPU-less Linux leave this field undefined.
  try {
    const proc = Bun.spawn(
      [
        "nvidia-smi",
        "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
        "--format=csv,noheader,nounits",
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    const text = (await readStream(proc.stdout)).trim();
    await proc.exited;
    if (proc.exitCode !== 0 || !text) return undefined;

    // Use the first GPU only. Values: name, util%, used_mib, total_mib, temp_c.
    const line = text.split("\n")[0]?.trim();
    if (!line) return undefined;
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 5) return undefined;

    const name = parts[0];
    const utilization = parseFloat(parts[1]);
    const usedMib = parseFloat(parts[2]);
    const totalMib = parseFloat(parts[3]);
    const tempC = parseFloat(parts[4]);

    if (
      !name ||
      isNaN(utilization) ||
      isNaN(usedMib) ||
      isNaN(totalMib) ||
      isNaN(tempC)
    ) {
      return undefined;
    }

    return {
      name,
      utilization_percent: Math.round(utilization * 10) / 10,
      vram_used_gb: Math.round((usedMib / 1024) * 10) / 10,
      vram_total_gb: Math.round((totalMib / 1024) * 10) / 10,
      temperature_c: Math.round(tempC),
    };
  } catch {
    return undefined;
  }
}

async function collectLoadedModels(): Promise<LoadedModel[]> {
  const models: LoadedModel[] = [];

  // Probe Ollama
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      for (const m of data.models ?? []) {
        models.push({
          name: m.name,
          runtime: "ollama",
          loaded: true,
          size_gb: m.size ? Math.round((m.size / 1073741824) * 10) / 10 : undefined,
        });
      }
    }
  } catch {}

  // Probe MLX
  try {
    const res = await fetch("http://localhost:8080/v1/models", {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      for (const m of data.data ?? []) {
        models.push({
          name: m.id,
          runtime: "mlx",
          loaded: true,
        });
      }
    }
  } catch {}

  return models;
}

// --- Command Executor ---

type CommandHandler = (
  params: Record<string, unknown>
) => Promise<{ success: boolean; output: string }>;

function createCommandHandlers(): Map<string, CommandHandler> {
  const handlers = new Map<string, CommandHandler>();

  handlers.set("service.status", async (params) => {
    const serviceId = params.service_id as string;
    if (!serviceId) return { success: false, output: "service_id required" };
    const service = cachedConfig?.services.find((s) => s.id === serviceId);
    if (!service) return { success: false, output: `unknown service: ${serviceId}` };
    const health = await probeService(service);
    return { success: true, output: JSON.stringify(health) };
  });

  handlers.set("model.list", async () => {
    const models = await collectLoadedModels();
    return { success: true, output: JSON.stringify(models) };
  });

  handlers.set("config.report", async () => {
    return {
      success: true,
      output: JSON.stringify({
        config: cachedConfig,
        version: cachedConfigVersion,
      }),
    };
  });

  handlers.set("health.report", async () => {
    return {
      success: true,
      output: "health report triggered",
    };
  });

  handlers.set("config.apply", async (params) => {
    const config = params.config as MachineConfig | undefined;
    const version = params.version as number | undefined;
    if (!config || version === undefined)
      return { success: false, output: "config and version required" };
    cachedConfig = config;
    cachedConfigVersion = version;
    saveCachedConfig(config, version);
    return { success: true, output: `config v${version} applied` };
  });

  handlers.set("agent.restart", async () => {
    console.log("[agent] restart requested, exiting for supervisor to restart...");
    setTimeout(() => process.exit(0), 500);
    return { success: true, output: "restarting" };
  });

  handlers.set("agent.update", async (params) => {
    const version =
      typeof params.version === "string" ? params.version : undefined;
    const force = params.force === true;
    try {
      const result = await runSelfUpdate({
        binary: "seed-agent",
        version,
        currentVersion: AGENT_VERSION,
        force,
      });
      if (result.updated) {
        // Exit shortly after responding so the supervisor restarts us
        // with the new binary. 1s gives the result message time to flush
        // over the WebSocket.
        setTimeout(() => {
          console.log(
            "[agent] exiting after self-update, supervisor will restart"
          );
          process.exit(0);
        }, 1000);
        return {
          success: true,
          output: `updated ${result.fromVersion} -> ${result.toVersion}, restarting`,
        };
      }
      return {
        success: true,
        output: `already at ${result.toVersion}, no-op`,
      };
    } catch (err: any) {
      return {
        success: false,
        output: `self-update failed: ${err?.message ?? err}`,
      };
    }
  });

  // Stub handlers for actions that need OS-level integration
  for (const action of [
    "service.start", "service.stop", "service.restart",
    "model.load", "model.unload", "model.swap",
    "repo.pull",
  ] as const) {
    handlers.set(action, async (params) => {
      // Validate params have required fields based on action
      if (action.startsWith("service.") && !params.service_id) {
        return { success: false, output: "service_id required" };
      }
      if (action.startsWith("model.") && !params.model_name && !params.load && !params.unload) {
        return { success: false, output: "model params required" };
      }
      if (action === "repo.pull" && !params.repo_id) {
        return { success: false, output: "repo_id required" };
      }

      // Validate against cached config
      if (params.service_id && cachedConfig) {
        const known = cachedConfig.services.find((s) => s.id === params.service_id);
        if (!known) return { success: false, output: `unknown service: ${params.service_id}` };
      }
      if (params.model_name && cachedConfig) {
        const known = cachedConfig.models.find((m) => m.name === params.model_name);
        if (!known) return { success: false, output: `unknown model: ${params.model_name}` };
      }
      if (params.repo_id && cachedConfig) {
        const known = cachedConfig.repos.find((r) => r.id === params.repo_id);
        if (!known) return { success: false, output: `unknown repo: ${params.repo_id}` };
      }

      return { success: false, output: `${action}: not yet implemented` };
    });
  }

  return handlers;
}

// --- Backoff ---

function jitteredBackoff(attempt: number): number {
  const base = 1000;
  const multiplier = 2;
  const maxDelay = 60_000;
  const jitterFactor = 0.3;

  const delay = Math.min(base * Math.pow(multiplier, attempt), maxDelay);
  const jitter = delay * jitterFactor * (Math.random() * 2 - 1);
  return Math.max(100, Math.round(delay + jitter));
}

// --- Main Agent ---

async function runAgent() {
  const config = loadConfig();
  loadCachedConfig();

  const hostname = await getHostname();
  const arch = await getArch();
  const platform = await getPlatform();
  const cpuCores = await getCpuCores();
  const memoryGb = await getMemoryGB();
  const commandHandlers = createCommandHandlers();

  // --- Workload Infrastructure ---
  // Only wire up workloads on macOS for Phase 1 (launchd-only driver).
  // Linux agents keep working; they just can't install workloads yet.
  const workloadsEnabled = process.platform === "darwin";
  const workloadDbPath = `${process.env.HOME}/.local/share/seed/workloads.db`;
  const workloadDb = workloadsEnabled ? new WorkloadDB(workloadDbPath) : null;
  const supervisorDriver = workloadsEnabled ? createLaunchdDriver() : null;

  async function runWorkloadReconcile(
    source: string
  ): Promise<{ summary: ReturnType<typeof summarizeReconcile>; raw: any } | null> {
    if (!workloadDb || !supervisorDriver) return null;
    const declared = (cachedConfig?.workloads ?? []) as WorkloadDeclaration[];
    const raw = await reconcileWorkloads(declared, {
      db: workloadDb,
      driver: supervisorDriver,
      installerOpts: { driver: supervisorDriver },
    });
    const summary = summarizeReconcile(raw);
    console.log(`[workloads] reconcile (${source}): ${summary}`);
    return { summary, raw };
  }

  // Register workload.* action handlers now that we have the DB/driver.
  if (workloadDb && supervisorDriver) {
    commandHandlers.set("workload.reconcile", async () => {
      const out = await runWorkloadReconcile("command");
      return { success: true, output: JSON.stringify(out?.raw ?? {}) };
    });

    commandHandlers.set("workload.install", async (params) => {
      const workloadId = params.workload_id as string | undefined;
      if (!workloadId) {
        return { success: false, output: "workload_id required" };
      }
      const declared = (cachedConfig?.workloads ?? []) as WorkloadDeclaration[];
      const decl = declared.find((d) => d.id === workloadId);
      if (!decl) {
        return {
          success: false,
          output: `workload ${workloadId} not declared for this machine`,
        };
      }
      const out = await reconcileWorkloads([decl], {
        db: workloadDb,
        driver: supervisorDriver,
        installerOpts: { driver: supervisorDriver },
      });
      return { success: true, output: JSON.stringify(out) };
    });

    commandHandlers.set("workload.status", async (params) => {
      const workloadId = params.workload_id as string | undefined;
      if (workloadId) {
        const r = workloadDb.get(workloadId);
        if (!r) return { success: false, output: `no record for ${workloadId}` };
        return { success: true, output: JSON.stringify(r) };
      }
      return { success: true, output: JSON.stringify(workloadDb.list()) };
    });

    commandHandlers.set("workload.reload", async (params) => {
      const workloadId = params.workload_id as string | undefined;
      if (!workloadId) {
        return { success: false, output: "workload_id required" };
      }
      const r = workloadDb.get(workloadId);
      if (!r) return { success: false, output: `not installed: ${workloadId}` };
      const plistPath = `${process.env.HOME}/Library/LaunchAgents/${r.supervisor_label}.plist`;
      try {
        await supervisorDriver.unload(r.supervisor_label);
        await supervisorDriver.load(r.supervisor_label, plistPath);
        workloadDb.updateState(workloadId, "loaded", null);
        return { success: true, output: `reloaded ${workloadId}` };
      } catch (err: any) {
        workloadDb.updateState(workloadId, "install_failed", err?.message ?? String(err));
        return { success: false, output: err?.message ?? String(err) };
      }
    });

    commandHandlers.set("workload.remove", async (params) => {
      const workloadId = params.workload_id as string | undefined;
      if (!workloadId) {
        return { success: false, output: "workload_id required" };
      }
      const r = workloadDb.get(workloadId);
      if (!r) return { success: true, output: `not installed: ${workloadId}` };
      try {
        await supervisorDriver.unload(r.supervisor_label);
        workloadDb.delete(workloadId);
        return { success: true, output: `removed ${workloadId}` };
      } catch (err: any) {
        return { success: false, output: err?.message ?? String(err) };
      }
    });
  }

  console.log(`[agent] starting`);
  console.log(`  Machine ID: ${config.machineId}`);
  console.log(`  Control:    ${config.controlUrl}`);
  console.log(`  Hostname:   ${hostname}`);
  console.log(`  Platform:   ${platform}/${arch}`);
  console.log(`  Memory:     ${memoryGb}GB`);
  console.log(`  Token:      ${config.token ? "configured" : "none (will register as pending)"}`);

  let ws: WebSocket | null = null;
  let connected = false;
  let attempt = 0;
  let healthInterval: ReturnType<typeof setInterval> | null = null;
  // Track current token (may be updated when approved)
  let currentToken = config.token;
  let proxyHandle: ProxyHandle | null = null;

  function buildWsUrl(): string {
    const base = config.controlUrl.replace(/\/$/, "");
    const wsBase = base.replace(/^http/, "ws");
    return `${wsBase}/ws?machine_id=${config.machineId}`;
  }

  async function sendHealth() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const system = await collectSystemMetrics();
    const services: ServiceHealth[] = [];

    if (cachedConfig) {
      for (const svc of cachedConfig.services) {
        services.push(await probeService(svc));
      }
    }

    const models = await collectLoadedModels();
    const gpu = await collectGpuMetrics();

    const msg: HealthMessage = {
      type: "health",
      machine_id: config.machineId,
      timestamp: new Date().toISOString(),
      system,
      services,
      models,
      ...(gpu !== undefined ? { gpu } : {}),
    };
    ws.send(JSON.stringify(msg));
  }

  async function handleCommand(cmd: CommandEnvelope) {
    // Validate target
    if (cmd.target !== config.machineId) {
      console.warn(`[agent] command target mismatch: ${cmd.target} !== ${config.machineId}`);
      return;
    }

    // Validate action whitelist
    if (!ACTION_WHITELIST.includes(cmd.action as any)) {
      const result: CommandResultMessage = {
        type: "command_result",
        command_id: cmd.command_id,
        success: false,
        output: `rejected: unknown action '${cmd.action}'`,
        duration_ms: 0,
      };
      ws?.send(JSON.stringify(result));
      return;
    }

    const handler = commandHandlers.get(cmd.action);
    if (!handler) {
      const result: CommandResultMessage = {
        type: "command_result",
        command_id: cmd.command_id,
        success: false,
        output: `no handler for action '${cmd.action}'`,
        duration_ms: 0,
      };
      ws?.send(JSON.stringify(result));
      return;
    }

    const start = performance.now();

    // Enforce timeout
    const timeoutMs = cmd.timeout_ms ?? 30_000;
    try {
      const resultPromise = handler(cmd.params);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("command timeout")), timeoutMs)
      );
      const { success, output } = await Promise.race([resultPromise, timeoutPromise]);

      const result: CommandResultMessage = {
        type: "command_result",
        command_id: cmd.command_id,
        success,
        output,
        duration_ms: Math.round(performance.now() - start),
      };
      ws?.send(JSON.stringify(result));

      // If it was a health.report trigger, send a health report
      if (cmd.action === "health.report") {
        await sendHealth();
      }
    } catch (err: any) {
      const result: CommandResultMessage = {
        type: "command_result",
        command_id: cmd.command_id,
        success: false,
        output: err?.message ?? String(err),
        duration_ms: Math.round(performance.now() - start),
      };
      ws?.send(JSON.stringify(result));
    }
  }

  function connect() {
    const url = buildWsUrl();
    console.log(`[agent] connecting to ${url} (attempt ${attempt + 1})`);

    const headers: Record<string, string> = {};
    if (currentToken) {
      headers["Authorization"] = `Bearer ${currentToken}`;
    }

    try {
      ws = new WebSocket(url, { headers } as any);
    } catch {
      // Some environments don't support headers in WebSocket constructor
      ws = new WebSocket(url);
    }

    ws.onopen = () => {
      connected = true;
      attempt = 0;
      console.log("[agent] connected to control plane");

      // Send announce
      const announce: AnnounceMessage = {
        type: "announce",
        machine_id: config.machineId,
        hostname,
        arch,
        cpu_cores: cpuCores,
        memory_gb: memoryGb,
        platform,
        agent_version: AGENT_VERSION,
        config_version: cachedConfigVersion,
        capabilities: detectCapabilities(),
      };
      ws!.send(JSON.stringify(announce));

      // Start health reporting
      if (healthInterval) clearInterval(healthInterval);
      healthInterval = setInterval(sendHealth, HEALTH_INTERVAL_MS);
      // Send initial health immediately
      sendHealth();

      // Drain any events that were buffered while disconnected.
      if (proxyHandle) {
        proxyHandle.forwarder.flush();
      }
    };

    ws.onmessage = async (event) => {
      let msg: ControlMessage & { type: string; token?: string };
      try {
        msg = JSON.parse(
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer)
        );
      } catch {
        console.error("[agent] invalid JSON from control plane");
        return;
      }

      if (msg.type === "ping") {
        ws!.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (msg.type === "approved" && msg.token) {
        console.log("[agent] machine approved, token received");
        currentToken = msg.token;
        saveAgentToken(msg.token, config.machineId, config.controlUrl);
        return;
      }

      if (msg.type === "config_update") {
        const configMsg = msg as any;
        const newConfig = configMsg.config as MachineConfig;
        const newVersion = configMsg.version as number;

        if (newConfig && newVersion !== undefined) {
          cachedConfig = newConfig;
          cachedConfigVersion = newVersion;
          saveCachedConfig(newConfig, newVersion);

          const ack: ConfigAckMessage = {
            type: "config_ack",
            version: newVersion,
            status: "applied",
            machine_id: config.machineId,
          };
          ws!.send(JSON.stringify(ack));

          // Trigger workload reconcile on every config apply — new or
          // changed workload declarations converge immediately.
          runWorkloadReconcile("config_update").catch((err) =>
            console.error("[workloads] reconcile failed:", err)
          );
        }
        return;
      }

      if (msg.type === "command") {
        await handleCommand(msg as unknown as CommandEnvelope);
        return;
      }
    };

    ws.onclose = (event) => {
      connected = false;
      if (healthInterval) {
        clearInterval(healthInterval);
        healthInterval = null;
      }

      if (event.code === 1008) {
        // Policy violation — don't retry (revoked, invalid token, etc.)
        console.error(`[agent] connection rejected: ${event.reason}`);
        if (event.reason === "revoked" || event.reason === "invalid token") {
          console.error("[agent] this machine has been revoked or has an invalid token. Exiting.");
          process.exit(1);
        }
      }

      const delay = jitteredBackoff(attempt);
      attempt++;
      console.log(`[agent] disconnected, reconnecting in ${delay}ms...`);
      setTimeout(connect, delay);
    };

    ws.onerror = (err) => {
      console.error("[agent] WebSocket error:", err);
    };
  }

  // Detect available capabilities
  function detectCapabilities(): string[] {
    const caps: string[] = ["bun"];
    // Check for common tools
    try {
      const git = Bun.spawnSync(["which", "git"]);
      if (git.exitCode === 0) caps.push("git");
    } catch {}
    try {
      const ollama = Bun.spawnSync(["which", "ollama"]);
      if (ollama.exitCode === 0) caps.push("ollama");
    } catch {}
    return caps;
  }

  // --- Break-Glass Local HTTP ---

  const breakGlassApp = new Hono();

  breakGlassApp.get("/health", (c) => {
    return c.json({
      status: "ok",
      machine_id: config.machineId,
      connected,
      agent_version: AGENT_VERSION,
      uptime_ms: Date.now() - startTime,
    });
  });

  breakGlassApp.get("/status", async (c) => {
    const system = await collectSystemMetrics();
    const models = await collectLoadedModels();
    const gpu = await collectGpuMetrics();
    const services: ServiceHealth[] = [];
    if (cachedConfig) {
      for (const svc of cachedConfig.services) {
        services.push(await probeService(svc));
      }
    }
    return c.json({
      machine_id: config.machineId,
      connected,
      config_version: cachedConfigVersion,
      system,
      services,
      models,
      ...(gpu !== undefined ? { gpu } : {}),
    });
  });

  breakGlassApp.get("/config", (c) => {
    return c.json({
      config: cachedConfig,
      version: cachedConfigVersion,
    });
  });

  const startTime = Date.now();

  // Start break-glass server on localhost only
  Bun.serve({
    port: BREAK_GLASS_PORT,
    hostname: "127.0.0.1",
    fetch: breakGlassApp.fetch,
  });
  console.log(`[agent] break-glass HTTP on http://127.0.0.1:${BREAK_GLASS_PORT}`);

  // Start Observatory proxy (hook + OTLP receiver) on localhost only.
  if (config.proxy.enabled) {
    proxyHandle = createProxy({
      machineId: config.machineId,
      config: config.proxy,
      getWs: (): WsSender | null => {
        if (!ws) return null;
        return { readyState: ws.readyState, send: (d) => ws!.send(d) };
      },
    });
    Bun.serve({
      port: config.proxy.listen_port,
      hostname: "127.0.0.1",
      fetch: proxyHandle.app.fetch,
    });
    console.log(
      `[agent] observatory proxy on http://127.0.0.1:${config.proxy.listen_port}` +
        ` (buffer_max=${config.proxy.buffer_max}, flush_interval_ms=${config.proxy.flush_interval_ms})`
    );
  } else {
    console.log("[agent] observatory proxy disabled");
  }

  // Boot-time workload reconcile — heals drift (e.g., post-reboot the
  // agent comes up, cached config has workloads but launchd forgot them).
  if (workloadsEnabled && (cachedConfig?.workloads?.length ?? 0) > 0) {
    runWorkloadReconcile("boot").catch((err) =>
      console.error("[workloads] boot reconcile failed:", err)
    );
  }

  // Connect to control plane
  connect();
}

// --- Subcommand Dispatch ---

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
        "Usage: seed-agent self-update [--version <tag>] [--force]"
      );
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }

  try {
    const result = await runSelfUpdate({
      binary: "seed-agent",
      version,
      currentVersion: AGENT_VERSION,
      force,
    });
    if (result.updated) {
      console.log(
        "[agent] self-update complete — exiting so supervisor restarts with the new binary"
      );
      process.exit(0);
    } else {
      process.exit(0);
    }
  } catch (err: any) {
    console.error(`[agent] self-update failed: ${err?.message ?? err}`);
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
    console.log(AGENT_VERSION);
    process.exit(0);
  }
  await runAgent();
}

entrypoint().catch((err) => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
