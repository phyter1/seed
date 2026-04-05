// runJury — fan out to jurors concurrently, aggregate into consensus.
//
// Temperature defaults (0.3/0.5/0.7/0.9) come from the battle-tested
// fleet-router jury and give the jurors enough sampler diversity that
// their outputs differ meaningfully even when they share a base model.

import { calculateAgreement } from "./agreement";
import type {
  InvokeOptions,
  JurorAssignment,
  JurorResult,
  JuryRequest,
  JuryResponse,
} from "./types";

const DEFAULT_TEMPERATURES = [0.3, 0.5, 0.7, 0.9];
const DEFAULT_MAX_TOKENS = 512;

export async function runJury(request: JuryRequest): Promise<JuryResponse> {
  const { jurors, messages, aggregator, queue, onJurorComplete, onAggregateComplete } = request;

  if (jurors.length === 0) {
    throw new Error("runJury: jurors[] is empty");
  }

  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
  const start = Date.now();
  const lastUserMsg = lastUserContent(messages);

  const jurorResults = await Promise.all(
    jurors.map((juror, index) => {
      const options: InvokeOptions = {
        temperature: juror.temperature ?? DEFAULT_TEMPERATURES[index % DEFAULT_TEMPERATURES.length],
        maxTokens,
      };
      const task = () => invokeOne(juror, messages, options, onJurorComplete);
      return queue ? queue(juror.id, task) : task();
    }),
  );

  const aggregateStart = Date.now();
  let consensus: string;
  try {
    consensus = await aggregator({ question: lastUserMsg, jurors: jurorResults, maxTokens });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    onAggregateComplete?.({
      durationMs: Date.now() - aggregateStart,
      status: "error",
      error: errMsg,
    });
    throw err;
  }

  const aggregateDurationMs = Date.now() - aggregateStart;
  onAggregateComplete?.({ durationMs: aggregateDurationMs, status: "success" });

  const validContents = jurorResults
    .filter((r) => !r.error && r.content.length > 0)
    .map((r) => r.content);
  const agreement = calculateAgreement(validContents);

  return {
    consensus,
    jurors: jurorResults,
    agreement,
    aggregateDurationMs,
    totalDurationMs: Date.now() - start,
  };
}

async function invokeOne(
  juror: JurorAssignment,
  messages: JuryRequest["messages"],
  options: InvokeOptions,
  onComplete: JuryRequest["onJurorComplete"],
): Promise<JurorResult> {
  const taskStart = Date.now();
  try {
    const res = await juror.invoke(messages, options);
    const durationMs = Date.now() - taskStart;
    const seconds = durationMs / 1000;
    const tokensPerSecond =
      res.completionTokens && seconds > 0
        ? Math.round((res.completionTokens / seconds) * 10) / 10
        : 0;
    const result: JurorResult = {
      id: juror.id,
      role: juror.role,
      content: res.content,
      durationMs,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      tokensPerSecond,
      error: null,
    };
    onComplete?.(result);
    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const result: JurorResult = {
      id: juror.id,
      role: juror.role,
      content: "",
      durationMs: Date.now() - taskStart,
      tokensPerSecond: 0,
      error: errMsg,
    };
    onComplete?.(result);
    return result;
  }
}

function lastUserContent(messages: JuryRequest["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return messages[messages.length - 1]?.content ?? "";
}
