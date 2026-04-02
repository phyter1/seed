# Tool: Clippy

Official Rust linter. Catches common mistakes and improves code quality.

## Install

Included with Rust toolchain. No separate installation needed.

```bash
# Ensure latest
rustup update
rustup component add clippy
```

## Why Clippy

- **Official** - Maintained by Rust team
- **Comprehensive** - 700+ lints
- **Educational** - Explains why and how to fix
- **Integrated** - Works with cargo

## Basic Usage

```bash
# Run clippy
cargo clippy

# Run on all targets (including tests)
cargo clippy --all-targets

# Run on all features
cargo clippy --all-features

# Treat warnings as errors (CI)
cargo clippy -- -D warnings

# Fix automatically
cargo clippy --fix
```

## Configuration

```toml
# Cargo.toml
[lints.clippy]
# Deny these (error)
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"

# Warn on these
clone_on_ref_ptr = "warn"
missing_docs_in_private_items = "warn"

# Allow these
too_many_arguments = "allow"
```

Or in code:

```rust
// Crate-level
#![deny(clippy::unwrap_used)]
#![warn(clippy::clone_on_ref_ptr)]
#![allow(clippy::too_many_arguments)]
```

## Key Lint Categories

```toml
# Cargo.toml - Recommended setup
[lints.clippy]
# Correctness (bugs)
correctness = "deny"

# Suspicious (likely bugs)
suspicious = "warn"

# Style
style = "warn"

# Complexity
complexity = "warn"

# Performance
perf = "warn"

# Pedantic (very strict)
pedantic = "warn"
```

## Important Lints

```rust
// Security & Safety
#![deny(clippy::unwrap_used)]        // Use ? or expect with reason
#![deny(clippy::expect_used)]         // Handle errors properly
#![deny(clippy::panic)]               // No panics in library code
#![deny(clippy::todo)]                // No TODOs in production
#![deny(clippy::unimplemented)]       // No unimplemented in production

// Quality
#![warn(clippy::clone_on_ref_ptr)]    // Clone Arc/Rc explicitly
#![warn(clippy::cognitive_complexity)] // Keep functions simple
#![warn(clippy::missing_errors_doc)]  // Document errors
#![warn(clippy::missing_panics_doc)]  // Document panics

// Performance
#![warn(clippy::inefficient_to_string)]
#![warn(clippy::large_types_passed_by_value)]
```

## Allowing Lints

```rust
// Allow once
#[allow(clippy::too_many_arguments)]
fn complex_function(a: i32, b: i32, c: i32, d: i32, e: i32) {}

// Allow with reason
#[allow(clippy::unwrap_used)] // Safe: validated above
let value = option.unwrap();

// Allow for module
#![allow(clippy::module_name_repetitions)]
```

## CI Integration

```yaml
# .github/workflows/lint.yml
name: Lint
on: [push, pull_request]

jobs:
  clippy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy
      - run: cargo clippy --all-targets --all-features -- -D warnings
```

## With cargo-audit

```bash
# Install
cargo install cargo-audit

# Run security audit
cargo audit

# CI: fail on vulnerabilities
cargo audit --deny warnings
```

## Recommended Setup

```toml
# Cargo.toml
[lints.rust]
unsafe_code = "forbid"

[lints.clippy]
# Errors
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"
todo = "deny"

# Warnings
pedantic = "warn"
nursery = "warn"

# Allowed (too noisy)
missing_errors_doc = "allow"
missing_panics_doc = "allow"
module_name_repetitions = "allow"
```

## Scripts

```toml
# Cargo.toml aliases
[alias]
lint = "clippy --all-targets --all-features -- -D warnings"
```

```bash
cargo lint
```

## IDE Integration

**VSCode with rust-analyzer:**

```json
// .vscode/settings.json
{
  "rust-analyzer.check.command": "clippy",
  "rust-analyzer.check.extraArgs": ["--all-features"]
}
```

## Gotchas

1. **Pedantic is strict** - Enable selectively, not all at once
2. **False positives** - Allow with reason, don't disable globally
3. **Nightly lints** - Some lints only available on nightly
4. **Fix carefully** - `--fix` can change semantics

## Pairs With

- [cargo-audit.md](./cargo-audit.md) - Security audit
- [axum.md](./axum.md) - Web framework
