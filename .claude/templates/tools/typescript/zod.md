# Tool: Zod

TypeScript-first schema validation with static type inference.

## Install

```bash
bun add zod
# or
npm install zod
```

## Why Zod

- **Type inference** - Schema becomes TypeScript type automatically
- **Runtime validation** - Validate at system boundaries
- **Composable** - Build complex schemas from simple ones
- **Zero dependencies** - Small bundle size

## Basic Usage

```typescript
import { z } from "zod";

// Define schema
const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  age: z.number().int().positive().optional(),
});

// Infer TypeScript type
type User = z.infer<typeof UserSchema>;

// Validate (throws on error)
const user = UserSchema.parse(data);

// Validate (returns result object)
const result = UserSchema.safeParse(data);
if (result.success) {
  console.log(result.data); // Typed as User
} else {
  console.log(result.error.flatten());
}
```

## Common Patterns

### Primitives

```typescript
z.string()
z.number()
z.boolean()
z.date()
z.bigint()
z.undefined()
z.null()
z.any()
z.unknown()
```

### String Validations

```typescript
z.string().min(1)              // Required (non-empty)
z.string().max(100)            // Max length
z.string().email()             // Email format
z.string().url()               // URL format
z.string().uuid()              // UUID format
z.string().regex(/^[a-z]+$/)   // Custom regex
z.string().trim()              // Trim whitespace
z.string().toLowerCase()       // Transform to lowercase
```

### Number Validations

```typescript
z.number().int()               // Integer only
z.number().positive()          // > 0
z.number().nonnegative()       // >= 0
z.number().min(1).max(100)     // Range
z.coerce.number()              // Coerce string to number
```

### Objects

```typescript
const Schema = z.object({
  required: z.string(),
  optional: z.string().optional(),
  nullable: z.string().nullable(),
  withDefault: z.string().default("default"),
});

// Extend objects
const ExtendedSchema = Schema.extend({
  extra: z.boolean(),
});

// Pick/omit fields
const PartialSchema = Schema.pick({ required: true });
const OmittedSchema = Schema.omit({ optional: true });

// Make all optional
const AllOptional = Schema.partial();
```

### Arrays

```typescript
z.array(z.string())            // Array of strings
z.array(z.string()).min(1)     // Non-empty array
z.array(z.string()).max(10)    // Max 10 items
z.string().array()             // Alternative syntax
```

### Unions & Enums

```typescript
// Union
z.union([z.string(), z.number()])
z.string().or(z.number())      // Alternative syntax

// Literal union
z.union([z.literal("a"), z.literal("b")])

// Enum
z.enum(["admin", "user", "guest"])

// Native enum
enum Role { Admin, User }
z.nativeEnum(Role)
```

### Transform

```typescript
const Schema = z.string().transform((val) => val.toUpperCase());

const DateSchema = z.string().transform((val) => new Date(val));

const CoerceSchema = z.coerce.number(); // "123" -> 123
```

## API Request Validation

```typescript
// Define request/response schemas
const CreateUserRequest = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

const UserResponse = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.string().datetime(),
});

// In route handler
app.post("/users", async (c) => {
  const result = CreateUserRequest.safeParse(await c.req.json());

  if (!result.success) {
    return c.json({ errors: result.error.flatten() }, 400);
  }

  const user = await createUser(result.data);
  return c.json(user, 201);
});
```

## Environment Variables

```typescript
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  API_KEY: z.string().min(1),
});

export const env = envSchema.parse(process.env);
```

## Error Handling

```typescript
try {
  const user = UserSchema.parse(data);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.log(error.flatten());
    // { formErrors: [], fieldErrors: { email: ["Invalid email"] } }

    console.log(error.format());
    // { email: { _errors: ["Invalid email"] } }
  }
}
```

## Gotchas

1. **Parse vs safeParse** - `parse` throws, `safeParse` returns result object
2. **Coercion** - Use `z.coerce.number()` for query params (they're strings)
3. **Optional vs nullable** - `optional()` = undefined OK, `nullable()` = null OK
4. **Strict objects** - Use `.strict()` to reject extra properties

## Pairs With

- [hono.md](./hono.md) - Web framework
- [zod-openapi.md](./zod-openapi.md) - OpenAPI generation
- [scalar.md](./scalar.md) - API docs
