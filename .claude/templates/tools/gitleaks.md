# Tool: Gitleaks

Scan git repositories for secrets. Prevent credential leaks.

## Install

```bash
# macOS
brew install gitleaks

# Linux
wget https://github.com/gitleaks/gitleaks/releases/download/v8.18.0/gitleaks_8.18.0_linux_x64.tar.gz
tar -xzf gitleaks_8.18.0_linux_x64.tar.gz

# Go
go install github.com/gitleaks/gitleaks/v8@latest
```

## Why Gitleaks

- **Fast** - Scans large repos quickly
- **Comprehensive** - 150+ built-in rules
- **Pre-commit** - Block commits with secrets
- **CI-friendly** - Easy integration

## Commands

```bash
# Scan working directory
gitleaks detect --source .

# Scan staged files (pre-commit)
gitleaks protect --staged

# Scan git history
gitleaks detect --source . --log-opts="--all"

# Verbose output
gitleaks detect --source . --verbose

# Output to file
gitleaks detect --source . --report-path report.json --report-format json
```

## Configuration

```toml
# .gitleaks.toml
[extend]
useDefault = true

# Allow specific paths
[allowlist]
paths = [
  '''\.env\.example$''',
  '''\.md$''',
  '''test/fixtures/''',
]

# Allow specific commits (for historical secrets)
commits = [
  "abc123def456",
]

# Allow specific regexes
regexes = [
  '''EXAMPLE_API_KEY''',
]

# Custom rules
[[rules]]
id = "custom-api-key"
description = "Custom API Key"
regex = '''custom_api_key_[a-zA-Z0-9]{32}'''
tags = ["key", "custom"]

# Extend existing rule
[[rules]]
id = "aws-access-key"
allowlist = { regexes = ['''AKIA[A-Z0-9]{16}EXAMPLE'''] }
```

## Pre-commit Hook

### With Husky (JS/TS)

```bash
# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

gitleaks protect --staged --verbose
```

### With pre-commit (Python)

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
```

### Manual git hook

```bash
# .git/hooks/pre-commit
#!/bin/sh
gitleaks protect --staged --verbose
exit $?
```

## CI Integration

### GitHub Actions

```yaml
name: Security
on: [push, pull_request]

jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for scanning
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### GitLab CI

```yaml
gitleaks:
  image: zricethezav/gitleaks:latest
  script:
    - gitleaks detect --source . --verbose
```

## What It Detects

- AWS Access Keys & Secrets
- GCP API Keys
- GitHub Tokens
- Slack Tokens
- Private Keys (RSA, SSH)
- Database Connection Strings
- API Keys (generic patterns)
- Passwords in URLs
- JWT Tokens
- Azure Keys
- And 150+ more patterns

## Handling False Positives

```toml
# .gitleaks.toml

# Ignore specific file
[allowlist]
paths = ['''test/fixtures/fake-keys\.txt''']

# Ignore specific pattern
[allowlist]
regexes = ['''FAKE_KEY_FOR_TESTING''']

# Ignore specific commit
[allowlist]
commits = ["abc123"]
```

Or inline in code:

```
# gitleaks:allow
API_KEY = "test_key_not_real"
```

## Baseline for Legacy Repos

```bash
# Create baseline of existing secrets
gitleaks detect --source . --report-path .gitleaks-baseline.json

# Future scans ignore baseline
gitleaks detect --source . --baseline-path .gitleaks-baseline.json
```

## Scripts

```json
// package.json
{
  "scripts": {
    "security:secrets": "gitleaks detect --source .",
    "security:staged": "gitleaks protect --staged"
  }
}
```

## Gotchas

1. **Full history** - Use `--log-opts="--all"` to scan all branches
2. **Large repos** - May be slow; use baseline for legacy code
3. **False positives** - Configure allowlist, don't disable rules
4. **Staged only** - `protect` only checks staged files

## Pairs With

- [husky.md](./husky.md) - JS/TS git hooks
- [pre-commit-python.md](./pre-commit-python.md) - Python git hooks
- [audit.md](./audit.md) - Dependency scanning
