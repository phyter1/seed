# Tool: Hono

Ultrafast web framework with Zod validation, OpenAPI generation, and Scalar docs.

**This is the full stack:** Hono + Zod + @hono/zod-openapi + Scalar

## Install

```bash
bun add hono @hono/zod-openapi zod @scalar/hono-api-reference
```

## Why Hono

- **Fast** - One of the fastest JS frameworks
- **Type-safe** - End-to-end TypeScript from schema to handler
- **Self-documenting** - OpenAPI spec generated from code
- **Beautiful docs** - Scalar UI out of the box
- **Portable** - Same code runs on Bun, Node, Deno, Cloudflare

---

## Quick Start

```typescript
// src/index.ts
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";

const app = new OpenAPIHono();

// Middleware
app.use("*", secureHeaders());
app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// OpenAPI spec
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "My API", version: "1.0.0" },
});

// Scalar docs
app.get("/docs", apiReference({ spec: { url: "/openapi.json" } }));

export default {
  port: 3000,
  fetch: app.fetch,
};
```

```bash
bun run --hot src/index.ts
# API: http://localhost:3000
# Docs: http://localhost:3000/docs
```

---

## Defining Schemas

Use Zod from `@hono/zod-openapi` (not from `zod` directly) for OpenAPI metadata.

```typescript
import { z } from "@hono/zod-openapi";

// Response schema - registered as OpenAPI component
const UserSchema = z.object({
  id: z.number(),
  email: z.string().email().openapi({ example: "user@example.com" }),
  name: z.string().openapi({ example: "John Doe" }),
  role: z.enum(["admin", "user"]),
  createdAt: z.string().datetime(),
}).openapi("User");

// Request schema
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
}).openapi("CreateUser");

// Error schema
const ErrorSchema = z.object({
  error: z.string(),
  details: z.record(z.array(z.string())).optional(),
}).openapi("Error");

// Infer TypeScript types
type User = z.infer<typeof UserSchema>;
type CreateUser = z.infer<typeof CreateUserSchema>;
```

---

## Defining Routes

Routes define the full OpenAPI spec: method, path, request, responses, tags.

```typescript
import { createRoute } from "@hono/zod-openapi";

// GET /users - List users
const listUsers = createRoute({
  method: "get",
  path: "/users",
  tags: ["Users"],
  summary: "List all users",
  request: {
    query: z.object({
      limit: z.coerce.number().min(1).max(100).default(20),
      offset: z.coerce.number().min(0).default(0),
      search: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "List of users",
      content: {
        "application/json": {
          schema: z.object({
            users: z.array(UserSchema),
            total: z.number(),
          }),
        },
      },
    },
  },
});

// GET /users/:id - Get single user
const getUser = createRoute({
  method: "get",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Get user by ID",
  request: {
    params: z.object({
      id: z.coerce.number(),
    }),
  },
  responses: {
    200: {
      description: "User found",
      content: { "application/json": { schema: UserSchema } },
    },
    404: {
      description: "User not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

// POST /users - Create user
const createUser = createRoute({
  method: "post",
  path: "/users",
  tags: ["Users"],
  summary: "Create a new user",
  request: {
    body: {
      content: { "application/json": { schema: CreateUserSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "User created",
      content: { "application/json": { schema: UserSchema } },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});
```

---

## Implementing Handlers

Handlers are fully typed based on route definition.

```typescript
import { OpenAPIHono } from "@hono/zod-openapi";

const app = new OpenAPIHono();

// List users
app.openapi(listUsers, async (c) => {
  const { limit, offset, search } = c.req.valid("query");
  // All params typed: limit: number, offset: number, search: string | undefined

  const users = await db.query.users.findMany({
    limit,
    offset,
    where: search ? like(schema.users.name, `%${search}%`) : undefined,
  });
  const total = await db.select({ count: count() }).from(schema.users);

  return c.json({ users, total: total[0].count }, 200);
});

// Get user
app.openapi(getUser, async (c) => {
  const { id } = c.req.valid("param");
  // id is typed as number

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, id),
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json(user, 200);
});

// Create user
app.openapi(createUser, async (c) => {
  const body = c.req.valid("json");
  // body is typed as { email: string; name: string }

  const [user] = await db.insert(schema.users).values(body).returning();
  return c.json(user, 201);
});
```

---

## Validation Error Handling

Configure default validation error responses.

```typescript
const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: "Validation failed",
          details: result.error.flatten().fieldErrors,
        },
        400
      );
    }
  },
});
```

---

## Route Groups

Organize routes into separate files and compose them.

```typescript
// src/routes/users.ts
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const app = new OpenAPIHono();

// Define routes and handlers...
app.openapi(listUsers, async (c) => { /* ... */ });
app.openapi(getUser, async (c) => { /* ... */ });
app.openapi(createUser, async (c) => { /* ... */ });

// Export for RPC client typing
export type UsersApp = typeof app;
export { app as usersRouter };
```

```typescript
// src/index.ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { usersRouter } from "./routes/users";
import { postsRouter } from "./routes/posts";

const app = new OpenAPIHono()
  .route("/api/users", usersRouter)
  .route("/api/posts", postsRouter);

// Export type for Hono RPC client
export type AppType = typeof app;

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "My API", version: "1.0.0" },
});

app.get("/docs", apiReference({ spec: { url: "/openapi.json" } }));

export default app;
```

---

## Middleware

```typescript
import { OpenAPIHono } from "@hono/zod-openapi";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new OpenAPIHono();

// Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
app.use("*", secureHeaders());

// CORS
app.use("*", cors({
  origin: ["http://localhost:3000", "https://myapp.com"],
  credentials: true,
}));

// Request logging
app.use("*", logger());

// Custom middleware
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} - ${Date.now() - start}ms`);
});

// Auth middleware for specific routes
app.use("/api/*", async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  // Verify token...
  await next();
});
```

---

## Error Handling

```typescript
import { HTTPException } from "hono/http-exception";

const app = new OpenAPIHono();

// Throw HTTP exceptions
app.openapi(getUser, async (c) => {
  const { id } = c.req.valid("param");
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });

  if (!user) {
    throw new HTTPException(404, { message: "User not found" });
  }

  return c.json(user, 200);
});

// Global error handler
app.onError((err, c) => {
  // Log to monitoring (Highlight.io, etc.)
  console.error(err);

  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }

  // Never expose internal errors
  return c.json({ error: "Internal server error" }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});
```

---

## OpenAPI Configuration

```typescript
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "My API",
    version: "1.0.0",
    description: "A well-documented API",
    contact: {
      name: "API Support",
      email: "support@example.com",
    },
  },
  servers: [
    { url: "http://localhost:3000", description: "Development" },
    { url: "https://staging.example.com", description: "Staging" },
    { url: "https://api.example.com", description: "Production" },
  ],
  tags: [
    { name: "Users", description: "User management" },
    { name: "Posts", description: "Post management" },
  ],
});
```

---

## Scalar Docs Configuration

```typescript
import { apiReference } from "@scalar/hono-api-reference";

app.get("/docs", apiReference({
  spec: { url: "/openapi.json" },
  theme: "kepler",  // kepler, purple, saturn, mars, moon
  layout: "modern",
  darkMode: true,
  metaData: {
    title: "My API Documentation",
    description: "API reference for My API",
  },
  defaultHttpClient: {
    targetKey: "javascript",
    clientKey: "fetch",
  },
}));
```

---

## Testing

```typescript
// src/routes/users.test.ts
import { describe, it, expect } from "bun:test";
import app from "../index";

describe("Users API", () => {
  describe("GET /api/users", () => {
    it("returns list of users", async () => {
      const res = await app.fetch(new Request("http://localhost/api/users"));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("users");
      expect(data).toHaveProperty("total");
    });

    it("respects limit parameter", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/users?limit=5")
      );
      const data = await res.json();
      expect(data.users.length).toBeLessThanOrEqual(5);
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

      const user = await res.json();
      expect(user.email).toBe("test@example.com");
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
});
```

---

## Complete Example

```typescript
// src/index.ts
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";

// Schemas
const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.string().datetime(),
}).openapi("User");

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
}).openapi("CreateUser");

const ErrorSchema = z.object({
  error: z.string(),
  details: z.record(z.array(z.string())).optional(),
}).openapi("Error");

// Routes
const listUsers = createRoute({
  method: "get",
  path: "/api/users",
  tags: ["Users"],
  request: {
    query: z.object({
      limit: z.coerce.number().min(1).max(100).default(20),
      offset: z.coerce.number().min(0).default(0),
    }),
  },
  responses: {
    200: {
      description: "Users",
      content: {
        "application/json": {
          schema: z.object({ users: z.array(UserSchema), total: z.number() }),
        },
      },
    },
  },
});

const createUser = createRoute({
  method: "post",
  path: "/api/users",
  tags: ["Users"],
  request: {
    body: { content: { "application/json": { schema: CreateUserSchema } } },
  },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: UserSchema } },
    },
    400: {
      description: "Validation error",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

// App
const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json({
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      }, 400);
    }
  },
});

// Middleware
app.use("*", secureHeaders());
app.use("*", cors());

// Handlers
app.openapi(listUsers, async (c) => {
  const { limit, offset } = c.req.valid("query");
  // Fetch from database...
  return c.json({ users: [], total: 0 }, 200);
});

app.openapi(createUser, async (c) => {
  const body = c.req.valid("json");
  // Insert into database...
  const user = { id: 1, ...body, createdAt: new Date().toISOString() };
  return c.json(user, 201);
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// OpenAPI
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: "My API", version: "1.0.0" },
});

// Docs
app.get("/docs", apiReference({ spec: { url: "/openapi.json" }, theme: "kepler" }));

// Export type for Hono RPC
export type AppType = typeof app;

export default {
  port: 3000,
  fetch: app.fetch,
};
```

---

## Gotchas

1. **Use z from @hono/zod-openapi** - Not from `zod` directly, for OpenAPI metadata
2. **Query params are strings** - Use `z.coerce.number()` for numeric query params
3. **Register schemas** - Use `.openapi("Name")` for reusable components in docs
4. **Response must match** - TypeScript enforces return type matches schema
5. **Export app type** - Required for Hono RPC client type inference

## Pairs With

- [Bun](./bun.md) - Runtime
- [Hono RPC](./hono-rpc.md) - Type-safe client from this server
- [Drizzle](./drizzle.md) - Database
- [Pino](./pino.md) - Logging
