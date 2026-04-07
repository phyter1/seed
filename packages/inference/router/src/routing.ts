/**
 * Routing rules — keyword-based request classification and sampler presets.
 *
 * Pure functions extracted from router.ts. Zero side effects, no module-level
 * state — fleet topology is passed as a parameter for testability.
 */

import type { ModelEntry, ChatMessage, RoutingResult } from "./types";
import { identityProfile, type ClassifiableMessage, type Classification } from "@seed/sensitivity";

// ── Pattern Constants ─────────────────────────────────────────────────────

export const THINKING_PATTERNS = /\b(prove|theorem|step.by.step|chain.of.thought|think.through|work.out|derive|solve.*equation|formal.proof|debug.*complex|analyze.*deeply)\b/i;
export const CODE_PATTERNS = /\b(code|function|debug|refactor|implement|typescript|python|rust|golang|bug|error|fix|compile|test|api|endpoint|class|interface|module)\b/i;
export const MATH_PATTERNS = /\b(math|calculate|equation|formula|prove|theorem|integral|derivative|probability|statistics)\b/i;
export const REASONING_PATTERNS = /\b(reason|analyze|think|explain.why|compare|trade.?off|architecture|design|evaluate|critique|review)\b/i;
export const FAST_PATTERNS = /\b(classify|extract|categorize|label|sentiment|tag|summarize|tldr|brief|summary|hello|hi|hey|quick|fast|simple)\b/i;

// ── Routing ───────────────────────────────────────────────────────────────

export function routeRequest(fleet: ModelEntry[], content: string, options: { model?: string; thinking?: boolean } = {}): RoutingResult {
  // 1. Explicit model request — honor it
  if (options.model && options.model !== "auto") {
    const entry = fleet.find(m => m.model === options.model || m.model.includes(options.model!));
    if (entry) {
      const needsThinking = options.thinking ?? entry.thinking ?? false;
      return { entry, reason: `explicit: ${entry.model}`, needsThinking };
    }
  }

  // 2. Explicit thinking override
  if (options.thinking !== undefined) {
    const needsThinking = options.thinking;
    if (needsThinking) {
      const entry = fleet.find(m => m.thinking === true) ?? fleet.find(m => m.tags.includes("deep-reasoning"))!;
      if (entry) {
        return { entry, reason: "explicit thinking requested", needsThinking: true };
      }
    }
  }

  // 3. Keyword matching — route to the best-fit provider
  const mlxEntry = fleet.find(m => m.provider === "openai_compatible");
  const codeEntry = fleet.find(m => m.tags.includes("code")) ?? mlxEntry;
  const fallback = mlxEntry ?? fleet[0];

  if (MATH_PATTERNS.test(content) || THINKING_PATTERNS.test(content)) {
    return { entry: fallback, reason: "math/reasoning", needsThinking: false };
  }

  if (CODE_PATTERNS.test(content)) {
    return { entry: codeEntry ?? fallback, reason: "code task", needsThinking: false };
  }

  if (REASONING_PATTERNS.test(content)) {
    return { entry: fallback, reason: "reasoning", needsThinking: false };
  }

  if (FAST_PATTERNS.test(content)) {
    return { entry: fallback, reason: "fast/simple task", needsThinking: false };
  }

  // 4. Default — fast general-purpose
  return { entry: fallback, reason: "default (general, fast)", needsThinking: false };
}

// ── Sensitivity Classification ────────────────────────────────────────────

export function classifyMessages(messages: ChatMessage[]): Classification {
  const classifiable: ClassifiableMessage[] = messages.map(m => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : "",
  }));
  return identityProfile.classifyMessages(classifiable);
}

// ── Sampler Presets ───────────────────────────────────────────────────────

export function getSamplerSettings(thinking: boolean, taskType: string): { temperature: number; maxTokens: number } {
  if (thinking) {
    return { temperature: 0.6, maxTokens: 8192 };
  }
  if (taskType.includes("code")) {
    return { temperature: 0.3, maxTokens: 4096 };
  }
  if (taskType.includes("classification") || taskType.includes("fast")) {
    return { temperature: 0.3, maxTokens: 256 };
  }
  return { temperature: 0.7, maxTokens: 2048 };
}
