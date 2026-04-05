// Default aggregator prompt builder. Consumers wrap a model invocation
// around this to produce a consensus string.
//
// The prompt pattern is lifted from the existing fleet-router jury: the
// aggregator is told to take the strongest elements from each juror and
// not mention the synthesis process. That framing reliably produces
// single-voice output instead of "Juror 1 said X, but Juror 2 said Y"
// summaries.

import type { AggregatorFn, ChatMessage, InvokeResult, JurorResult } from "./types";

export interface DefaultAggregatorOptions {
  /** Invocation fn bound to the aggregator model (typically a higher-tier model). */
  invoke: (messages: ChatMessage[], options: { temperature: number; maxTokens: number }) => Promise<InvokeResult>;
  /** Optional override for the system framing. */
  systemPrompt?: string;
  /** Aggregator temperature. Default: 0.3 (deterministic synthesis). */
  temperature?: number;
}

/**
 * Build an AggregatorFn that synthesizes juror responses via the given
 * invoke function. Skips aggregation if only one juror produced
 * content — returns that content directly.
 */
export function makeDefaultAggregator(options: DefaultAggregatorOptions): AggregatorFn {
  const temperature = options.temperature ?? 0.3;

  return async function defaultAggregator({ question, jurors, maxTokens }) {
    const valid = jurors.filter((j) => !j.error && j.content.length > 0);
    if (valid.length === 0) throw new Error("All jurors failed");
    if (valid.length === 1) return valid[0].content;

    const responsesText = valid.map((j, i) => formatJuror(j, i)).join("\n\n");

    const aggregationPrompt = `You are synthesizing ${valid.length} model responses into one best answer. Be concise and direct.

Question: ${question}

Responses:
${responsesText}

Synthesize into a single best response. Take the strongest elements from each. Do not mention the jurors or the synthesis process.`;

    const systemPrompt = options.systemPrompt;
    const messages: ChatMessage[] = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: aggregationPrompt });

    const result = await options.invoke(messages, { temperature, maxTokens });
    return result.content;
  };
}

function formatJuror(juror: JurorResult, index: number): string {
  const label = juror.role ? `${juror.role} — ${juror.id}` : juror.id;
  return `[Juror ${index + 1} (${label})]:\n${juror.content}`;
}
