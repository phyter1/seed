# Tool: golangci-lint

Fast Go linter aggregator. Runs 100+ linters in parallel.

## Install

```bash
# macOS
brew install golangci-lint

# Linux/Windows
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# Or download binary
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(go env GOPATH)/bin
```

## Why golangci-lint

- **Fast** - Parallel execution, smart caching
- **Comprehensive** - 100+ linters in one tool
- **Configurable** - Enable only what you need
- **CI-friendly** - Good defaults for automation

## Configuration

```yaml
# .golangci.yml
run:
  timeout: 5m
  tests: true

linters:
  enable:
    - errcheck      # Check error handling
    - gosimple      # Simplify code
    - govet         # Go vet checks
    - ineffassign   # Unused assignments
    - staticcheck   # Static analysis
    - unused        # Unused code
    - gosec         # Security issues
    - gofmt         # Formatting
    - goimports     # Import formatting
    - misspell      # Spelling
    - unparam       # Unused parameters
    - gocritic      # Code criticism

linters-settings:
  errcheck:
    check-type-assertions: true
    check-blank: true

  gosec:
    excludes:
      - G104  # Audit errors not checked

  govet:
    check-shadowing: true

issues:
  exclude-rules:
    - path: _test\.go
      linters:
        - errcheck
        - gosec
```

## Commands

```bash
# Run all enabled linters
golangci-lint run

# Run specific linters
golangci-lint run --enable=gosec,errcheck

# Run on specific files
golangci-lint run ./pkg/...

# Fix issues (where possible)
golangci-lint run --fix

# List available linters
golangci-lint linters

# Show config
golangci-lint config
```

## Key Linters

```yaml
linters:
  enable:
    # Essential
    - errcheck        # Unchecked errors
    - govet           # Go vet
    - staticcheck     # Advanced static analysis

    # Security
    - gosec           # Security issues

    # Style
    - gofmt           # Formatting
    - goimports       # Import order
    - misspell        # Spelling

    # Quality
    - ineffassign     # Dead assignments
    - unused          # Unused code
    - unparam         # Unused params
    - gocritic        # Opinionated checks

    # Bugs
    - bodyclose       # HTTP body close
    - noctx           # HTTP without context
    - sqlclosecheck   # SQL close
```

## Security Linters (gosec)

```yaml
linters-settings:
  gosec:
    includes:
      - G101  # Hardcoded credentials
      - G102  # Bind to all interfaces
      - G103  # Unsafe block
      - G104  # Unhandled errors
      - G107  # URL in variable
      - G108  # Profiling endpoint
      - G109  # Integer overflow
      - G110  # Decompression bomb
      - G201  # SQL injection
      - G202  # SQL injection
      - G203  # HTML template injection
      - G204  # Command injection
      - G301  # Poor file permissions
      - G302  # Poor file permissions
      - G303  # Predictable temp file
      - G304  # File path injection
      - G305  # Zip slip
      - G306  # Poor file permissions
      - G307  # Poor file permissions
      - G401  # Weak crypto
      - G402  # TLS insecure
      - G403  # RSA key size
      - G404  # Weak random
      - G501  # Import blocklist
      - G502  # Import blocklist
      - G503  # Import blocklist
      - G601  # Implicit aliasing
```

## With pre-commit

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/golangci/golangci-lint
    rev: v1.59.0
    hooks:
      - id: golangci-lint
```

## Makefile Integration

```makefile
.PHONY: lint lint-fix

lint:
	golangci-lint run

lint-fix:
	golangci-lint run --fix

# Run before commit
check: lint test
```

## Ignoring Issues

```go
// Ignore specific issue
//nolint:errcheck
_ = file.Close()

// Ignore multiple
//nolint:errcheck,gosec
result := something()

// Ignore with reason
//nolint:errcheck // Error is logged elsewhere
_ = file.Close()
```

## CI Integration

```yaml
# .github/workflows/lint.yml
name: Lint
on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.22"
      - uses: golangci/golangci-lint-action@v6
        with:
          version: latest
```

## Gotchas

1. **Slow first run** - Caches after first run
2. **Config location** - Must be in project root
3. **Go version** - Some linters need recent Go versions
4. **Too many linters** - Start with essentials, add gradually

## Pairs With

- [go-test.md](./go-test.md) - Testing
- [gosec](https://github.com/securego/gosec) - Security (included)
