/**
 * Sensitivity classification — "what can leave the building?"
 *
 * Seed's router can dispatch to local providers (MLX, Ollama) and eventually
 * to cloud providers (Groq, Cerebras, Gemini, OpenAI, Anthropic). A sensitivity
 * profile classifies content before dispatch so that sensitive material is
 * pinned to local providers and never leaks to third-party APIs.
 *
 * This package ships the interface + one default profile (the identity
 * profile, tuned for Seed-hosting-an-identity repos). Domain-specific
 * profiles (legal, accounting, medical) are the responsibility of the
 * consumer — see LexBox's `sensitivity/` for realized examples.
 */

export type SensitivityLevel = "SENSITIVE" | "GENERAL" | "FRONTIER";

export interface Classification {
  /** Routing verdict. */
  level: SensitivityLevel;
  /** If true, refuse to dispatch to any cloud provider. */
  local_only: boolean;
  /** Human-readable explanation — surfaces in audit logs + error bodies. */
  reason: string;
  /** Specific detections (pattern names). Useful for debugging + audit. */
  flags: string[];
}

/**
 * Optional context threaded from the caller. Lets profiles make more-informed
 * decisions without stuffing everything into the prompt text.
 */
export interface ClassifyContext {
  /** Origin of the content, e.g. "skill:research", "memory.ingest", "router". */
  source?: string;
  /** Project or scope the content belongs to. */
  project?: string;
}

/**
 * One entry in a conversation — structural shape the classifier understands.
 * Mirrors the OpenAI/Anthropic chat-completions message shape loosely.
 */
export interface ClassifiableMessage {
  role: string;
  content: string | unknown;
}

/**
 * A sensitivity profile classifies content against one set of rules. Profiles
 * are compiled-in — no runtime configuration — because what counts as
 * sensitive is a property of the deployment, not a knob to twiddle.
 */
export interface SensitivityProfile {
  /** Stable identifier used in logs and audit trails. */
  readonly name: string;

  /** Classify a single block of text. */
  classify(content: string, context?: ClassifyContext): Classification;

  /**
   * Classify a full message array (chat-completions style). Implementations
   * SHOULD skip system messages — those are the operator's prompts, not the
   * user's content, and they often contain the very words the profile would
   * flag (e.g. "privileged", "confidential") as instructional language.
   */
  classifyMessages(
    messages: ClassifiableMessage[],
    context?: ClassifyContext
  ): Classification;
}
