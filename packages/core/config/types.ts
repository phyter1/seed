/**
 * Canonical TypeScript types for seed.config.json — the user-intent config.
 *
 * This is the single source of truth. All consumers should import from here
 * rather than defining their own partial interfaces.
 */

/** Top-level config written by the operator (or hand-edited). */
export interface SeedConfig {
  host?: SeedHostConfig;
  heartbeat?: SeedHeartbeatConfig;
  providers?: Record<string, SeedProviderEntry>;
  models?: SeedModelEntry[];
  machines?: SeedMachineEntry[];
  routing?: SeedRoutingConfig;
  telemetry?: SeedTelemetryConfig;
}

/** Host runtime preferences. */
export interface SeedHostConfig {
  /** Default host runtime for interactive sessions. */
  default?: string;
  /** Default host runtime for heartbeat sessions (overridden by heartbeat.host). */
  heartbeat?: string;
  /** Which host runtimes are installed on this machine. */
  installed?: Record<string, boolean>;
}

/** Heartbeat scheduling config. */
export interface SeedHeartbeatConfig {
  /** Host runtime to use for heartbeat sessions. */
  host?: string;
  /** Single model for simple (non-fleet) setups. */
  model?: string;
  /** Quick beat model (fleet setup — fast, cheap). */
  quick_model?: string;
  /** Deep beat model (fleet setup — strong, expensive). */
  deep_model?: string;
}

/** A model provider endpoint. */
export interface SeedProviderEntry {
  type: "ollama" | "openai_compatible" | "anthropic" | "openai" | "gemini";
  base_url?: string;
  locality?: "local" | "cloud";
}

/** A model available through a provider. */
export interface SeedModelEntry {
  id: string;
  provider: string;
  tags?: string[];
  capabilities?: SeedModelCapabilities;
}

/** What a model can do. */
export interface SeedModelCapabilities {
  tools?: boolean;
  structured_output?: boolean;
  vision?: boolean;
  reasoning?: boolean;
}

/** A physical or virtual machine in the fleet. */
export interface SeedMachineEntry {
  hostname: string;
  arch?: string;
  cpu?: string;
  memory_gb?: number;
  runtime?: string;
  roles?: string[];
}

/** Inference routing strategy config. */
export interface SeedRoutingConfig {
  strategy?: string;
  router_model?: string;
  router_endpoint?: string;
  router_port?: number;
  prefer_local?: boolean;
  default_capability?: string;
}

/** Telemetry/observability config. */
export interface SeedTelemetryConfig {
  endpoint?: string;
}
