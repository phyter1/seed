// seed/packages/inference/router — shared types for the rule-based fleet router

export type ProviderKind = "openai_compatible" | "ollama";

export interface ModelEntry {
  /** Logical machine name (e.g. "mlx_ren3", "ollama_ren1") — matches provider key in seed.config.json */
  machine: string;
  /** host:port for direct HTTP calls (e.g. "ren3.local:8080", "ren1.local:11434") */
  host: string;
  /** Provider type determines which client to use */
  provider: ProviderKind;
  /** Model identifier (e.g. "mlx-community/Qwen3.5-9B-MLX-4bit", "gemma4:e4b") */
  model: string;
  /** Tags for routing heuristics */
  tags: string[];
  /** Lower priority = preferred. Used for tie-breaking within the same tag match. */
  priority: number;
  /** For MLX models: does this entry need thinking mode enabled? */
  thinking?: boolean;
}

export interface RoutingResult {
  entry: ModelEntry;
  reason: string;
  needsThinking: boolean;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatResponse {
  content: string;
  reasoning?: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface JurorResult {
  machine: string;
  model: string;
  content: string;
  tokS: number;
  wallS: number;
  error: string | null;
}

export interface JuryResult {
  consensus: string;
  jurors: JurorResult[];
  agreement: number;
  totalMs: number;
}

// ── Legacy types preserved for compatibility with other packages ────────────

export interface OllamaNode {
  name: string;
  host: string;
  models: string[];
}

export interface JurorResponse {
  node: string;
  model: string;
  response: string;
  tokensPerSecond: number;
  totalTokens: number;
  durationMs: number;
  error?: string;
}

export type ConsensusStrategy =
  | "majority"
  | "synthesis"
  | "best-of"
  | "debate";

export interface ConsensusResult {
  prompt: string;
  jurorCount: number;
  jurorResponses: JurorResponse[];
  consensus: string;
  aggregatorModel: string;
  aggregatorDurationMs: number;
  totalDurationMs: number;
  agreement: number;
  metadata: {
    strategy: ConsensusStrategy;
    temperature: number;
    timestamp: string;
  };
}

export interface JuryConfig {
  nodes: OllamaNode[];
  jurors: JurorAssignment[];
  aggregator: AggregatorConfig;
  strategy: ConsensusStrategy;
  temperature?: number;
  timeoutMs?: number;
}

export interface JurorAssignment {
  node: string;
  model: string;
}

export interface AggregatorConfig {
  provider: "ollama" | "anthropic";
  model: string;
  node?: string;
  apiKey?: string;
}

export interface BenchmarkCase {
  name: string;
  prompt: string;
  expectedAnswer?: string;
  category: "classification" | "extraction" | "reasoning" | "summarization" | "code" | "factual";
  difficulty: "easy" | "medium" | "hard";
}

export interface BenchmarkResult {
  case: BenchmarkCase;
  singleModel: {
    model: string;
    response: string;
    durationMs: number;
    correct?: boolean;
  };
  jury: ConsensusResult & {
    correct?: boolean;
  };
  improvement: boolean;
}
