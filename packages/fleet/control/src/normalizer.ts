/**
 * OTLP payload normalizer for the fleet control plane.
 *
 * Ingests OTLP-JSON logs and metrics from multiple sources and produces
 * canonical NormalizedEvent records. Recognized service.name values:
 *
 *   - "claude" / "claude-code"      → CLI agent
 *   - "codex"                       → CLI agent
 *   - "gemini"                      → CLI agent
 *   - "fleet-router"                → inference source (from router Task 1)
 *   - "inference-worker"            → inference source (queue workers)
 *
 * Session ID precedence (first non-empty wins): service-specific ID
 * (claude_code.session.id, codex.session.id, gemini.session.id) → router
 * session.id → conversation.id. For inference events that lack a session ID,
 * we synthesize a stable "fleet-router:<machine_id>" or "inference-worker:<machine_id>"
 * session id so inference activity aggregates per machine.
 */

import type {
  EventCategory,
  NormalizedEvent,
  ServiceType,
} from "./types";

// --- OTLP shape (permissive) ---

export interface OtlpAttributeValue {
  stringValue?: string;
  intValue?: string; // int64 encoded as string in JSON
  doubleValue?: number;
  boolValue?: boolean;
}

export interface OtlpAttribute {
  key: string;
  value: OtlpAttributeValue;
}

export interface OtlpLogRecord {
  timeUnixNano?: string;
  body?: { stringValue?: string };
  attributes?: OtlpAttribute[];
}

export interface OtlpMetricDataPoint {
  startTimeUnixNano?: string;
  timeUnixNano?: string;
  asInt?: string;
  asDouble?: number;
  attributes?: OtlpAttribute[];
}

export interface OtlpResourceLogs {
  resource?: { attributes?: OtlpAttribute[] };
  scopeLogs?: Array<{ logRecords?: OtlpLogRecord[] }>;
}

export interface OtlpResourceMetrics {
  resource?: { attributes?: OtlpAttribute[] };
  scopeMetrics?: Array<{
    metrics?: Array<{
      name: string;
      sum?: { dataPoints?: OtlpMetricDataPoint[] };
      gauge?: { dataPoints?: OtlpMetricDataPoint[] };
    }>;
  }>;
}

export interface OtlpLogsPayload {
  resourceLogs?: OtlpResourceLogs[];
}

export interface OtlpMetricsPayload {
  resourceMetrics?: OtlpResourceMetrics[];
}

// --- Helpers ---

function getStringAttr(
  attrs: OtlpAttribute[] | undefined,
  key: string
): string | undefined {
  const found = attrs?.find((a) => a.key === key);
  if (!found) return undefined;
  const v = found.value;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return v.intValue;
  if (v.doubleValue !== undefined) return String(v.doubleValue);
  if (v.boolValue !== undefined) return String(v.boolValue);
  return undefined;
}

function getIntAttr(
  attrs: OtlpAttribute[] | undefined,
  key: string
): number | undefined {
  const found = attrs?.find((a) => a.key === key);
  if (!found) return undefined;
  const v = found.value;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return Math.round(v.doubleValue);
  return undefined;
}

function getBoolAttr(
  attrs: OtlpAttribute[] | undefined,
  key: string
): boolean | undefined {
  const v = attrs?.find((a) => a.key === key)?.value.boolValue;
  return v;
}

/** Session-id keys that are hoisted from attributes into detail. */
const SESSION_ID_KEYS = new Set([
  "claude_code.session.id",
  "gemini.session.id",
  "codex.session.id",
  "conversation.id",
  "session.id",
]);

function attrsToDetail(
  attrs: OtlpAttribute[] | undefined
): Record<string, unknown> {
  if (!attrs) return {};
  const detail: Record<string, unknown> = {};
  for (const attr of attrs) {
    if (SESSION_ID_KEYS.has(attr.key)) continue;
    const v = attr.value;
    if (v.stringValue !== undefined) detail[attr.key] = v.stringValue;
    else if (v.intValue !== undefined) detail[attr.key] = Number(v.intValue);
    else if (v.doubleValue !== undefined) detail[attr.key] = v.doubleValue;
    else if (v.boolValue !== undefined) detail[attr.key] = v.boolValue;
  }
  return detail;
}

function parseNanoTimestamp(t: string | undefined): Date {
  if (!t) return new Date();
  try {
    const ms = Number(BigInt(t) / 1_000_000n);
    if (Number.isNaN(ms)) return new Date();
    return new Date(ms);
  } catch {
    return new Date();
  }
}

// --- Service detection ---

/**
 * Detect the service/CLI from OTLP resource attributes (`service.name`).
 * Unknown values default to "claude" for backward compatibility with
 * historic Claude Code hook configurations that omit service.name.
 */
export function detectServiceType(
  resourceAttrs: OtlpAttribute[] | undefined
): ServiceType {
  const serviceName =
    getStringAttr(resourceAttrs, "service.name")?.toLowerCase() ?? "";
  if (!serviceName) return "claude";
  if (serviceName === "fleet-router") return "fleet-router";
  if (serviceName === "inference-worker") return "inference-worker";
  if (serviceName.includes("codex")) return "codex";
  if (serviceName.includes("gemini")) return "gemini";
  if (serviceName.includes("claude")) return "claude";
  return "claude";
}

// --- Event-name → category map ---

const EVENT_TYPE_MAP: Record<string, EventCategory> = {
  // Claude Code
  "claude_code.tool_result": "tool_call",
  "claude_code.tool_decision": "tool_decision",
  "claude_code.user_prompt": "user_prompt",
  tool_result: "tool_call",
  tool_decision: "tool_decision",
  user_prompt: "user_prompt",
  // Gemini
  "gemini.tool_result": "tool_call",
  "gemini.before_tool": "tool_call",
  "gemini.after_tool": "tool_call",
  "gemini.tool_decision": "tool_decision",
  "gemini.user_prompt": "user_prompt",
  // Codex
  "codex.pre_tool_use": "tool_decision",
  "codex.post_tool_use": "tool_call",
  "codex.user_prompt_submit": "user_prompt",
  // Fleet router / inference
  inference_request: "inference_request",
  "fleet-router.inference_request": "inference_request",
  "inference-worker.inference_request": "inference_request",
};

function extractSessionId(
  serviceType: ServiceType,
  attrs: OtlpAttribute[] | undefined,
  resourceAttrs: OtlpAttribute[] | undefined
): string {
  const explicit =
    getStringAttr(attrs, "claude_code.session.id") ??
    getStringAttr(attrs, "gemini.session.id") ??
    getStringAttr(attrs, "codex.session.id") ??
    getStringAttr(attrs, "session.id") ??
    getStringAttr(attrs, "conversation.id");
  if (explicit) return explicit;

  // For inference sources, synthesize a stable per-machine session id.
  if (serviceType === "fleet-router" || serviceType === "inference-worker") {
    const machineId =
      getStringAttr(resourceAttrs, "machine.id") ??
      getStringAttr(attrs, "machine") ??
      getStringAttr(resourceAttrs, "host.name") ??
      "unknown";
    return `${serviceType}:${machineId}`;
  }

  return "";
}

// --- Log normalization ---

export function normalizeLogRecord(
  record: OtlpLogRecord,
  resourceAttrs: OtlpAttribute[] | undefined
): NormalizedEvent {
  const serviceType = detectServiceType(resourceAttrs);
  const eventName =
    getStringAttr(record.attributes, "event.name") ??
    record.body?.stringValue ??
    "unknown";
  const eventType: EventCategory = EVENT_TYPE_MAP[eventName] ?? "unknown";
  const sessionId = extractSessionId(
    serviceType,
    record.attributes,
    resourceAttrs
  );
  const detail = attrsToDetail(record.attributes);
  const timestamp = parseNanoTimestamp(record.timeUnixNano);
  const machineId =
    getStringAttr(resourceAttrs, "machine.id") ??
    getStringAttr(record.attributes, "machine") ??
    undefined;

  // For inference events, some routers emit token_count / cost_cents inline
  let tokenCount = 0;
  let costCents = 0;
  if (eventType === "inference_request") {
    const prompt = getIntAttr(record.attributes, "tokens_input") ?? 0;
    const completion = getIntAttr(record.attributes, "tokens_output") ?? 0;
    tokenCount = prompt + completion;
    costCents = getIntAttr(record.attributes, "cost_cents") ?? 0;
  }

  return {
    session_id: sessionId,
    service_type: serviceType,
    event_type: eventType,
    event_name: eventName,
    detail,
    token_count: tokenCount,
    cost_cents: costCents,
    source: "otel",
    timestamp,
    machine_id: machineId,
  };
}

// --- Metric normalization ---

const TOKEN_METRIC_NAMES = new Set([
  "claude_code.token.usage",
  "gemini.token.usage",
  "codex.token.usage",
  "fleet-router.token.usage",
  "inference-worker.token.usage",
]);

const COST_METRIC_NAMES = new Set([
  "claude_code.cost.usage",
  "gemini.cost.usage",
  "codex.cost.usage",
  "fleet-router.cost.usage",
  "inference-worker.cost.usage",
]);

const CONTEXT_METRIC_NAMES = new Set([
  "claude_code.context.usage",
  "gemini.context.usage",
]);

export function normalizeMetricDataPoint(
  metricName: string,
  dp: OtlpMetricDataPoint,
  resourceAttrs: OtlpAttribute[] | undefined
): NormalizedEvent {
  const serviceType = detectServiceType(resourceAttrs);
  const sessionId = extractSessionId(serviceType, dp.attributes, resourceAttrs);
  const timestamp = parseNanoTimestamp(dp.startTimeUnixNano ?? dp.timeUnixNano);
  const machineId =
    getStringAttr(resourceAttrs, "machine.id") ??
    getStringAttr(dp.attributes, "machine") ??
    undefined;

  let tokenCount = 0;
  let costCents = 0;
  let contextUsagePercent: number | undefined;

  if (TOKEN_METRIC_NAMES.has(metricName)) {
    tokenCount = dp.asInt !== undefined ? Number(dp.asInt) : 0;
  } else if (COST_METRIC_NAMES.has(metricName)) {
    const usd = dp.asDouble ?? 0;
    costCents = Math.round(usd * 100);
  } else if (CONTEXT_METRIC_NAMES.has(metricName)) {
    const frac = dp.asDouble ?? 0;
    contextUsagePercent = Math.round(frac * 100);
  }

  return {
    session_id: sessionId,
    service_type: serviceType,
    event_type: "metric",
    event_name: metricName,
    detail: { metric_name: metricName, ...attrsToDetail(dp.attributes) },
    token_count: tokenCount,
    cost_cents: costCents,
    context_usage_percent: contextUsagePercent,
    source: "otel",
    timestamp,
    machine_id: machineId,
  };
}

// --- Hook payload → normalized event ---

export interface HookPayload {
  [key: string]: unknown;
}

/**
 * Detect CLI and extract a minimal normalized event from a hook payload.
 * Returns null if the payload shape is unrecognized.
 *
 * Discriminators:
 *   - Claude Code: payload has `event` string
 *   - Codex:       payload has `hookEventName` string
 *   - Gemini:      payload has `event_type` string
 */
export function normalizeHookPayload(
  payload: HookPayload,
  machineId?: string
): NormalizedEvent | null {
  let serviceType: ServiceType | null = null;
  let eventName: string | null = null;

  if (typeof payload.event === "string") {
    serviceType = "claude";
    eventName = payload.event;
  } else if (typeof payload.hookEventName === "string") {
    serviceType = "codex";
    eventName = payload.hookEventName;
  } else if (typeof payload.event_type === "string") {
    serviceType = "gemini";
    eventName = payload.event_type;
  }

  if (!serviceType || !eventName) return null;

  const sessionId =
    typeof payload.session_id === "string" ? payload.session_id : "";

  // Map some common hook event names to categories
  const lower = eventName.toLowerCase();
  let eventType: EventCategory = "unknown";
  if (lower.includes("pretooluse") || lower.includes("pre_tool")) {
    eventType = "tool_decision";
  } else if (lower.includes("posttooluse") || lower.includes("post_tool") ||
             lower.includes("aftertool") || lower.includes("beforetool")) {
    eventType = "tool_call";
  } else if (lower.includes("userpromptsubmit") || lower.includes("user_prompt")) {
    eventType = "user_prompt";
  } else if (lower.includes("sessionstart") || lower.includes("sessionend") ||
             lower.includes("stop")) {
    eventType = "status_change";
  }

  return {
    session_id: sessionId,
    service_type: serviceType,
    event_type: eventType,
    event_name: eventName,
    detail: { ...payload },
    token_count: 0,
    cost_cents: 0,
    source: "hook",
    timestamp: new Date(),
    machine_id: machineId,
  };
}
