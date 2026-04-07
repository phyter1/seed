/**
 * Backend HTTP clients — OpenAI-compatible and Ollama, both streaming and non-streaming.
 *
 * Self-contained HTTP clients extracted from router.ts. They only depend on
 * ChatMessage and ChatResponse from types.ts.
 */

import type { ChatMessage, ChatResponse } from "./types";

// ── Non-Streaming ─────────────────────────────────────────────────────────

export async function callOpenAICompatible(host: string, model: string, messages: ChatMessage[], options: { temperature?: number; maxTokens?: number; enableThinking?: boolean } = {}): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2048,
  };
  if (options.enableThinking !== undefined) body.enable_thinking = options.enableThinking;
  const res = await fetch(`http://${host}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI-compatible ${host} error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return {
    content: msg.content ?? "",
    reasoning: msg.reasoning,
    model: data.model ?? model,
    usage: data.usage,
  };
}

export async function callOllama(host: string, model: string, messages: ChatMessage[], options: { temperature?: number; maxTokens?: number } = {}): Promise<ChatResponse> {
  const res = await fetch(`http://${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, options: { temperature: options.temperature ?? 0.7, num_predict: options.maxTokens ?? 2048 } }),
  });
  if (!res.ok) throw new Error(`Ollama ${host} error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return {
    content: data.message?.content ?? "",
    model: data.model ?? model,
    usage: { input_tokens: data.prompt_eval_count ?? 0, output_tokens: data.eval_count ?? 0, total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0) },
  };
}

// ── Streaming ─────────────────────────────────────────────────────────────

export async function streamOpenAICompatible(
  host: string, model: string, messages: ChatMessage[],
  writer: WritableStreamDefaultWriter<Uint8Array>,
  options: { temperature?: number; maxTokens?: number; enableThinking?: boolean } = {},
): Promise<void> {
  const encoder = new TextEncoder();
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2048,
    stream: true,
  };
  if (options.enableThinking !== undefined) body.enable_thinking = options.enableThinking;
  const res = await fetch(`http://${host}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI-compatible ${host} error: ${res.status} ${await res.text()}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    while (buf.includes("\n\n")) {
      const idx = buf.indexOf("\n\n");
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") {
          await writer.write(encoder.encode("data: [DONE]\n\n"));
          continue;
        }
        await writer.write(encoder.encode(`data: ${payload}\n\n`));
      }
    }
  }
  await writer.close();
}

export async function streamOllama(
  host: string, model: string, messages: ChatMessage[],
  writer: WritableStreamDefaultWriter<Uint8Array>,
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<void> {
  const encoder = new TextEncoder();
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  const res = await fetch(`http://${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, options: { temperature: options.temperature ?? 0.7, num_predict: options.maxTokens ?? 2048 } }),
  });
  if (!res.ok) throw new Error(`Ollama ${host} error: ${res.status} ${await res.text()}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    while (buf.includes("\n")) {
      const idx = buf.indexOf("\n");
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;

      try {
        const chunk = JSON.parse(line);
        const delta: string = chunk.message?.content ?? "";
        const isDone = chunk.done === true;
        if (!isDone && delta === "") continue;

        const sseChunk = {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: isDone ? {} : { content: delta },
            finish_reason: isDone ? "stop" : null,
          }],
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(sseChunk)}\n\n`));

        if (isDone) {
          await writer.write(encoder.encode("data: [DONE]\n\n"));
        }
      } catch { /* skip malformed lines */ }
    }
  }
  await writer.close();
}
