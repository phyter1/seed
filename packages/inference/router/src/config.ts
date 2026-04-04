/**
 * Router config resolution — builds a fleet manifest from seed.config.json.
 *
 * Resolution order:
 *   1. Environment variables (MLX_HOST, ROUTER_PORT, OLLAMA_HOSTS, etc.)
 *   2. seed.config.json (found via SEED_CONFIG env var or relative path walk)
 *   3. Legacy fleet.config.json (FLEET_CONFIG env var or packages/inference/router/fleet.config.json)
 *
 * The router works without any config file when env vars are set directly.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { ModelEntry, ProviderKind } from "./types";

// ── Config File Shapes ─────────────────────────────────────────────────────

interface SeedProviderConfig {
  type: string;
  base_url?: string;
  locality?: "local" | "cloud";
}

interface SeedModelConfig {
  id: string;
  provider: string;
  tags?: string[];
  capabilities?: {
    tools?: boolean;
    structured_output?: boolean;
    vision?: boolean;
    reasoning?: boolean;
  };
}

interface SeedMachineConfig {
  hostname: string;
  arch?: string;
  runtime?: string;
  roles?: string[];
}

interface SeedConfigFile {
  routing?: {
    strategy?: string;
    router_model?: string;
    router_port?: number;
    prefer_local?: boolean;
  };
  providers?: Record<string, SeedProviderConfig>;
  models?: SeedModelConfig[];
  machines?: SeedMachineConfig[];
}

interface LegacyFleetConfigFile {
  router: {
    model: string;
    port?: number;
  };
  hosts: Record<string, string>;
  fleet: Array<{
    machine: string;
    host_ref: string;
    provider: "mlx" | "ollama";
    model: string;
    description: string;
    tags: string[];
  }>;
}

// ── Resolved Config ────────────────────────────────────────────────────────

export interface LoadedRouterConfig {
  /** Model ID for the MLX/OpenAI-compatible endpoint used as default + aggregator */
  routerModel: string;
  /** Port for the router HTTP server */
  routerPort: number;
  /** All routable model entries in the fleet */
  fleet: ModelEntry[];
  /** MLX/OpenAI-compatible host:port (no scheme, no /v1) */
  mlxHost: string;
  /** Python path for MLX server lifecycle management */
  mlxPythonPath: string;
  /** Path to start-mlx-server.py */
  mlxStarterPath: string;
  /** MLX model to load */
  mlxModel: string;
  /** Ollama machine names and their host:port mappings */
  ollamaMachines: { name: string; host: string }[];
  /** All unique machine names in the fleet */
  allMachineNames: string[];
  /** Config source for logging */
  source: "seed" | "legacy" | "env";
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Strip http(s):// and trailing /v1/ from a base_url to get host:port */
function stripToHostPort(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, "").replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

/** Map provider type from seed.config.json to our ProviderKind */
function toProviderKind(type: string): ProviderKind | null {
  if (type === "ollama") return "ollama";
  if (type === "openai_compatible" || type === "mlx_openai_compatible") return "openai_compatible";
  return null;
}

/** Build a machine name from a hostname like "ren3.local" -> "ren3" */
function machineNameFromHostname(hostname: string): string {
  return hostname.split(".")[0];
}

// ── Loaders ────────────────────────────────────────────────────────────────

function loadFromSeedConfig(configPath: string): LoadedRouterConfig {
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as SeedConfigFile;

  const providers = config.providers ?? {};
  const models = config.models ?? [];
  const machines = config.machines ?? [];

  // Build a provider-name -> machine-name mapping from the machines array
  const providerToMachine = new Map<string, string>();
  for (const machine of machines) {
    const shortName = machineNameFromHostname(machine.hostname);
    const runtime = machine.runtime ?? "";
    // Convention: provider keys are like "mlx_ren3", "ollama_ren1"
    // Match by looking for the machine hostname in the provider base_url
    for (const [provKey, prov] of Object.entries(providers)) {
      if (prov.base_url?.includes(machine.hostname)) {
        providerToMachine.set(provKey, shortName);
      }
    }
  }

  const fleet: ModelEntry[] = [];
  let priority = 1;

  for (const model of models) {
    const provider = providers[model.provider];
    if (!provider) continue;

    const kind = toProviderKind(provider.type);
    if (!kind) continue;
    if (!provider.base_url) continue;

    // Only include local providers (ollama + openai_compatible with base_url)
    const host = stripToHostPort(provider.base_url);
    const machineName = providerToMachine.get(model.provider) ?? model.provider;

    const tags = [...(model.tags ?? [])];
    if (model.capabilities?.reasoning && !tags.includes("reasoning")) tags.push("reasoning");

    fleet.push({
      machine: machineName,
      host,
      provider: kind,
      model: model.id,
      tags: Array.from(new Set(tags)),
      priority: priority++,
    });
  }

  // Resolve MLX-specific config
  const mlxEntry = fleet.find(e => e.provider === "openai_compatible");
  const mlxHost = process.env.MLX_HOST ?? mlxEntry?.host ?? "localhost:8080";
  const mlxModel = process.env.MLX_MODEL ?? config.routing?.router_model ?? mlxEntry?.model ?? "mlx-community/Qwen3.5-9B-MLX-4bit";

  // Resolve Ollama machines
  const ollamaEntries = fleet.filter(e => e.provider === "ollama");
  const ollamaMachineMap = new Map<string, string>();
  for (const e of ollamaEntries) {
    ollamaMachineMap.set(e.machine, e.host);
  }
  const ollamaMachines = Array.from(ollamaMachineMap.entries()).map(([name, host]) => ({ name, host }));

  // All unique machine names
  const allMachineNames = Array.from(new Set(fleet.map(e => e.machine)));

  return {
    routerModel: process.env.ROUTER_MODEL ?? mlxModel,
    routerPort: Number(process.env.ROUTER_PORT ?? config.routing?.router_port ?? 3000),
    fleet,
    mlxHost,
    mlxPythonPath: process.env.MLX_PYTHON_PATH ?? "python3",
    mlxStarterPath: process.env.MLX_STARTER_PATH ?? resolve(import.meta.dir, "start-mlx-server.py"),
    mlxModel,
    ollamaMachines,
    allMachineNames,
    source: "seed",
  };
}

function loadFromLegacyConfig(configPath: string): LoadedRouterConfig {
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as LegacyFleetConfigFile;

  const fleet: ModelEntry[] = config.fleet.map((entry, i) => {
    const host = config.hosts[entry.host_ref];
    if (!host) {
      throw new Error(`Unknown host_ref "${entry.host_ref}" in legacy fleet config for model "${entry.model}"`);
    }
    return {
      machine: entry.machine,
      host,
      provider: (entry.provider === "ollama" ? "ollama" : "openai_compatible") as ProviderKind,
      model: entry.model,
      tags: entry.tags,
      priority: i + 1,
    };
  });

  const mlxEntry = fleet.find(m => m.provider === "openai_compatible");
  const ollamaEntries = fleet.filter(e => e.provider === "ollama");
  const ollamaMachineMap = new Map<string, string>();
  for (const e of ollamaEntries) {
    ollamaMachineMap.set(e.machine, e.host);
  }

  return {
    routerModel: process.env.ROUTER_MODEL ?? config.router.model,
    routerPort: Number(process.env.ROUTER_PORT ?? config.router.port ?? 3000),
    fleet,
    mlxHost: process.env.MLX_HOST ?? mlxEntry?.host ?? "localhost:8080",
    mlxPythonPath: process.env.MLX_PYTHON_PATH ?? "python3",
    mlxStarterPath: process.env.MLX_STARTER_PATH ?? resolve(import.meta.dir, "start-mlx-server.py"),
    mlxModel: process.env.MLX_MODEL ?? mlxEntry?.model ?? config.router.model,
    ollamaMachines: Array.from(ollamaMachineMap.entries()).map(([name, host]) => ({ name, host })),
    allMachineNames: Array.from(new Set(fleet.map(e => e.machine))),
    source: "legacy",
  };
}

function loadFromEnvOnly(): LoadedRouterConfig {
  const mlxHost = process.env.MLX_HOST ?? "localhost:8080";
  const mlxModel = process.env.MLX_MODEL ?? "mlx-community/Qwen3.5-9B-MLX-4bit";

  // Parse OLLAMA_HOSTS: "name1=host1:port,name2=host2:port"
  const ollamaHostsRaw = process.env.OLLAMA_HOSTS ?? "";
  const ollamaMachines: { name: string; host: string }[] = [];
  const fleet: ModelEntry[] = [];

  // Always add MLX entry
  fleet.push({
    machine: "mlx",
    host: mlxHost,
    provider: "openai_compatible",
    model: mlxModel,
    tags: ["general", "reasoning", "fast"],
    priority: 1,
  });

  if (ollamaHostsRaw) {
    let priority = 2;
    for (const pair of ollamaHostsRaw.split(",")) {
      const [name, host] = pair.split("=");
      if (name && host) {
        ollamaMachines.push({ name: name.trim(), host: host.trim() });
        // Add a generic entry — actual models will be discovered or specified via OLLAMA_MODELS
        const models = (process.env[`OLLAMA_MODELS_${name.trim().toUpperCase()}`] ?? "").split(",").filter(Boolean);
        for (const model of models) {
          fleet.push({
            machine: name.trim(),
            host: host.trim(),
            provider: "ollama",
            model: model.trim(),
            tags: ["general"],
            priority: priority++,
          });
        }
      }
    }
  }

  return {
    routerModel: process.env.ROUTER_MODEL ?? mlxModel,
    routerPort: Number(process.env.ROUTER_PORT ?? 3000),
    fleet,
    mlxHost,
    mlxPythonPath: process.env.MLX_PYTHON_PATH ?? "python3",
    mlxStarterPath: process.env.MLX_STARTER_PATH ?? resolve(import.meta.dir, "start-mlx-server.py"),
    mlxModel,
    ollamaMachines,
    allMachineNames: Array.from(new Set(fleet.map(e => e.machine))),
    source: "env",
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export function loadRouterConfig(): LoadedRouterConfig {
  const seedConfigPath = process.env.SEED_CONFIG ?? resolve(import.meta.dir, "..", "..", "..", "..", "seed.config.json");
  const legacyConfigPath = process.env.FLEET_CONFIG ?? resolve(import.meta.dir, "..", "fleet.config.json");

  if (existsSync(seedConfigPath)) {
    return loadFromSeedConfig(seedConfigPath);
  }

  if (existsSync(legacyConfigPath)) {
    return loadFromLegacyConfig(legacyConfigPath);
  }

  // Fallback to env vars only — the router should still work
  return loadFromEnvOnly();
}
