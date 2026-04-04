// @seed/fleet-control: Types for the fleet control plane, machine agents, and CLI

// --- Machine Registry ---

export type MachineStatus = "pending" | "accepted" | "revoked";

export interface Machine {
  id: string;
  display_name: string | null;
  status: MachineStatus;
  token_hash: string | null;
  arch: string | null;
  platform: string | null;
  memory_gb: number | null;
  agent_version: string | null;
  last_seen: string | null;
  last_health: HealthReport | null;
  config_version: number;
  created_at: string;
  updated_at: string;
}

// --- Health Reports ---

export interface SystemMetrics {
  cpu_percent: number;
  memory_used_gb: number;
  memory_total_gb: number;
  disk_free_gb: number;
}

export type HealthTier =
  | "process_alive"
  | "accepting_connections"
  | "serving_requests"
  | "within_sla";

export interface ServiceHealth {
  id: string;
  health_tier: HealthTier;
  port: number;
  details: Record<string, unknown>;
}

export interface LoadedModel {
  name: string;
  runtime: "ollama" | "mlx";
  loaded: boolean;
  size_gb?: number;
}

export interface HealthReport {
  machine_id: string;
  timestamp: string;
  system: SystemMetrics;
  services: ServiceHealth[];
  models: LoadedModel[];
}

// --- WebSocket Protocol: Agent -> Control Plane ---

export interface AnnounceMessage {
  type: "announce";
  machine_id: string;
  hostname: string;
  arch: string;
  cpu_cores: number;
  memory_gb: number;
  platform: string;
  agent_version: string;
  config_version: number;
  capabilities: string[];
}

export interface HealthMessage {
  type: "health";
  machine_id: string;
  timestamp: string;
  system: SystemMetrics;
  services: ServiceHealth[];
  models: LoadedModel[];
}

export interface CommandResultMessage {
  type: "command_result";
  command_id: string;
  success: boolean;
  output: string;
  duration_ms: number;
}

export interface ConfigAckMessage {
  type: "config_ack";
  version: number;
  status: "applied" | "rejected";
  machine_id: string;
  reason?: string;
}

export interface PongMessage {
  type: "pong";
}

export type AgentMessage =
  | AnnounceMessage
  | HealthMessage
  | CommandResultMessage
  | ConfigAckMessage
  | PongMessage;

// --- WebSocket Protocol: Control Plane -> Agent ---

export interface CommandEnvelope {
  type: "command";
  command_id: string;
  timestamp: string;
  target: string;
  action: string;
  params: Record<string, unknown>;
  timeout_ms: number;
  issued_by: string;
}

export interface ConfigUpdateMessage {
  type: "config_update";
  version: number;
  config: MachineConfig;
}

export interface PingMessage {
  type: "ping";
}

export type ControlMessage = CommandEnvelope | ConfigUpdateMessage | PingMessage;

// --- Config ---

export interface ServiceProbe {
  type: "http" | "tcp" | "process";
  path?: string;
  name?: string;
}

export interface ServiceConfig {
  id: string;
  port: number;
  probe: ServiceProbe;
  manager?: string;
  launchd_label?: string;
  depends_on?: string[];
}

export interface ModelConfig {
  name: string;
  runtime: "ollama" | "mlx";
  keep_alive?: number;
}

export interface RepoConfig {
  id: string;
  path: string;
}

export interface MachineConfig {
  services: ServiceConfig[];
  models: ModelConfig[];
  repos: RepoConfig[];
}

// --- Config Store ---

export interface ConfigEntry {
  key: string;
  value: unknown;
  version: number;
  updated_at: string;
  updated_by: string;
}

export interface ConfigHistoryEntry {
  id: number;
  key: string;
  old_value: unknown;
  new_value: unknown;
  version: number;
  changed_at: string;
  changed_by: string;
}

// --- Audit Log ---

export type AuditEventType =
  | "command"
  | "config_change"
  | "machine_join"
  | "machine_approve"
  | "machine_revoke"
  | "auth_failure"
  | "anomaly_cost_spike"
  | "anomaly_token_rate";

export interface AuditEntry {
  id: number;
  timestamp: string;
  event_type: AuditEventType;
  machine_id: string | null;
  issued_by: string | null;
  action: string | null;
  params: string | null;
  result: string | null;
  details: string | null;
  command_id: string | null;
}

// --- Telemetry / Observability ---

/**
 * Service/CLI type for an agent session.
 * - CLI agents run on developer machines: claude, codex, gemini
 * - Inference sources are backend services: fleet-router, inference-worker
 */
export type AgentCli = "claude" | "codex" | "gemini";
export type InferenceSource = "fleet-router" | "inference-worker";
export type ServiceType = AgentCli | InferenceSource;

export type SessionStatus =
  | "active"
  | "idle"
  | "stuck"
  | "stopped"
  | "crashed"
  | "completed";

export type HealthLevel = "green" | "yellow" | "red";

export type EventCategory =
  | "tool_call"
  | "tool_decision"
  | "user_prompt"
  | "metric"
  | "inference_request"
  | "status_change"
  | "error"
  | "unknown";

export type EventSource = "otel" | "hook" | "internal";

/** Normalized telemetry event — the canonical form after ingestion. */
export interface NormalizedEvent {
  session_id: string;
  service_type: ServiceType;
  event_type: EventCategory;
  event_name: string;
  detail: Record<string, unknown>;
  token_count: number;
  cost_cents: number;
  context_usage_percent?: number;
  source: EventSource;
  timestamp: Date;
  /** For inference events: which machine served it */
  machine_id?: string;
}

/** A stored agent session (CLI agent or inference source). */
export interface AgentSession {
  id: string;
  service_type: ServiceType;
  /** Classification: 'cli' is ephemeral (one session per run); 'inference' is request-scoped/long-lived */
  session_kind: "cli" | "inference";
  status: SessionStatus;
  health_level: HealthLevel;
  machine_id: string | null;
  current_task: string | null;
  worktree_path: string | null;
  total_tokens: number;
  total_cost_cents: number;
  context_usage_percent: number;
  started_at: string;
  last_event_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Aggregated metrics window for a session. */
export interface MetricWindow {
  id: number;
  session_id: string;
  window_start: string;
  window_end: string;
  token_count: number;
  cost_cents: number;
  event_count: number;
}

export interface StoredAgentEvent {
  id: number;
  session_id: string;
  service_type: ServiceType;
  event_type: EventCategory;
  event_name: string;
  detail: Record<string, unknown> | null;
  token_count: number | null;
  cost_cents: number | null;
  source: EventSource;
  machine_id: string | null;
  timestamp: string;
  created_at: string;
}

/** A parsed hook event from a local CLI. */
export interface HookEvent {
  cli: AgentCli;
  event_name: string;
  session_id?: string;
  raw_payload: Record<string, unknown>;
  received_at: string;
}

/** Per-CLI cost rates in cents per 1M tokens (split into prompt/completion). */
export interface CostRate {
  prompt_cents_per_mtok: number;
  completion_cents_per_mtok: number;
}

// --- Action Whitelist ---

export const ACTION_WHITELIST = [
  "service.start",
  "service.stop",
  "service.restart",
  "service.status",
  "model.load",
  "model.unload",
  "model.swap",
  "model.list",
  "config.apply",
  "config.report",
  "health.report",
  "repo.pull",
  "agent.update",
  "agent.restart",
] as const;

export type ActionName = (typeof ACTION_WHITELIST)[number];

// --- Agent Config File ---

export interface AgentConfig {
  machine_id: string;
  control_url: string;
  token: string;
}

// --- Connected Machine (in-memory state) ---

export interface ConnectedMachine {
  machine_id: string;
  ws: WebSocket;
  last_pong: number;
  missed_pongs: number;
  last_health: HealthReport | null;
}
