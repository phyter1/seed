// @seed/jury — provider-agnostic jury primitive.
//
// The jury pattern fans a query out to multiple models concurrently, then
// aggregates the juror outputs into a single consensus response. This
// package intentionally knows nothing about providers, machines, or
// transport — callers supply `invoke` functions that wrap whichever
// backend (local Ollama, MLX, cloud) they want to use.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface InvokeOptions {
  temperature: number;
  maxTokens: number;
}

export interface InvokeResult {
  content: string;
  promptTokens?: number;
  completionTokens?: number;
}

/**
 * A single juror assignment. The caller is responsible for binding the
 * invoke function to a specific provider + model + host + auth. The
 * jury primitive only ever calls `invoke(messages, options)`.
 */
export interface JurorAssignment {
  /** Human-readable identifier, e.g. "gemma4:e4b@ren2". Used in telemetry + aggregator prompts. */
  id: string;
  /** Optional descriptive role for the juror (used in aggregator prompt if present). */
  role?: string;
  /** Sampler temperature for this juror. Defaults vary by fleet position. */
  temperature?: number;
  /** Bound invocation function. Called once per jury run. */
  invoke: (messages: ChatMessage[], options: InvokeOptions) => Promise<InvokeResult>;
}

export interface JurorResult {
  id: string;
  role?: string;
  content: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSecond: number;
  error: string | null;
}

export interface AggregatorContext {
  question: string;
  jurors: JurorResult[];
  maxTokens: number;
}

/**
 * Aggregator synthesizes juror outputs into a single consensus response.
 * Caller supplies this — typically wraps a higher-tier model (MLX
 * Qwen3.5-9B in the local fleet, a frontier model for cloud use).
 */
export type AggregatorFn = (ctx: AggregatorContext) => Promise<string>;

export interface JuryRequest {
  messages: ChatMessage[];
  jurors: JurorAssignment[];
  aggregator: AggregatorFn;
  /** Max tokens passed to each juror and the aggregator. Default: 512. */
  maxTokens?: number;
  /** Optional per-juror queue (e.g. machine-level concurrency limit). */
  queue?: <T>(id: string, task: () => Promise<T>) => Promise<T>;
  /** Telemetry hook fired once per juror completion (success or error). */
  onJurorComplete?: (result: JurorResult) => void;
  /** Telemetry hook fired once after aggregation completes. */
  onAggregateComplete?: (info: { durationMs: number; status: "success" | "error"; error?: string }) => void;
}

export interface JuryResponse {
  consensus: string;
  jurors: JurorResult[];
  agreement: number;
  aggregateDurationMs: number;
  totalDurationMs: number;
}
