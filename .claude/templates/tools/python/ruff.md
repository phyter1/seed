# Tool: Ruff

Extremely fast Python linter and formatter. Replaces Flake8, Black, isort.

## Install

```bash
uv add --dev ruff
# or
pip install ruff
```

## Why Ruff

- **Fast** - Written in Rust, 10-100x faster than alternatives
- **All-in-one** - Linting + formatting + import sorting
- **Compatible** - Implements Flake8, pyupgrade, isort, and more
- **Drop-in** - Easy migration from existing tools

## Configuration

```toml
# pyproject.toml
[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = [
    "E",    # pycodestyle errors
    "W",    # pycodestyle warnings
    "F",    # Pyflakes
    "I",    # isort
    "B",    # flake8-bugbear
    "C4",   # flake8-comprehensions
    "UP",   # pyupgrade
    "S",    # flake8-bandit (security)
    "A",    # flake8-builtins
]
ignore = [
    "E501",  # Line too long (handled by formatter)
]

[tool.ruff.lint.per-file-ignores]
"tests/*" = ["S101"]  # Allow assert in tests

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
```

## Commands

```bash
# Lint
ruff check .

# Lint and fix
ruff check --fix .

# Format
ruff format .

# Check formatting
ruff format --check .

# Specific file
ruff check src/main.py
```

## Scripts

```toml
# pyproject.toml
[project.scripts]
lint = "ruff check ."
lint-fix = "ruff check --fix ."
format = "ruff format ."
```

Or in a Makefile:

```makefile
.PHONY: lint format

lint:
	ruff check .

lint-fix:
	ruff check --fix .

format:
	ruff format .

check: lint
	ruff format --check .
```

## Key Rule Sets

```toml
[tool.ruff.lint]
select = [
    # Essential
    "E",      # pycodestyle errors
    "F",      # Pyflakes
    "I",      # isort (import sorting)

    # Recommended
    "B",      # flake8-bugbear (common bugs)
    "C4",     # flake8-comprehensions
    "UP",     # pyupgrade (modern Python)

    # Security
    "S",      # flake8-bandit

    # Quality
    "SIM",    # flake8-simplify
    "TCH",    # flake8-type-checking
    "RUF",    # Ruff-specific rules
]
```

## Security Rules (Bandit)

```toml
[tool.ruff.lint]
select = ["S"]  # Enable all security rules

# S101 - assert used
# S102 - exec used
# S103 - bad file permissions
# S104 - hardcoded bind all interfaces
# S105 - hardcoded password
# S106 - hardcoded password in function arg
# S107 - hardcoded password default
# S108 - hardcoded temp file
# S110 - try-except-pass
# S112 - try-except-continue
```

## Import Sorting

```toml
[tool.ruff.lint.isort]
known-first-party = ["myapp"]
force-single-line = true
lines-after-imports = 2
```

## VSCode Integration

Install extension: `charliermarsh.ruff`

```json
// .vscode/settings.json
{
  "[python]": {
    "editor.defaultFormatter": "charliermarsh.ruff",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.fixAll.ruff": "explicit",
      "source.organizeImports.ruff": "explicit"
    }
  }
}
```

## With pre-commit

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.5.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
```

## Ignoring Rules

```python
# Ignore specific line
x = eval(input())  # noqa: S307

# Ignore specific rules for line
x = 1  # noqa: E501, F841

# Ignore file
# ruff: noqa

# Ignore specific rules for file
# ruff: noqa: E501, F841
```

## Migration from Black + Flake8 + isort

```bash
# Remove old tools
pip uninstall black flake8 isort

# Install ruff
pip install ruff

# Run both lint and format
ruff check --fix .
ruff format .
```

## Gotchas

1. **Not identical to Black** - Formatting is similar but may differ slightly
2. **Rule names differ** - Check ruff docs for equivalent rules
3. **Fast = strict** - Catches more issues than Flake8 by default
4. **pyproject.toml preferred** - Over ruff.toml or .ruff.toml

## Pairs With

- [fastapi.md](./fastapi.md) - Web framework
- [pytest.md](./pytest.md) - Testing
- [pre-commit-python.md](./pre-commit-python.md) - Git hooks
