# Tool: Vitest

Next-generation testing framework. Vite-native, Jest-compatible.

## Install

```bash
bun add -d vitest @vitest/coverage-v8
# or
npm install -D vitest @vitest/coverage-v8
```

## Why Vitest

- **Fast** - Vite's transform pipeline, parallel execution
- **Jest compatible** - Same API, easy migration
- **TypeScript native** - No config needed
- **Watch mode** - Instant feedback

## Configuration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,           // No imports needed for describe/it/expect
    environment: "node",     // or "jsdom" for browser
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["node_modules", "dist"],
    },
  },
});
```

## Basic Usage

```typescript
// math.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { add, multiply } from "./math";

describe("math", () => {
  it("adds numbers", () => {
    expect(add(1, 2)).toBe(3);
  });

  it("multiplies numbers", () => {
    expect(multiply(2, 3)).toBe(6);
  });
});
```

## Assertions

```typescript
// Equality
expect(value).toBe(3);              // Strict equality
expect(value).toEqual({ a: 1 });    // Deep equality
expect(value).toStrictEqual(obj);   // Strict deep equality

// Truthiness
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeNull();
expect(value).toBeUndefined();
expect(value).toBeDefined();

// Numbers
expect(value).toBeGreaterThan(3);
expect(value).toBeLessThan(10);
expect(value).toBeCloseTo(0.3, 5);  // Floating point

// Strings
expect(str).toMatch(/regex/);
expect(str).toContain("substring");

// Arrays
expect(arr).toContain(item);
expect(arr).toHaveLength(3);

// Objects
expect(obj).toHaveProperty("key");
expect(obj).toMatchObject({ a: 1 });

// Errors
expect(() => fn()).toThrow();
expect(() => fn()).toThrowError("message");

// Async
await expect(promise).resolves.toBe(value);
await expect(promise).rejects.toThrow();
```

## Mocking

```typescript
import { vi, describe, it, expect } from "vitest";

// Mock function
const mockFn = vi.fn();
mockFn.mockReturnValue(42);
mockFn.mockResolvedValue(42);      // For async
mockFn.mockImplementation((x) => x * 2);

// Verify calls
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledWith(1, 2);
expect(mockFn).toHaveBeenCalledTimes(3);

// Mock module
vi.mock("./module", () => ({
  someFunction: vi.fn().mockReturnValue("mocked"),
}));

// Spy on method
const spy = vi.spyOn(object, "method");
```

## Setup & Teardown

```typescript
import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";

beforeAll(async () => {
  // Run once before all tests
  await db.connect();
});

afterAll(async () => {
  // Run once after all tests
  await db.disconnect();
});

beforeEach(() => {
  // Run before each test
});

afterEach(() => {
  // Run after each test
  vi.clearAllMocks();
});
```

## Testing React Components

```typescript
// Button.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders text", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button")).toHaveTextContent("Click me");
  });

  it("calls onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalled();
  });
});
```

## Testing APIs

```typescript
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "./app";

describe("GET /users", () => {
  it("returns users", async () => {
    const res = await request(app).get("/users");
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
  });
});
```

## Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui"
  }
}
```

## Commands

```bash
vitest              # Watch mode
vitest run          # Run once
vitest run --coverage
vitest --ui         # Browser UI
vitest related src/file.ts  # Test related files
```

## Gotchas

1. **globals** - Set `globals: true` to avoid importing describe/it/expect
2. **vi vs jest** - Use `vi.fn()` not `jest.fn()`
3. **Async tests** - Always `await` or return promises
4. **Coverage** - Install `@vitest/coverage-v8` separately

## Pairs With

- [bun.md](./bun.md) / [node.md](./node.md) - Runtime
- [biome.md](./biome.md) - Linting
