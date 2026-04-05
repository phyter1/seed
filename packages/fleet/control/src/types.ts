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
  agent_updated_at: string | null;
  lan_ip: string | null;
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

export interface GpuMetrics {
  name: string;
  utilization_percent: number;
  vram_used_gb: number;
  vram_total_gb: number;
  temperature_c: number;
}

export interface HealthReport {
  machine_id: string;
  timestamp: string;
  system: SystemMetrics;
  services: ServiceHealth[];
  models: LoadedModel[];
  gpu?: GpuMetrics;
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
  /** LAN IPv4 the agent reaches the control plane from. Populated by
   *  asking the kernel which local address would egress toward the
   *  control plane. Used for service discovery so callers don't have
   *  to rely on mDNS (.local) or DNS resolving machine_ids. */
  lan_ip?: string;
}

export interface HealthMessage {
  type: "health";
  machine_id: string;
  timestamp: string;
  system: SystemMetrics;
  services: ServiceHealth[];
  models: LoadedModel[];
  gpu?: GpuMetrics;
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

export interface ApprovedMessage {
  type: "approved";
  token: string;
  machine_id: string;
}

export type ControlMessage =
  | CommandEnvelope
  | ConfigUpdateMessage
  | PingMessage
  | ApprovedMessage;

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
  /**
   * Workloads declared for this machine. The agent's convergence
   * loop installs each one and reports status back via health
   * reports. See docs/workloads-design.md.
   */
  workloads?: WorkloadDeclaration[];
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
  "cli.update",
  "control-plane.update",
  "workload.install",
  "workload.reload",
  "workload.remove",
  "workload.status",
  "workload.reconcile",
] as const;

export type ActionName = (typeof ACTION_WHITELIST)[number];

// --- Workloads ---

/**
 * A workload manifest declares the shape of an installable, supervised
 * long-running process. It ships inside an artifact tarball as
 * `manifest.json` and tells the agent's installer what to extract,
 * what to render, and how to start the resulting process.
 */
export interface WorkloadManifest {
  id: string;
  version: string;
  description?: string;
  platform: "darwin" | "linux";
  arch: "arm64" | "x64";
  /** Relative path inside the tarball to the main executable. */
  binary: string;
  /** Non-executable files that must land alongside the binary. */
  sidecars?: Array<{ src: string; dest_rel: string }>;
  /** Env vars rendered into the supervisor spec. Values may reference
   *  tokens like {{install_dir}} which the installer resolves. */
  env?: Record<string, string>;
  /** Env keys the operator must supply in the declaration. */
  required_env?: string[];
  /** Port the workload listens on (used for discovery + health probes). */
  port?: number;
  probe?: { type: "http" | "tcp"; path?: string };
  supervisor: {
    launchd?: {
      label: string;
      template: string;
      log_path_rel?: string;
    };
    systemd?: {
      unit: string;
      template: string;
    };
  };
  /** sha256 hex digests, keyed by tarball-relative path. */
  checksums?: Record<string, string>;
}

/**
 * Operator declaration pinning a workload to a machine. Stored in the
 * control-plane config under the `workloads.<machine_id>` key (as an
 * array of declarations — a machine can host multiple workloads).
 */
export interface WorkloadDeclaration {
  id: string;
  version: string;
  /** Where the agent should fetch the artifact tarball from. Phase 1
   *  supports file:// URLs. Phase 2 adds https:// (GitHub Releases). */
  artifact_url: string;
  /** Operator-supplied env values (override manifest.env defaults). */
  env?: Record<string, string>;
  depends_on?: string[];
}

export type WorkloadInstallStatus =
  | "pending"
  | "installed"
  | "loaded"
  | "running"
  | "install_failed"
  | "drift"
  | "removed";

/**
 * Agent-local record of an installed workload. Tracked in the agent's
 * own SQLite store (workloads.db), not the control-plane DB.
 */
export interface WorkloadInstallRecord {
  workload_id: string;
  version: string;
  install_dir: string;
  supervisor_label: string;
  installed_at: string;
  state: WorkloadInstallStatus;
  failure_reason: string | null;
  last_probe_at: string | null;
  last_probe_tier: HealthTier | null;
}

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

// --- Install Telemetry ---

export type InstallTarget = "agent" | "control-plane";
export type InstallStatus = "in_progress" | "success" | "failed" | "aborted";
export type InstallEventStatus = "started" | "ok" | "failed" | "retrying";

export interface InstallSession {
  install_id: string;
  machine_id: string | null;
  target: InstallTarget;
  os: string | null;
  arch: string | null;
  started_at: string;
  completed_at: string | null;
  status: InstallStatus;
  steps_total: number | null;
  steps_completed: number;
  last_step: string | null;
  last_error: string | null;
  env: Record<string, unknown> | null;
}

export interface InstallEvent {
  id: number;
  install_id: string;
  timestamp: string;
  step: string;
  status: InstallEventStatus;
  details: Record<string, unknown> | null;
}

export interface InstallEventInput {
  install_id: string;
  step: string;
  status: InstallEventStatus;
  details?: Record<string, unknown> | null;
  timestamp?: string;
}

// --- Connected Machine (in-memory state) ---

export interface ConnectedMachine {
  machine_id: string;
  ws: WebSocket;
  last_pong: number;
  missed_pongs: number;
  last_health: HealthReport | null;
}
