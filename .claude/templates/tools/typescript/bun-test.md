# Tool: Bun Test

Bun's built-in test runner. Fast, Jest-compatible, zero config.

## Install

Built into Bun. No installation needed.

## Why Bun Test

- **Zero config** - Works out of the box
- **Fast** - Native Bun speed
- **Jest compatible** - Same API
- **Built-in** - No extra dependencies

## Basic Usage

```typescript
// math.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

describe("math", () => {
  it("adds numbers", () => {
    expect(1 + 2).toBe(3);
  });

  it("works with async", async () => {
    const result = await Promise.resolve(42);
    expect(result).toBe(42);
  });
});
```

## Assertions

```typescript
import { expect } from "bun:test";

// Equality
expect(value).toBe(3);
expect(value).toEqual({ a: 1 });
expect(value).toStrictEqual(obj);

// Truthiness
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeNull();
expect(value).toBeUndefined();

// Numbers
expect(value).toBeGreaterThan(3);
expect(value).toBeLessThan(10);

// Strings & Arrays
expect(str).toContain("sub");
expect(arr).toContain(item);
expect(arr).toHaveLength(3);

// Objects
expect(obj).toHaveProperty("key");
expect(obj).toMatchObject({ a: 1 });

// Errors
expect(() => fn()).toThrow();
expect(() => fn()).toThrowError("message");
```

## Mocking

```typescript
import { mock, spyOn } from "bun:test";

// Mock function
const mockFn = mock((x: number) => x * 2);
mockFn(5); // 10
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledWith(5);

// Spy on method
const spy = spyOn(console, "log");
console.log("test");
expect(spy).toHaveBeenCalledWith("test");
```

## Setup & Teardown

```typescript
import { describe, it, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

describe("database", () => {
  beforeAll(async () => {
    await db.connect();
  });

  afterAll(async () => {
    await db.disconnect();
  });

  beforeEach(() => {
    // Before each test
  });

  afterEach(() => {
    // After each test
  });

  it("queries data", async () => {
    const result = await db.query("SELECT 1");
    expect(result).toBeDefined();
  });
});
```

## Testing Hono Apps

```typescript
import { describe, it, expect } from "bun:test";
import app from "./index";

describe("API", () => {
  it("GET / returns hello", async () => {
    const res = await app.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello!");
  });

  it("POST /users creates user", async () => {
    const res = await app.fetch(
      new Request("http://localhost/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test" }),
      })
    );
    expect(res.status).toBe(201);
  });
});
```

## Testing Subprocesses

```typescript
import { describe, it, expect } from "bun:test";

describe("subprocess", () => {
  it("runs command", async () => {
    const proc = Bun.spawn(["echo", "hello"]);
    const output = await new Response(proc.stdout).text();
    expect(output.trim()).toBe("hello");
  });

  it("handles failure", async () => {
    const proc = Bun.spawn(["false"]);
    await proc.exited;
    expect(proc.exitCode).not.toBe(0);
  });
});
```

## Commands

```bash
bun test              # Run all tests
bun test --watch      # Watch mode
bun test --coverage   # With coverage
bun test path/to/file # Run specific file
bun test --timeout 10000  # Set timeout (ms)
```

## Configuration

```toml
# bunfig.toml
[test]
coverage = true
coverageDir = "coverage"
timeout = 5000
```

## Scripts

```json
{
  "scripts": {
    "test": "bun test",
    "test:watch": "bun test --watch",
    "test:coverage": "bun test --coverage"
  }
}
```

## Gotchas

1. **Import from bun:test** - Not `vitest` or `jest`
2. **Native speed** - Tests run very fast, good for TDD
3. **Coverage** - Use `--coverage` flag, no extra package needed
4. **Jest compat** - Most Jest patterns work, but check edge cases

## Pairs With

- [bun.md](./bun.md) - Runtime
- [hono.md](./hono.md) - Web framework
- [biome.md](./biome.md) - Linting
