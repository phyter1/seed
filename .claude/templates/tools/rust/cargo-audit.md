# Tool: cargo-audit

Audit Rust dependencies for known security vulnerabilities.

## Install

```bash
cargo install cargo-audit
```

## Why cargo-audit

- **Official** - Maintained by RustSec
- **Fast** - Quick vulnerability checks
- **CI-friendly** - Easy automation
- **Auto-fix** - Can update vulnerable deps

## Commands

```bash
# Check for vulnerabilities
cargo audit

# Auto-fix (update Cargo.lock)
cargo audit fix

# JSON output
cargo audit --json

# Deny warnings (CI)
cargo audit --deny warnings

# Check specific advisory database
cargo audit --db ./advisory-db
```

## Configuration

```toml
# .cargo/audit.toml

[advisories]
# Ignore specific advisories
ignore = [
    "RUSTSEC-2023-0001",  # Add reason in comment
]
# Warn instead of error for unmaintained crates
unmaintained = "warn"
# Warn for yanked crates
yanked = "warn"

[output]
# Output format
format = "terminal"  # or "json"
# Quiet mode
quiet = false

[database]
# Path to advisory database (default: ~/.cargo/advisory-db)
# path = "./advisory-db"
# Fetch from Git
fetch = true
```

## CI Integration

### GitHub Actions

```yaml
name: Security
on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - name: Install cargo-audit
        run: cargo install cargo-audit
      - name: Run audit
        run: cargo audit --deny warnings
```

### GitLab CI

```yaml
audit:
  image: rust:latest
  script:
    - cargo install cargo-audit
    - cargo audit --deny warnings
```

## Pre-push Hook

```bash
#!/bin/sh
# .git/hooks/pre-push
cargo audit --deny warnings || exit 1
```

## Handling Vulnerabilities

### Check Details

```bash
# Get more info about a vulnerability
cargo audit --json | jq '.vulnerabilities.list[] | select(.advisory.id == "RUSTSEC-2023-0001")'
```

### Update Vulnerable Dependency

```bash
# Auto-fix (updates Cargo.lock)
cargo audit fix

# Or manually update
cargo update -p vulnerable-crate
```

### Ignore (Temporarily)

```toml
# .cargo/audit.toml
[advisories]
ignore = [
    "RUSTSEC-2023-0001",  # Waiting for upstream fix
]
```

## Integration with cargo-deny

For more comprehensive checks, use `cargo-deny`:

```bash
cargo install cargo-deny
cargo deny check
```

```toml
# deny.toml
[advisories]
vulnerability = "deny"
unmaintained = "warn"
yanked = "warn"
notice = "warn"
ignore = []

[licenses]
unlicensed = "deny"
allow = ["MIT", "Apache-2.0", "BSD-3-Clause"]

[bans]
multiple-versions = "warn"
deny = ["openssl"]  # Prefer rustls
```

## What It Checks

- **RUSTSEC advisories** - Known vulnerabilities
- **Unmaintained crates** - No recent activity
- **Yanked versions** - Removed from crates.io

## Scripts

```toml
# Cargo.toml
[alias]
audit = "audit --deny warnings"
```

Or Makefile:

```makefile
.PHONY: security
security:
	cargo audit --deny warnings
```

## Output Example

```
    Fetching advisory database from `https://github.com/RustSec/advisory-db.git`
      Loaded 500 security advisories (from ~/.cargo/advisory-db)
    Scanning Cargo.lock for vulnerabilities (200 crate dependencies)
Crate:     regex
Version:   1.5.4
Title:     Regex denial of service
Date:      2022-03-08
ID:        RUSTSEC-2022-0013
URL:       https://rustsec.org/advisories/RUSTSEC-2022-0013
Solution:  Upgrade to >=1.5.5

error: 1 vulnerability found!
```

## Gotchas

1. **Lock file required** - Needs `Cargo.lock` to exist
2. **Transitive deps** - Vulnerabilities often in nested dependencies
3. **False positives** - Some advisories may not affect your usage
4. **Network required** - Fetches advisory DB (unless local)

## Pairs With

- [clippy.md](./clippy.md) - Linting
- [axum.md](./axum.md) - Web framework
