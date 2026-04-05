// Shared fetch-mocking helpers for adapter tests. Each test installs a
// handler for globalThis.fetch and the suite-level afterEach restores
// the original. Calls are captured so assertions can inspect the
// outgoing request URL, headers, and body.

export interface FetchCall {
  url: string;
  init: RequestInit;
}

type FetchHandler = (args: FetchCall) => Response | Promise<Response>;

let originalFetch: typeof fetch | null = null;

export function mockFetch(handler: FetchHandler): () => FetchCall[] {
  const calls: FetchCall[] = [];
  if (!originalFetch) originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const args: FetchCall = { url, init: init ?? {} };
    calls.push(args);
    return handler(args);
  }) as typeof fetch;
  return () => calls;
}

export function restoreFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(body: string, status: number): Response {
  return new Response(body, { status });
}
