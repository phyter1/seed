# Stack: TypeScript API

Opinionated stack for building production-ready TypeScript APIs.

## Tools

| Layer | Tool | Docs |
|-------|------|------|
| Runtime | Bun | [bun.md](../tools/typescript/bun.md) |
| Framework | Hono + Zod-OpenAPI + Scalar | [hono.md](../tools/typescript/hono.md) |
| Validation | Zod | [zod.md](../tools/typescript/zod.md) |
| API Client | Hono RPC | [hono-rpc.md](../tools/typescript/hono-rpc.md) |
| Database | Drizzle ORM | [drizzle.md](../tools/typescript/drizzle.md) |
| Real-time | Convex | [convex.md](../tools/typescript/convex.md) |
| Background Jobs | Trigger.dev | [trigger-dev.md](../tools/typescript/trigger-dev.md) |
| Email | Resend | [resend.md](../tools/typescript/resend.md) |
| Linting | Biome | [biome.md](../tools/typescript/biome.md) |
| Testing | Bun Test | [bun-test.md](../tools/typescript/bun-test.md) |
| Logging | Pino | [pino.md](../tools/typescript/pino.md) |
| Monitoring | Highlight.io | [highlight-io.md](../tools/highlight-io.md) |
| Deployment | Vercel | [vercel.md](../tools/vercel.md) |
| Git Hooks | Husky | [husky.md](../tools/typescript/husky.md) |
| Secrets | Gitleaks | [gitleaks.md](../tools/gitleaks.md) |
| Deps Audit | bun audit | [audit.md](../tools/audit.md) |

## Quick Start

```bash
# Create project
mkdir my-api && cd my-api
bun init -y

# Core dependencies
bun add hono @hono/zod-openapi zod @scalar/hono-api-reference pino
bun add drizzle-orm postgres
bun add @highlight-run/node

# Background jobs & email
bun add @trigger.dev/sdk resend @react-email/components

# Dev dependencies
bun add -d typescript @types/bun @biomejs/biome husky lint-staged pino-pretty
bun add -d drizzle-kit

# Initialize tools
bunx biome init
bunx husky init
bunx trigger.dev@latest init
```

## Project Structure

```
my-api/
├── src/
│   ├── index.ts           # Entry point, app export for RPC
│   ├── routes/
│   │   ├── users.ts       # User routes with OpenAPI
│   │   └── users.test.ts  # Route tests
│   ├── middleware/
│   │   └── security.ts    # Security middleware
│   ├── lib/
│   │   ├── config.ts      # Environment validation
│   │   ├── logger.ts      # Pino logger
│   │   ├── highlight.ts   # Highlight.io setup
│   │   └── errors.ts      # Error classes
│   ├── db/
│   │   ├── index.ts       # Drizzle client
│   │   └── schema.ts      # Drizzle schema
│   ├── trigger/
│   │   └── tasks/
│   │       └── send-email.ts
│   ├── emails/
│   │   └── welcome.tsx    # React Email templates
│   └── schemas/
│       └── user.ts        # Zod schemas
├── drizzle/               # Migrations
├── biome.json
├── drizzle.config.ts
├── trigger.config.ts
├── tsconfig.json
├── package.json
└── .husky/
    ├── pre-commit
    └── pre-push
```

## Configuration Files

### package.json

```json
{
  "name": "my-api",
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target bun",
    "start": "bun run dist/index.js",
    "test": "bun test",
    "test:coverage": "bun test --coverage",
    "lint": "biome check .",
    "lint:fix": "biome check --fix .",
    "typecheck": "tsc --noEmit",
    "check": "bun run lint && bun run typecheck && bun test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio",
    "trigger:dev": "trigger.dev@latest dev",
    "email:dev": "email dev --dir src/emails",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json}": ["biome check --fix"]
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noUncheckedIndexedAccess": true,
    "noImplicitAny": true,
    "types": ["bun-types"],
    "jsx": "react-jsx",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"]
}
```

### biome.json

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "error" },
      "correctness": { "noUnusedVariables": "error" }
    }
  },
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2
  }
}
```

### drizzle.config.ts

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

## Core Files

### src/index.ts

```typescript
import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { usersRouter } from "./routes/users";
import { logger } from "./lib/logger";
import { config } from "./lib/config";
import { H } from "./lib/highlight";

const app = new OpenAPIHono()
  // Security middleware
  .use("*", secureHeaders())
  .use("*", cors({ origin: config.ALLOWED_ORIGINS }))

  // Request logging
  .use("*", async (c, next) => {
    const start = Date.now();
    await next();
    logger.info({
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration: Date.now() - start,
    });
  })

  // Error handling with Highlight
  .onError((err, c) => {
    H.consumeError(err, c.req.header("x-highlight-request"));
    logger.error({ error: err.message }, "Request failed");
    return c.json({ error: "Internal server error" }, 500);
  })

  // Routes
  .route("/api/users", usersRouter)

  // Health check
  .get("/health", (c) => c.json({ status: "ok" }))

  // OpenAPI
  .doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "My API", version: "1.0.0" },
  })
  .get("/docs", apiReference({ spec: { url: "/openapi.json" } }));

// Export type for Hono RPC client
export type AppType = typeof app;

export default {
  port: config.PORT,
  fetch: app.fetch,
};
```

### src/lib/config.ts

```typescript
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ALLOWED_ORIGINS: z.string().transform((s) => s.split(",")).default(""),
  DATABASE_URL: z.string().url(),
  HIGHLIGHT_PROJECT_ID: z.string(),
  TRIGGER_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
});

export const config = envSchema.parse(process.env);
```

### src/lib/highlight.ts

```typescript
import { H } from "@highlight-run/node";
import { config } from "./config";

H.init({
  projectID: config.HIGHLIGHT_PROJECT_ID,
  serviceName: "my-api",
  environment: config.NODE_ENV,
});

export { H };
```

### src/db/index.ts

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { config } from "@/lib/config";

const client = postgres(config.DATABASE_URL);
export const db = drizzle(client, { schema });
```

### src/db/schema.ts

```typescript
import { pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

### src/trigger/tasks/send-email.ts

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { Resend } from "resend";
import { WelcomeEmail } from "@/emails/welcome";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendWelcomeEmail = task({
  id: "send-welcome-email",
  retry: { maxAttempts: 3 },
  run: async (payload: { email: string; name: string }) => {
    await resend.emails.send({
      from: "noreply@example.com",
      to: payload.email,
      subject: `Welcome, ${payload.name}!`,
      react: WelcomeEmail({ name: payload.name }),
    });
    return { sent: true };
  },
});
```

## Git Hooks

### .husky/pre-commit

```bash
#!/bin/sh
gitleaks protect --staged --verbose
bunx lint-staged
```

### .husky/pre-push

```bash
#!/bin/sh
bun audit
bun test
bun run typecheck
```

## Testing

```typescript
// src/routes/users.test.ts
import { describe, it, expect } from "bun:test";
import app from "../index";

describe("GET /api/users", () => {
  it("returns users", async () => {
    const res = await app.fetch(new Request("http://localhost/api/users"));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/users", () => {
  it("creates user with valid data", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com", name: "Test" }),
      })
    );
    expect(res.status).toBe(201);
  });

  it("rejects invalid email", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "invalid", name: "Test" }),
      })
    );
    expect(res.status).toBe(400);
  });
});
```

## Scripts

```bash
bun run dev          # Start with hot reload
bun run build        # Build for production
bun test             # Run tests
bun run lint:fix     # Fix lint issues
bun run check        # Full quality check
bun run db:push      # Push schema to DB (dev)
bun run db:studio    # Open Drizzle Studio
bun run trigger:dev  # Start Trigger.dev dev
bun run email:dev    # Preview emails locally
```

## Security Checklist

- [ ] Gitleaks configured in pre-commit
- [ ] `bun audit` runs in pre-push
- [ ] CORS configured with specific origins
- [ ] Security headers enabled
- [ ] Input validation with Zod on all endpoints
- [ ] Secrets in environment variables only
- [ ] Pino configured to never log sensitive data
- [ ] Highlight.io capturing errors with context
- [ ] Database credentials never exposed in logs
