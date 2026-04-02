# Tool: pre-commit

Git hooks framework for Python projects. Language-agnostic but Python-first.

## Install

```bash
uv add --dev pre-commit
# or
pip install pre-commit

# Install hooks
pre-commit install
```

## Why pre-commit

- **Language-agnostic** - Supports any tool
- **Cached** - Hooks are cached for speed
- **Easy config** - YAML configuration
- **Rich ecosystem** - Many pre-built hooks

## Configuration

```yaml
# .pre-commit-config.yaml
repos:
  # Ruff (linting + formatting)
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.5.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  # Type checking
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.10.0
    hooks:
      - id: mypy
        additional_dependencies: [types-requests]

  # Secret scanning
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks

  # General hooks
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-json
      - id: check-added-large-files
      - id: check-merge-conflict
      - id: detect-private-key
```

## Commands

```bash
# Install hooks
pre-commit install

# Install commit-msg hooks
pre-commit install --hook-type commit-msg

# Run on all files
pre-commit run --all-files

# Run specific hook
pre-commit run ruff --all-files

# Update hooks to latest versions
pre-commit autoupdate

# Skip hooks (emergency only)
git commit --no-verify -m "message"
```

## Common Hooks

### Python Quality

```yaml
repos:
  # Ruff (replaces flake8, black, isort)
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.5.0
    hooks:
      - id: ruff
        args: [--fix, --exit-non-zero-on-fix]
      - id: ruff-format

  # Type checking
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.10.0
    hooks:
      - id: mypy
        args: [--strict]
        additional_dependencies:
          - types-requests
          - pydantic
```

### Security

```yaml
repos:
  # Secrets
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks

  # Bandit (security linting)
  - repo: https://github.com/PyCQA/bandit
    rev: 1.7.9
    hooks:
      - id: bandit
        args: ["-c", "pyproject.toml"]
        additional_dependencies: ["bandit[toml]"]
```

### General

```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-json
      - id: check-toml
      - id: check-added-large-files
        args: [--maxkb=1000]
      - id: check-merge-conflict
      - id: detect-private-key
      - id: no-commit-to-branch
        args: [--branch, main, --branch, master]
```

### Commit Messages

```yaml
repos:
  - repo: https://github.com/commitizen-tools/commitizen
    rev: v3.27.0
    hooks:
      - id: commitizen
        stages: [commit-msg]
```

## Local Hooks

```yaml
repos:
  - repo: local
    hooks:
      - id: pytest
        name: pytest
        entry: pytest
        language: system
        pass_filenames: false
        always_run: true
        stages: [push]

      - id: custom-check
        name: Custom Check
        entry: python scripts/check.py
        language: system
        files: \.py$
```

## Stages

```yaml
repos:
  - repo: local
    hooks:
      # Run on commit
      - id: lint
        stages: [commit]

      # Run on push
      - id: test
        stages: [push]

      # Run on commit message
      - id: commitizen
        stages: [commit-msg]
```

## CI Integration

```yaml
# .github/workflows/pre-commit.yml
name: pre-commit
on: [push, pull_request]

jobs:
  pre-commit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - uses: pre-commit/action@v3.0.1
```

## Complete Python Setup

```yaml
# .pre-commit-config.yaml
default_language_version:
  python: python3.12

repos:
  # Ruff
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.5.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  # Type checking
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.10.0
    hooks:
      - id: mypy
        additional_dependencies: [pydantic, types-requests]

  # Security
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks

  # General
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files
      - id: detect-private-key

  # Tests on push
  - repo: local
    hooks:
      - id: pytest
        name: pytest
        entry: pytest
        language: system
        pass_filenames: false
        stages: [push]
```

## Gotchas

1. **Install required** - Run `pre-commit install` after clone
2. **Caching** - Hooks are cached; use `pre-commit clean` if issues
3. **CI parity** - Ensure CI runs same hooks as local
4. **Performance** - Many hooks can be slow; optimize stages

## Pairs With

- [ruff.md](./ruff.md) - Linting
- [pytest.md](./pytest.md) - Testing
- [gitleaks.md](./gitleaks.md) - Secret scanning
