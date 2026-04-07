import { existsSync, readFileSync } from "fs";
import type { Capability, Locality } from "./types";
import type { SeedConfig } from "@seed/core/config";
import { findConfigPath } from "@seed/core/config";

export interface ResolvedWorkerConfig {
  workerId: string;
  capability: Capability;
  inferenceUrl: string;
  queueUrl: string;
  pollInterval: number;
  defaultModel: string;
  apiKey: string;
  locality: Locality;
  providerId?: string;
}

function readSeedConfigFile(seedConfigPath: string): SeedConfig | null {
  if (!existsSync(seedConfigPath)) return null;
  return JSON.parse(readFileSync(seedConfigPath, "utf-8")) as SeedConfig;
}

function inferProviderId(config: SeedConfig | null, explicitProviderId: string | undefined, defaultModel: string): string | undefined {
  if (explicitProviderId) return explicitProviderId;
  if (!config?.models?.length || !defaultModel) return undefined;
  return config.models.find((model) => model.id === defaultModel)?.provider;
}

function inferDefaultModel(
  config: SeedConfig | null,
  providerId: string | undefined,
  explicitDefaultModel: string,
  fallbackDefaultModel: string
): string {
  if (explicitDefaultModel) return explicitDefaultModel;
  if (!config?.models?.length || !providerId) return fallbackDefaultModel;
  return config.models.find((model) => model.provider === providerId)?.id ?? fallbackDefaultModel;
}

function inferInferenceUrl(
  config: SeedConfig | null,
  providerId: string | undefined,
  explicitUrl: string,
  fallbackUrl: string
): string {
  if (explicitUrl) return explicitUrl;
  if (!config?.providers || !providerId) return fallbackUrl;
  return config.providers[providerId]?.base_url ?? fallbackUrl;
}

function inferLocality(config: SeedConfig | null, providerId: string | undefined, explicit: string | undefined, inferenceUrl: string): Locality {
  if (explicit === "local" || explicit === "cloud") return explicit;
  if (config?.providers && providerId) {
    const fromConfig = config.providers[providerId]?.locality;
    if (fromConfig === "local" || fromConfig === "cloud") return fromConfig;
  }

  const cloudPatterns = [
    "api.groq.com",
    "api.cerebras.ai",
    "generativelanguage.googleapis.com",
    "openrouter.ai",
    "api.openai.com",
    "api.anthropic.com",
    "api.mistral.ai",
  ];

  return cloudPatterns.some((pattern) => inferenceUrl.includes(pattern)) ? "cloud" : "local";
}

export function resolveWorkerConfig(env: NodeJS.ProcessEnv): ResolvedWorkerConfig {
  const seedConfigPath = findConfigPath();
  const config = seedConfigPath ? readSeedConfigFile(seedConfigPath) : null;

  const explicitProviderId = env.PROVIDER_ID ?? env.SEED_PROVIDER;
  const fallbackDefaultModel = env.FALLBACK_DEFAULT_MODEL ?? env.SEED_FALLBACK_DEFAULT_MODEL ?? "";
  const fallbackInferenceUrl = env.FALLBACK_INFERENCE_URL ?? env.SEED_FALLBACK_INFERENCE_URL ?? "";
  const defaultModel = inferDefaultModel(
    config,
    explicitProviderId,
    env.DEFAULT_MODEL ?? "",
    fallbackDefaultModel
  );
  const providerId = inferProviderId(config, explicitProviderId, defaultModel);
  const inferenceUrl = inferInferenceUrl(
    config,
    providerId,
    env.INFERENCE_URL ?? "",
    fallbackInferenceUrl
  );
  const locality = inferLocality(config, providerId, env.LOCALITY, inferenceUrl);

  return {
    workerId: env.WORKER_ID ?? "",
    capability: (env.CAPABILITY ?? "any") as Capability,
    inferenceUrl,
    queueUrl: env.QUEUE_URL ?? "",
    pollInterval: Number(env.POLL_INTERVAL ?? 2000),
    defaultModel,
    apiKey: env.API_KEY ?? "",
    locality,
    providerId,
  };
}
