# Tool: Biome

Fast formatter and linter for JavaScript, TypeScript, JSON. Replaces ESLint + Prettier.

## Install

```bash
bun add -d @biomejs/biome
# or
npm install -D @biomejs/biome

# Initialize config
bunx biome init
```

## Why Biome

- **Fast** - Written in Rust, 10-100x faster than ESLint
- **All-in-one** - Linting + formatting in one tool
- **Zero config** - Sensible defaults
- **IDE support** - VSCode extension available

## Configuration

```json
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"
      },
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      },
      "style": {
        "noNonNullAssertion": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always"
    }
  }
}
```

## Commands

```bash
# Check for issues
bunx biome check .

# Fix issues
bunx biome check --fix .

# Format only
bunx biome format .

# Format and write
bunx biome format --write .

# Lint only
bunx biome lint .

# Check specific files
bunx biome check src/index.ts
```

## Scripts

```json
{
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --fix .",
    "format": "biome format --write ."
  }
}
```

## VSCode Integration

Install extension: `biomejs.biome`

```json
// .vscode/settings.json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "quickfix.biome": "explicit",
    "source.organizeImports.biome": "explicit"
  }
}
```

## With lint-staged

```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json}": ["biome check --fix"]
  }
}
```

## Key Rules

```json
{
  "linter": {
    "rules": {
      // Security
      "suspicious": {
        "noExplicitAny": "error",
        "noDangerouslySetInnerHtml": "warn"
      },
      // Correctness
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error",
        "useExhaustiveDependencies": "warn"
      },
      // Style
      "style": {
        "noNonNullAssertion": "warn",
        "useConst": "error"
      },
      // Complexity
      "complexity": {
        "noForEach": "warn"
      }
    }
  }
}
```

## Ignoring Files

```json
// biome.json
{
  "files": {
    "ignore": [
      "node_modules",
      "dist",
      "build",
      ".next",
      "coverage"
    ]
  }
}
```

## Ignoring Rules

```typescript
// Ignore next line
// biome-ignore lint/suspicious/noExplicitAny: reason here
const value: any = something;

// Ignore block
/* biome-ignore lint/correctness/noUnusedVariables: temporary */
const unused = "will use later";
```

## Migration from ESLint

```bash
# Auto-migrate
bunx biome migrate eslint --write
```

## Gotchas

1. **Not 100% ESLint compatible** - Some rules differ slightly
2. **JSON support** - Formats JSON files too (great for configs)
3. **No plugins** - All rules built-in, can't add custom rules yet
4. **Fast but strict** - Default rules are strict, adjust as needed

## Pairs With

- [bun.md](./bun.md) / [node.md](./node.md) - Runtime
- [husky.md](./husky.md) - Git hooks
- [vitest.md](./vitest.md) - Testing
