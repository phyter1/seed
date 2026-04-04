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

/**
 * Forwarded hook payload from a CLI agent (Claude Code / Codex / Gemini)
 * that hit the machine agent's local hook receiver.
 *
 * The `payload` is the raw JSON body the CLI posted. It is forwarded
 * verbatim so the control plane can run it through the shared hook
 * parser/normalizer pipeline.
 */
export interface HookEventMessage {
  type: "hook_event";
  machine_id: string;
  received_at: string;
  source_ip?: string;
  payload: Record<string, unknown>;
}

/**
 * Forwarded OTLP telemetry payload from a local service that hit the
 * machine agent's local OTLP receiver.
 *
 * `signal` indicates which OTLP endpoint it was posted to. The payload
 * is the raw OTLP JSON (logs or metrics) and is forwarded verbatim.
 */
export interface OtlpEventMessage {
  type: "otlp_event";
  machine_id: string;
  received_at: string;
  signal: "logs" | "metrics";
  payload: Record<string, unknown>;
}

export type AgentMessage =
  | AnnounceMessage
  | HealthMessage
  | CommandResultMessage
  | ConfigAckMessage
  | PongMessage
  | HookEventMessage
  | OtlpEventMessage;

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
  | "auth_failure";

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

/**
 * Observatory proxy configuration.
 *
 * The machine agent can absorb the Observatory proxy role: it listens
 * on a local HTTP port for hook payloads and OTLP telemetry from CLI
 * agents and local services, then forwards them to the control plane
 * over the existing agent WebSocket.
 *
 * When disconnected from the control plane, events are buffered
 * (up to `buffer_max`) and flushed on reconnect.
 */
export interface ProxyConfig {
  enabled: boolean;
  listen_port: number;
  buffer_max: number;
  flush_interval_ms: number;
}

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  enabled: true,
  listen_port: 4312,
  buffer_max: 1000,
  flush_interval_ms: 5000,
};

export interface AgentConfig {
  machine_id: string;
  control_url: string;
  token: string;
  proxy?: Partial<ProxyConfig>;
}

// --- Connected Machine (in-memory state) ---

export interface ConnectedMachine {
  machine_id: string;
  ws: WebSocket;
  last_pong: number;
  missed_pongs: number;
  last_health: HealthReport | null;
}
