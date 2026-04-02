# Tool: Drizzle ORM

Type-safe SQL ORM with zero abstraction overhead.

## Install

```bash
bun add drizzle-orm
bun add -d drizzle-kit
```

## Why Drizzle

- **Type-safe**: Full TypeScript inference from schema to queries
- **SQL-like**: Familiar syntax, no magic abstractions
- **Zero overhead**: Compiles to raw SQL, no runtime bloat
- **Migrations**: Built-in schema diffing and migrations

## Configuration

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

### src/db/index.ts

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);
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

## Key Patterns

### Basic CRUD

```typescript
import { db } from "@/db";
import { users, type NewUser } from "@/db/schema";
import { eq } from "drizzle-orm";

// Create
const newUser: NewUser = { email: "test@example.com", name: "Test" };
const [user] = await db.insert(users).values(newUser).returning();

// Read
const user = await db.query.users.findFirst({
  where: eq(users.id, 1),
});

// Read all
const allUsers = await db.select().from(users);

// Update
await db.update(users).set({ name: "Updated" }).where(eq(users.id, 1));

// Delete
await db.delete(users).where(eq(users.id, 1));
```

### Relations

```typescript
import { relations } from "drizzle-orm";

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  authorId: integer("author_id").references(() => users.id).notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}));

// Query with relations
const usersWithPosts = await db.query.users.findMany({
  with: { posts: true },
});
```

### Transactions

```typescript
await db.transaction(async (tx) => {
  const [user] = await tx.insert(users).values({ email, name }).returning();
  await tx.insert(posts).values({ title: "First Post", authorId: user.id });
});
```

### Zod Integration

```typescript
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { users } from "./schema";

export const insertUserSchema = createInsertSchema(users, {
  email: (schema) => schema.email.email(),
});

export const selectUserSchema = createSelectSchema(users);
```

## Commands

```bash
bun drizzle-kit generate    # Generate migrations
bun drizzle-kit migrate     # Run migrations
bun drizzle-kit push        # Push schema directly (dev)
bun drizzle-kit studio      # Open Drizzle Studio GUI
```

## Gotchas

- Use `push` for rapid development, `generate` + `migrate` for production
- Always use transactions for multi-table operations
- Index frequently queried columns
- Use `drizzle-zod` for validation schemas

## Pairs With

- [Zod](./zod.md) via `drizzle-zod` for validation
- [Hono](./hono.md) for API routes
- PostgreSQL, MySQL, SQLite, Turso
