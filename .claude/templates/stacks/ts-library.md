# Stack: TypeScript Library

Opinionated stack for building and publishing NPM packages.

## Tools

| Layer | Tool | Docs |
|-------|------|------|
| Runtime | Bun | [bun.md](../tools/typescript/bun.md) |
| Bundler | tsup | — |
| Versioning | Changesets | — |
| Linting | Biome | [biome.md](../tools/typescript/biome.md) |
| Testing | Vitest | [vitest.md](../tools/typescript/vitest.md) |
| Git Hooks | Husky | [husky.md](../tools/typescript/husky.md) |
| Secrets | Gitleaks | [gitleaks.md](../tools/gitleaks.md) |

## Quick Start

```bash
mkdir my-lib && cd my-lib
bun init -y

# Install dependencies
bun add -d typescript tsup vitest @biomejs/biome husky lint-staged @changesets/cli

# Initialize tools
bunx biome init
bunx husky init
bunx changeset init
```

## Project Structure

```
my-lib/
├── src/
│   ├── index.ts        # Main entry (barrel OK for libraries)
│   ├── utils.ts
│   └── utils.test.ts
├── dist/               # Built output
├── biome.json
├── tsconfig.json
├── tsup.config.ts
├── package.json
├── .changeset/
│   └── config.json
└── .husky/
```

## Configuration Files

### package.json

```json
{
  "name": "my-lib",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "dev": "tsup --watch",
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "lint:fix": "biome check --fix .",
    "typecheck": "tsc --noEmit",
    "check": "bun run lint && bun run typecheck && bun test",
    "prepublishOnly": "bun run check && bun run build",
    "release": "changeset publish",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json}": ["biome check --fix"]
  },
  "devDependencies": {
    "@biomejs/biome": "latest",
    "@changesets/cli": "latest",
    "husky": "latest",
    "lint-staged": "latest",
    "tsup": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

### tsup.config.ts

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
});
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules"]
}
```

### .changeset/config.json

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

## Barrel Exports (OK for Libraries)

For libraries, a single entry point is expected:

```typescript
// src/index.ts
export { myFunction } from "./utils";
export { MyClass } from "./class";
export type { MyType } from "./types";
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
bun test
bun run typecheck
bun run build
```

## Release Workflow

```bash
# 1. Make changes and commit

# 2. Create changeset
bunx changeset
# Follow prompts: select packages, bump type, description

# 3. Commit changeset
git add .changeset/*.md
git commit -m "chore: add changeset"

# 4. Version packages (usually in CI)
bunx changeset version
git add .
git commit -m "chore: version packages"

# 5. Publish (usually in CI)
bun run build
bunx changeset publish
git push --follow-tags
```

## CI/CD

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - run: bun install
      - run: bun run check

      - name: Create Release PR or Publish
        uses: changesets/action@v1
        with:
          publish: bunx changeset publish
          version: bunx changeset version
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Testing

```typescript
// src/utils.test.ts
import { describe, it, expect } from "vitest";
import { myFunction } from "./utils";

describe("myFunction", () => {
  it("works", () => {
    expect(myFunction(1, 2)).toBe(3);
  });
});
```

## Publishing Checklist

- [ ] Tests pass
- [ ] Types are correct (`bun run typecheck`)
- [ ] Build succeeds
- [ ] `exports` field correct in package.json
- [ ] `files` field includes only dist
- [ ] Changeset created with proper description
- [ ] No secrets in published code
