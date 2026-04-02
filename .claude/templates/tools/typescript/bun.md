# Tool: Bun

Fast all-in-one JavaScript runtime, bundler, test runner, and package manager.

## Install

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Homebrew
brew install oven-sh/bun/bun

# Windows
powershell -c "irm bun.sh/install.ps1 | iex"
```

## Why Bun

- **Fast** - 4x faster than Node.js for many operations
- **Native TypeScript** - No transpilation step needed
- **Built-in tooling** - Test runner, bundler, package manager
- **Node compatible** - Drop-in replacement for most Node.js code

## Quick Start

```bash
# Initialize project
bun init

# Install dependencies
bun install

# Add package
bun add hono zod

# Add dev dependency
bun add -d typescript @types/bun

# Run TypeScript directly
bun run src/index.ts

# Run with hot reload
bun run --hot src/index.ts
```

## Scripts

```json
{
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target bun",
    "start": "bun run dist/index.js",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  }
}
```

## Configuration

```json
// bunfig.toml (optional)
[install]
auto = "force"  // Always use lockfile

[test]
coverage = true
coverageDir = "coverage"
```

## Testing

```typescript
// example.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

describe("feature", () => {
  it("works", () => {
    expect(1 + 1).toBe(2);
  });
});
```

```bash
bun test              # Run all tests
bun test --watch      # Watch mode
bun test --coverage   # With coverage
```

## Security

```bash
# Audit dependencies
bun audit

# Update dependencies
bun update
```

## Gotchas

1. **Not 100% Node compatible** - Some edge cases differ. Test thoroughly.
2. **Newer ecosystem** - Some packages may have issues. Check compatibility.
3. **Windows support** - Still maturing. Linux/macOS more stable.

## Pairs With

- [hono.md](./hono.md) - Web framework
- [biome.md](./biome.md) - Linting
- [bun-test.md](./bun-test.md) - Testing (built-in)
- [vitest.md](./vitest.md) - Testing (alternative)
