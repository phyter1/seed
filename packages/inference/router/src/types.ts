export interface OllamaNode {
  name: string;
  host: string; // e.g., "ren.local:11434"
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

export interface ConsensusResult {
  prompt: string;
  jurorCount: number;
  jurorResponses: JurorResponse[];
  consensus: string;
  aggregatorModel: string;
  aggregatorDurationMs: number;
  totalDurationMs: number;
  agreement: number; // 0-1, how much jurors agreed
  metadata: {
    strategy: ConsensusStrategy;
    temperature: number;
    timestamp: string;
  };
}

export type ConsensusStrategy =
  | "majority"      // Most common answer wins
  | "synthesis"     // Aggregator synthesizes all responses
  | "best-of"       // Aggregator picks the best single response
  | "debate";       // Jurors see each other's answers, revise, then aggregate

export interface JuryConfig {
  nodes: OllamaNode[];
  jurors: JurorAssignment[];
  aggregator: AggregatorConfig;
  strategy: ConsensusStrategy;
  temperature?: number;
  timeoutMs?: number;
}

export interface JurorAssignment {
  node: string; // must match OllamaNode.name
  model: string;
}

export interface AggregatorConfig {
  provider: "ollama" | "anthropic";
  model: string;
  node?: string; // for ollama aggregator
  apiKey?: string; // for anthropic aggregator
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
  improvement: boolean; // did jury beat single model?
}
