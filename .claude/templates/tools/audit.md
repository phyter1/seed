# Tool: Dependency Audit

Scan dependencies for known vulnerabilities. Language-specific tools.

## JavaScript/TypeScript

### npm audit

```bash
# Check vulnerabilities
npm audit

# Fix automatically
npm audit fix

# Fix including breaking changes
npm audit fix --force

# JSON output
npm audit --json

# Only production deps
npm audit --production
```

### bun audit

```bash
# Check vulnerabilities
bun audit

# Update dependencies
bun update
```

### pnpm audit

```bash
# Check vulnerabilities
pnpm audit

# Fix
pnpm audit --fix
```

## Python

### pip-audit

```bash
# Install
pip install pip-audit

# Run audit
pip-audit

# Fix vulnerabilities
pip-audit --fix

# Check requirements file
pip-audit -r requirements.txt

# JSON output
pip-audit --format=json
```

### Safety (alternative)

```bash
# Install
pip install safety

# Run
safety check

# Check requirements file
safety check -r requirements.txt
```

## Go

### govulncheck

```bash
# Install
go install golang.org/x/vuln/cmd/govulncheck@latest

# Run
govulncheck ./...

# Check specific package
govulncheck -test ./pkg/...
```

### nancy (Sonatype)

```bash
# Install
go install github.com/sonatype-nexus-community/nancy@latest

# Run
go list -json -deps ./... | nancy sleuth
```

## Rust

### cargo audit

```bash
# Install
cargo install cargo-audit

# Run
cargo audit

# Fix automatically
cargo audit fix

# JSON output
cargo audit --json
```

See [cargo-audit.md](./cargo-audit.md) for details.

## CI Integration

### GitHub Actions (JS)

```yaml
- name: Audit dependencies
  run: npm audit --audit-level=high
```

### GitHub Actions (Python)

```yaml
- name: Install pip-audit
  run: pip install pip-audit
- name: Audit dependencies
  run: pip-audit
```

### GitHub Actions (Go)

```yaml
- name: Install govulncheck
  run: go install golang.org/x/vuln/cmd/govulncheck@latest
- name: Run govulncheck
  run: govulncheck ./...
```

### GitHub Actions (Rust)

```yaml
- name: Install cargo-audit
  run: cargo install cargo-audit
- name: Run audit
  run: cargo audit
```

## Pre-push Hook

```bash
# .husky/pre-push (JS)
#!/bin/sh
npm audit --audit-level=high || exit 1
```

```bash
# .git/hooks/pre-push (Python)
#!/bin/sh
pip-audit || exit 1
```

## Policy Configuration

### npm

```json
// package.json
{
  "overrides": {
    "vulnerable-package": "^2.0.0"
  }
}
```

### pip-audit ignore

```bash
# Ignore specific vulnerability
pip-audit --ignore-vuln PYSEC-2023-123
```

### cargo audit ignore

```toml
# .cargo/audit.toml
[advisories]
ignore = ["RUSTSEC-2023-0001"]
```

## Severity Levels

| Level | Action |
|-------|--------|
| Critical | Fix immediately, block merge |
| High | Fix before release |
| Moderate | Fix in next sprint |
| Low | Track, fix when convenient |

## Scripts

```json
// package.json (JS)
{
  "scripts": {
    "security:deps": "npm audit --audit-level=high"
  }
}
```

```toml
# pyproject.toml (Python)
[tool.taskipy.tasks]
security = "pip-audit"
```

```makefile
# Makefile (Go)
.PHONY: security
security:
	govulncheck ./...
```

## Gotchas

1. **False positives** - Some vulnerabilities may not affect your usage
2. **Transitive deps** - Vulnerabilities often in nested dependencies
3. **Breaking fixes** - `--force` may introduce breaking changes
4. **CI blocking** - Use `--audit-level=high` to only block on severe issues

## Pairs With

- [gitleaks.md](./gitleaks.md) - Secret scanning
- [semgrep.md](./semgrep.md) - Static analysis
