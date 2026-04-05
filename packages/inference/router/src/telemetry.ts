/**
 * Telemetry emission for the fleet router.
 *
 * Emits OTLP-compatible events to a configurable endpoint after each inference
 * request. Fire-and-forget: never blocks or slows down inference. If no
 * endpoint is configured, emission is silently skipped.
 *
 * Endpoint resolution (first match wins):
 *   1. TELEMETRY_ENDPOINT env var
 *   2. seed.config.json -> telemetry.endpoint
 *   3. (none — emission disabled)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

export type RouteType = "keyword" | "explicit" | "jury";
export type Provider = "mlx" | "ollama";
export type EventStatus = "success" | "error";

export interface InferenceEventAttributes {
  model: string;
  machine: string;
  provider: Provider;
  route_type: RouteType;
  route_pattern: string;
  tokens_input: number;
  tokens_output: number;
  duration_ms: number;
  status: EventStatus;
  thinking_mode: boolean;
  sampler_preset: string;
  /** Optional free-form fields for jury-specific context (juror index, etc.) */
  [key: string]: string | number | boolean | undefined;
}

export interface TelemetryEvent {
  service_name: string;
  event_type: string;
  timestamp: string;
  attributes: InferenceEventAttributes;
}

// ── Config Resolution ──────────────────────────────────────────────────────

interface SeedConfigWithTelemetry {
  telemetry?: {
    endpoint?: string;
  };
}

/**
 * Resolve the telemetry endpoint from env vars then seed.config.json.
 * Returns null if no endpoint is configured (emission disabled).
 */
export function resolveTelemetryEndpoint(): string | null {
  const fromEnv = process.env.TELEMETRY_ENDPOINT;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  const seedConfigPath =
    process.env.SEED_CONFIG ??
    resolve(import.meta.dir, "..", "..", "..", "..", "seed.config.json");

  if (!existsSync(seedConfigPath)) return null;

  try {
    const raw = readFileSync(seedConfigPath, "utf-8");
    const config = JSON.parse(raw) as SeedConfigWithTelemetry;
    const endpoint = config.telemetry?.endpoint;
    if (typeof endpoint === "string" && endpoint.trim().length > 0) {
      return endpoint.trim();
    }
  } catch {
    // malformed config — treat as no endpoint
    return null;
  }

  return null;
}

// ── Emitter ────────────────────────────────────────────────────────────────

export interface TelemetryEmitter {
  emit(event: TelemetryEvent): void;
  /** Snapshot the endpoint currently in use (null = disabled). */
  readonly endpoint: string | null;
}

/**
 * Create a fire-and-forget telemetry emitter bound to the given endpoint.
 * All errors are swallowed — telemetry must never break inference.
 */
export function createTelemetryEmitter(endpoint: string | null): TelemetryEmitter {
  return {
    endpoint,
    emit(event: TelemetryEvent): void {
      if (!endpoint) return;
      // Fire-and-forget: no await, catch handler is attached synchronously so
      // rejected promises don't surface as unhandled rejections.
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }).catch(() => {
        // Silent: telemetry failure must never affect inference.
      });
    },
  };
}

// ── Event Builder ──────────────────────────────────────────────────────────

export interface BuildInferenceEventInput {
  event_type?: string;
  model: string;
  machine: string;
  provider: Provider;
  route_type: RouteType;
  route_pattern: string;
  tokens_input: number;
  tokens_output: number;
  duration_ms: number;
  status: EventStatus;
  thinking_mode: boolean;
  sampler_preset: string;
  extra?: Record<string, string | number | boolean>;
}

/** Build a TelemetryEvent for an inference request. */
export function buildInferenceEvent(input: BuildInferenceEventInput): TelemetryEvent {
  const {
    event_type = "inference_request",
    extra,
    ...core
  } = input;

  return {
    service_name: "fleet-router",
    event_type,
    timestamp: new Date().toISOString(),
    attributes: { ...core, ...(extra ?? {}) },
  };
}

/** Format a sampler preset label from temperature + maxTokens. */
export function samplerPresetLabel(temperature: number, maxTokens: number): string {
  return `t=${temperature}/max=${maxTokens}`;
}
