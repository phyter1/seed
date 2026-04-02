# Tool: Semgrep

Static analysis for finding bugs and security issues. Supports 30+ languages.

## Install

```bash
# macOS
brew install semgrep

# pip
pip install semgrep

# Docker
docker run -v "${PWD}:/src" returntocorp/semgrep semgrep --config auto
```

## Why Semgrep

- **Multi-language** - JS, TS, Python, Go, Java, Ruby, and more
- **Security-focused** - OWASP, CWE rules included
- **Custom rules** - Write your own patterns
- **Fast** - Runs quickly on large codebases

## Commands

```bash
# Auto-detect language and run recommended rules
semgrep --config auto .

# Run specific rulesets
semgrep --config "p/security-audit" .
semgrep --config "p/owasp-top-ten" .
semgrep --config "p/typescript" .

# Multiple configs
semgrep --config "p/security-audit" --config "p/typescript" .

# Specific file/directory
semgrep --config auto src/

# JSON output
semgrep --config auto --json .

# SARIF output (for GitHub)
semgrep --config auto --sarif .
```

## Popular Rulesets

```bash
# Security
semgrep --config "p/security-audit"
semgrep --config "p/owasp-top-ten"
semgrep --config "p/secrets"

# Language-specific
semgrep --config "p/typescript"
semgrep --config "p/python"
semgrep --config "p/golang"
semgrep --config "p/rust"

# Framework-specific
semgrep --config "p/react"
semgrep --config "p/nextjs"
semgrep --config "p/django"
semgrep --config "p/flask"
semgrep --config "p/express"

# CI/CD
semgrep --config "p/ci"
```

## Custom Rules

```yaml
# .semgrep/custom-rules.yml
rules:
  - id: no-console-log
    patterns:
      - pattern: console.log(...)
    message: "Remove console.log before committing"
    languages: [typescript, javascript]
    severity: WARNING

  - id: no-hardcoded-secret
    patterns:
      - pattern: |
          $VAR = "..."
      - metavariable-regex:
          metavariable: $VAR
          regex: (password|secret|api_key|token)
    message: "Possible hardcoded secret in $VAR"
    languages: [typescript, javascript, python]
    severity: ERROR

  - id: sql-injection
    patterns:
      - pattern: |
          $DB.query(`...${$INPUT}...`)
    message: "Possible SQL injection"
    languages: [typescript, javascript]
    severity: ERROR
```

Run custom rules:

```bash
semgrep --config .semgrep/custom-rules.yml .
```

## Configuration File

```yaml
# .semgrep.yml
rules:
  - p/security-audit
  - p/typescript
  - .semgrep/custom-rules.yml

paths:
  include:
    - src/
  exclude:
    - node_modules/
    - dist/
    - "*.test.ts"
```

## CI Integration

### GitHub Actions

```yaml
name: Semgrep
on: [push, pull_request]

jobs:
  semgrep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: returntocorp/semgrep-action@v1
        with:
          config: >-
            p/security-audit
            p/typescript
```

### Pre-commit

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/returntocorp/semgrep
    rev: v1.50.0
    hooks:
      - id: semgrep
        args: ["--config", "p/security-audit", "--error"]
```

## What It Finds

### Security Issues
- SQL injection
- XSS vulnerabilities
- Command injection
- Path traversal
- Hardcoded secrets
- Insecure crypto
- SSRF
- XXE

### Code Quality
- Dead code
- Unused imports
- Anti-patterns
- Performance issues

## Ignoring Findings

```typescript
// nosemgrep: rule-id
const ignored = dangerousOperation();

// nosemgrep
const alsoIgnored = anotherDangerousOp();
```

Or in config:

```yaml
# .semgrep.yml
paths:
  exclude:
    - tests/
    - "*.test.ts"
```

## Scripts

```json
// package.json
{
  "scripts": {
    "security:sast": "semgrep --config 'p/security-audit' --config 'p/typescript' ."
  }
}
```

## Output Formats

```bash
# Text (default)
semgrep --config auto .

# JSON
semgrep --config auto --json . > semgrep-results.json

# SARIF (GitHub Code Scanning)
semgrep --config auto --sarif . > semgrep-results.sarif

# JUnit (CI integration)
semgrep --config auto --junit-xml . > semgrep-results.xml
```

## Gotchas

1. **Auto config** - `--config auto` uses recommended rules but may miss things
2. **False positives** - Review findings, use `nosemgrep` sparingly
3. **Performance** - Large codebases may be slow; exclude `node_modules`
4. **Custom rules** - YAML syntax can be tricky; test thoroughly

## Pairs With

- [gitleaks.md](./gitleaks.md) - Secret scanning
- [audit.md](./audit.md) - Dependency scanning
