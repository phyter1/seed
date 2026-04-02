# Tool: Pino

Fast, low-overhead structured logging for Node.js/Bun.

## Install

```bash
bun add pino pino-pretty
# or
npm install pino pino-pretty
```

## Why Pino

- **Fast** - 5x faster than alternatives
- **Structured** - JSON output by default
- **Low overhead** - Minimal performance impact
- **Flexible** - Child loggers, transports

## Basic Usage

```typescript
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

logger.info("Server started");
logger.error({ err: error }, "Request failed");
logger.debug({ userId, action }, "User action");
```

## Configuration

```typescript
// src/lib/logger.ts
import pino from "pino";

const isDev = process.env.NODE_ENV === "development";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",

  // Pretty print in development
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      }
    : undefined,

  // Base fields included in every log
  base: {
    env: process.env.NODE_ENV,
    version: process.env.APP_VERSION,
  },
});
```

## Log Levels

```typescript
logger.trace("Trace message");  // 10
logger.debug("Debug message");  // 20
logger.info("Info message");    // 30
logger.warn("Warning message"); // 40
logger.error("Error message");  // 50
logger.fatal("Fatal message");  // 60
```

## Structured Data

```typescript
// Always pass objects first, message last
logger.info({ userId: "123", action: "login" }, "User logged in");

// Output (JSON):
// {"level":30,"time":1234567890,"userId":"123","action":"login","msg":"User logged in"}

// With error
logger.error({ err: error, requestId }, "Request failed");
```

## Child Loggers

```typescript
// Create child with bound context
const requestLogger = logger.child({
  requestId: crypto.randomUUID(),
  userId: session?.userId,
});

requestLogger.info("Processing request");
// Includes requestId and userId automatically
```

## Request Logging (Hono)

```typescript
import { Hono } from "hono";
import { logger } from "./lib/logger";

const app = new Hono();

app.use("*", async (c, next) => {
  const requestId = crypto.randomUUID();
  const start = Date.now();

  const log = logger.child({ requestId });
  c.set("logger", log);

  log.info({
    method: c.req.method,
    path: c.req.path,
  }, "Request started");

  await next();

  log.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration: Date.now() - start,
  }, "Request completed");
});
```

## Error Logging

```typescript
// Pino serializes Error objects specially with `err` key
try {
  await riskyOperation();
} catch (error) {
  logger.error({ err: error, context: { userId, action } }, "Operation failed");
}

// Custom error serializer
const logger = pino({
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,  // Also serialize `error` key
  },
});
```

## Security: Never Log Secrets

```typescript
// ❌ NEVER log these
logger.info({ password, apiKey, token });
logger.info({ user }); // May contain password

// ✅ Log safe fields only
logger.info({ userId: user.id, email: user.email });

// Redaction (automatic)
const logger = pino({
  redact: ["password", "apiKey", "*.token", "user.password"],
});
```

## Transports (Production)

```typescript
// Send logs to external service
const logger = pino({
  transport: {
    targets: [
      // Console
      { target: "pino-pretty", level: "info" },
      // File
      { target: "pino/file", options: { destination: "./logs/app.log" } },
      // External (e.g., Datadog, Logtail)
      { target: "pino-datadog-transport", options: { /* config */ } },
    ],
  },
});
```

## With Hono Middleware

```typescript
import { pinoLogger } from "hono-pino";
import pino from "pino";

const logger = pino({ level: "info" });

app.use("*", pinoLogger({ pino: logger }));

// Access in handler
app.get("/", (c) => {
  c.var.logger.info("Hello from handler");
  return c.text("Hello");
});
```

## Testing

```typescript
import { pino } from "pino";
import { describe, it, expect, vi } from "vitest";

describe("logging", () => {
  it("logs with context", () => {
    const logs: unknown[] = [];
    const logger = pino(
      { level: "info" },
      { write: (msg) => logs.push(JSON.parse(msg)) }
    );

    logger.info({ userId: "123" }, "Test message");

    expect(logs[0]).toMatchObject({
      userId: "123",
      msg: "Test message",
    });
  });
});
```

## Gotchas

1. **Object first** - Always `logger.info({ data }, "message")` not reverse
2. **err key** - Use `err` for errors to get proper serialization
3. **Async transports** - May lose logs on crash; use sync for critical logs
4. **Pretty in prod** - Never use pino-pretty in production (slow)

## Pairs With

- [hono.md](./hono.md) - Web framework
- [bun.md](./bun.md) / [node.md](./node.md) - Runtime
