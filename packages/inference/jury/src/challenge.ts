// Challenge round — after jurors return, a challenger model inspects
// their outputs and emits structured findings (contradictions, errors,
// gaps, confidence). Findings are woven into the aggregator's synthesis
// prompt by the default aggregator.
//
// Tiered escalation: if `escalate:true` and the start-tier challenger
// either (a) fails to emit parseable JSON, (b) returns confidence below
// threshold, or (c) requests escalation, the challenge is retried at
// the next tier — up to `maxTier`. A `sensitivityLock` cap forces
// max_tier=local when the jury request carries sensitivity=SENSITIVE.

import { extractJson, type JsonValue } from "@seed/inference-utils";
import type { SensitivityLevel } from "@seed/sensitivity";
import type { ChatMessage, InvokeOptions, InvokeResult, JurorResult } from "./types";
import { minTier, nextTier, type Tier } from "./tiers";

export type ChallengerInvoke = (
  messages: ChatMessage[],
  options: InvokeOptions,
) => Promise<InvokeResult>;

export type Sensitivity = SensitivityLevel;

export interface ChallengeConfig {
  enabled: boolean;
  /** One invoke fn per tier the caller wants to allow. At least the start-tier must be present. */
  invokers: Partial<Record<Tier, ChallengerInvoke>>;
  /** Tier to start at. Default: "local". */
  startTier?: Tier;
  /** If true, escalate on low confidence / parse fail / escalation_requested. Default: false. */
  escalate?: boolean;
  /** Inclusive cap on escalation. Default: "frontier". */
  maxTier?: Tier;
  /** Confidence below this triggers escalation. Default: 0.7. */
  confidenceThreshold?: number;
  /**
   * "advisory": findings always pass through; aggregator proceeds.
   * "strict": findings still pass through, but `escalationExhausted`
   * is set on the result when a low-confidence finding survives
   * all escalation rounds, so callers can gate themselves.
   * Default: "advisory".
   */
  strictness?: "advisory" | "strict";
  /** If true, SENSITIVE sensitivity forces maxTier=local. Default: false. */
  sensitivityLock?: boolean;
  /** Max tokens for challenger output. Default: 512. */
  maxTokens?: number;
  /** Override the default challenger system prompt. */
  systemPrompt?: string;
}

export interface ChallengeFindings {
  contradictions: string[];
  errors: string[];
  gaps: string[];
  confidence: number;
  escalationRequested: boolean;
}

export interface ChallengeAttempt {
  tier: Tier;
  raw: string;
  parseOk: boolean;
  confidence: number | null;
  durationMs: number;
  error: string | null;
}

export interface ChallengeResult {
  findings: ChallengeFindings;
  tier: Tier;
  attempts: ChallengeAttempt[];
  durationMs: number;
  cappedByTier: Tier | null;
  escalationExhausted: boolean;
}

const DEFAULT_SYSTEM_PROMPT =
  "You are a quality reviewer comparing multiple model responses. Identify contradictions between responses, errors in reasoning or fact, and gaps that none of the respondents addressed. Be precise and brief. Respond ONLY with a JSON object matching the schema below; do not include commentary, markdown, or <think> tags.";

const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_START_TIER: Tier = "local";
const DEFAULT_MAX_TIER: Tier = "frontier";

interface RunChallengeArgs {
  question: string;
  jurors: JurorResult[];
  config: ChallengeConfig;
  sensitivity?: Sensitivity;
}

export async function runChallenge({
  question,
  jurors,
  config,
  sensitivity,
}: RunChallengeArgs): Promise<ChallengeResult> {
  const start = Date.now();
  const systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const threshold = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const strict = (config.strictness ?? "advisory") === "strict";
  const escalateEnabled = config.escalate === true;

  let effectiveMaxTier = config.maxTier ?? DEFAULT_MAX_TIER;
  let cappedByTier: Tier | null = null;
  if (config.sensitivityLock && sensitivity === "SENSITIVE") {
    cappedByTier = minTier(effectiveMaxTier, "local");
    effectiveMaxTier = cappedByTier;
  }

  // If start tier is above the cap, downgrade it.
  let tier: Tier = config.startTier ?? DEFAULT_START_TIER;
  tier = minTier(tier, effectiveMaxTier);

  const validJurors = jurors.filter((j) => !j.error && j.content.length > 0);
  const userPrompt = buildUserPrompt(question, validJurors);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const attempts: ChallengeAttempt[] = [];
  let finalFindings: ChallengeFindings | null = null;
  let finalTier: Tier = tier;

  while (true) {
    const invoke = config.invokers[tier];
    if (!invoke) {
      attempts.push({
        tier,
        raw: "",
        parseOk: false,
        confidence: null,
        durationMs: 0,
        error: `no invoker configured for tier "${tier}"`,
      });
      if (!escalateEnabled) break;
      const next = nextTier(tier, effectiveMaxTier);
      if (!next) break;
      tier = next;
      continue;
    }

    const attemptStart = Date.now();
    let raw = "";
    let error: string | null = null;
    try {
      const res = await invoke(messages, { temperature: 0.3, maxTokens });
      raw = res.content;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const durationMs = Date.now() - attemptStart;

    const parsed = error ? null : tryParseFindings(raw);
    const parseOk = parsed !== null;
    const confidence = parsed?.confidence ?? null;

    attempts.push({ tier, raw, parseOk, confidence, durationMs, error });

    if (parsed) {
      finalFindings = parsed;
      finalTier = tier;
      const needsEscalation =
        escalateEnabled &&
        (parsed.escalationRequested || parsed.confidence < threshold);
      if (!needsEscalation) break;
    } else if (!escalateEnabled) {
      break;
    }

    const next = nextTier(tier, effectiveMaxTier);
    if (!next) break;
    tier = next;
  }

  if (!finalFindings) {
    // All attempts failed to produce parseable findings. Return an
    // empty-findings result flagged as exhausted so callers can see
    // that the challenger didn't produce a verdict.
    return {
      findings: emptyFindings(),
      tier: finalTier,
      attempts,
      durationMs: Date.now() - start,
      cappedByTier,
      escalationExhausted: true,
    };
  }

  const escalationExhausted =
    strict && finalFindings.confidence < threshold && attempts.length > 0;

  return {
    findings: finalFindings,
    tier: finalTier,
    attempts,
    durationMs: Date.now() - start,
    cappedByTier,
    escalationExhausted,
  };
}

function buildUserPrompt(question: string, jurors: JurorResult[]): string {
  const analyses = jurors
    .map((j, i) => {
      const label = j.role ? `${j.role} — ${j.id}` : j.id;
      return `--- Juror ${i + 1} (${label}) ---\n${j.content}`;
    })
    .join("\n\n");

  return `Question: ${question}

Juror responses:
${analyses}

Schema:
{
  "contradictions": [string, ...],  // specific disagreements between jurors
  "errors": [string, ...],           // factual or reasoning mistakes
  "gaps": [string, ...],             // issues none of the jurors addressed
  "confidence": number,              // 0.0-1.0, your confidence in this review
  "escalation_requested": boolean    // true if a stronger reviewer is needed
}

Respond with JSON only.`;
}

function tryParseFindings(raw: string): ChallengeFindings | null {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, JsonValue>;

  const contradictions = coerceStringArray(obj.contradictions);
  const errors = coerceStringArray(obj.errors);
  const gaps = coerceStringArray(obj.gaps);
  const confidence = coerceConfidence(obj.confidence);
  const escalationRequested = obj.escalation_requested === true;

  if (confidence === null) return null;
  return { contradictions, errors, gaps, confidence, escalationRequested };
}

function coerceStringArray(v: JsonValue | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

function coerceConfidence(v: JsonValue | undefined): number | null {
  if (typeof v !== "number" || Number.isNaN(v)) return null;
  return Math.max(0, Math.min(1, v));
}

function emptyFindings(): ChallengeFindings {
  return {
    contradictions: [],
    errors: [],
    gaps: [],
    confidence: 0,
    escalationRequested: false,
  };
}
