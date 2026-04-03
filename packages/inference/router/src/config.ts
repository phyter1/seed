import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

export type RouterProviderKind = "openai_compatible" | "ollama";

export interface RouterModelEntry {
  machine: string;
  host: string;
  provider: RouterProviderKind;
  model: string;
  description: string;
  tags: string[];
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
    structuredOutput?: boolean;
    vision?: boolean;
    reasoning?: boolean;
  };
}

interface SeedConfigFile {
  routing?: {
    router_model?: string;
    router_port?: number;
  };
  providers?: Record<string, SeedProviderConfig>;
  models?: SeedModelConfig[];
}

export interface LoadedRouterConfig {
  routerModel: string;
  routerPort: number;
  fleet: RouterModelEntry[];
  openAICompatibleHost: string;
  source: "seed" | "legacy";
}

function normalizeOpenAICompatibleBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, "").replace(/\/v1\/?$/, "");
}

function loadFromSeedConfig(configPath: string): LoadedRouterConfig {
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as SeedConfigFile;

  const providers = config.providers ?? {};
  const models = config.models ?? [];

  const fleet: RouterModelEntry[] = [];

  for (const model of models) {
    const provider = providers[model.provider];
    if (!provider?.type) continue;
    if (!provider.base_url) continue;

    let providerKind: RouterProviderKind | null = null;
    let host = "";

    if (provider.type === "ollama") {
      providerKind = "ollama";
      host = provider.base_url.replace(/^https?:\/\//, "");
    } else if (provider.type === "mlx_openai_compatible" || provider.type === "openai_compatible") {
      providerKind = "openai_compatible";
      host = normalizeOpenAICompatibleBaseUrl(provider.base_url);
    } else {
      continue;
    }

    const tags = [...(model.tags ?? [])];
    if (provider.locality) tags.push(provider.locality);
    if (model.capabilities?.reasoning) tags.push("reasoning");
    if (model.capabilities?.vision) tags.push("vision");

    fleet.push({
      machine: model.provider,
      host,
      provider: providerKind,
      model: model.id,
      description: `${model.id} via ${model.provider}`,
      tags: Array.from(new Set(tags)),
    });
  }

  if (fleet.length === 0) {
    throw new Error(`No router-compatible models found in ${configPath}. Add ollama or openai-compatible providers with base_url.`);
  }

  const routerModel =
    process.env.ROUTER_MODEL
    ?? config.routing?.router_model
    ?? fleet.find((entry) => entry.tags.includes("reasoning"))?.model
    ?? fleet[0].model;

  const openAICompatibleHost =
    fleet.find((entry) => entry.model === routerModel && entry.provider === "openai_compatible")?.host
    ?? fleet.find((entry) => entry.provider === "openai_compatible")?.host
    ?? fleet[0].host;

  return {
    routerModel,
    routerPort: Number(process.env.ROUTER_PORT ?? config.routing?.router_port ?? 3000),
    fleet,
    openAICompatibleHost,
    source: "seed",
  };
}

function loadFromLegacyConfig(configPath: string): LoadedRouterConfig {
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as LegacyFleetConfigFile;

  const fleet: RouterModelEntry[] = config.fleet.map((entry) => {
    const host = config.hosts[entry.host_ref];
    if (!host) {
      throw new Error(`Unknown host_ref "${entry.host_ref}" in legacy fleet config for model "${entry.model}"`);
    }
    return {
      machine: entry.machine,
      host,
      provider: entry.provider === "ollama" ? "ollama" : "openai_compatible",
      model: entry.model,
      description: entry.description,
      tags: entry.tags,
    };
  });

  const routerFleetEntry = fleet.find((m) => m.model === config.router.model);
  const openAICompatibleHost =
    routerFleetEntry?.host
    ?? fleet.find((entry) => entry.provider === "openai_compatible")?.host
    ?? fleet[0].host;

  return {
    routerModel: config.router.model,
    routerPort: Number(process.env.ROUTER_PORT ?? config.router.port ?? 3000),
    fleet,
    openAICompatibleHost,
    source: "legacy",
  };
}

export function loadRouterConfig(): LoadedRouterConfig {
  const seedConfigPath = process.env.SEED_CONFIG ?? resolve(import.meta.dir, "..", "..", "..", "..", "seed.config.json");
  const legacyConfigPath = process.env.FLEET_CONFIG ?? resolve(import.meta.dir, "..", "fleet.config.json");

  if (existsSync(seedConfigPath)) {
    return loadFromSeedConfig(seedConfigPath);
  }

  if (existsSync(legacyConfigPath)) {
    return loadFromLegacyConfig(legacyConfigPath);
  }

  throw new Error(
    `No router config found. Expected seed config at ${seedConfigPath} or legacy fleet config at ${legacyConfigPath}.`
  );
}
