# Stack: Python API

Opinionated stack for building production-ready Python APIs.

## Tools

| Layer | Tool | Docs |
|-------|------|------|
| Package Manager | uv | — |
| Framework | FastAPI | [fastapi.md](../tools/python/fastapi.md) |
| Validation | Pydantic | [pydantic.md](../tools/python/pydantic.md) |
| Linting | Ruff | [ruff.md](../tools/python/ruff.md) |
| Testing | pytest | [pytest.md](../tools/python/pytest.md) |
| Logging | structlog | [structlog.md](../tools/python/structlog.md) |
| Git Hooks | pre-commit | [pre-commit-python.md](../tools/python/pre-commit-python.md) |
| Secrets | Gitleaks | [gitleaks.md](../tools/gitleaks.md) |
| Deps Audit | pip-audit | [audit.md](../tools/audit.md) |

## Quick Start

```bash
# Create project
mkdir my-api && cd my-api

# Initialize with uv
uv init
uv add fastapi uvicorn[standard] pydantic pydantic-settings structlog

# Add dev dependencies
uv add --dev pytest pytest-asyncio pytest-cov ruff mypy pre-commit pip-audit

# Initialize pre-commit
pre-commit install
```

## Project Structure

```
my-api/
├── src/
│   ├── __init__.py
│   ├── main.py            # FastAPI app
│   ├── config.py          # Settings
│   ├── logging_config.py  # Structlog setup
│   ├── routers/
│   │   ├── __init__.py
│   │   └── users.py
│   ├── models/
│   │   ├── __init__.py
│   │   └── user.py
│   └── services/
│       ├── __init__.py
│       └── user_service.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   └── test_users.py
├── pyproject.toml
├── .pre-commit-config.yaml
└── .env.example
```

## Configuration Files

### pyproject.toml

```toml
[project]
name = "my-api"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.111.0",
    "uvicorn[standard]>=0.30.0",
    "pydantic>=2.7.0",
    "pydantic-settings>=2.3.0",
    "structlog>=24.2.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.2.0",
    "pytest-asyncio>=0.23.0",
    "pytest-cov>=5.0.0",
    "ruff>=0.5.0",
    "mypy>=1.10.0",
    "pre-commit>=3.7.0",
    "pip-audit>=2.7.0",
]

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E", "W", "F", "I", "B", "C4", "UP", "S", "A"]
ignore = ["E501"]

[tool.ruff.lint.per-file-ignores]
"tests/*" = ["S101"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
addopts = "-v --cov=src --cov-report=term-missing"

[tool.mypy]
strict = true
python_version = "3.12"
```

### .pre-commit-config.yaml

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.5.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.10.0
    hooks:
      - id: mypy
        additional_dependencies: [pydantic, fastapi]

  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks

  - repo: local
    hooks:
      - id: pip-audit
        name: pip-audit
        entry: pip-audit
        language: system
        pass_filenames: false
        stages: [push]
```

## Core Files

### src/config.py

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    log_level: str = "INFO"
    allowed_origins: list[str] = []

    model_config = {"env_file": ".env"}

settings = Settings()
```

### src/logging_config.py

```python
import structlog
import logging
import sys

def configure_logging(json_logs: bool = False, log_level: str = "INFO"):
    processors = [
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
    ]

    if json_logs:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer())

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
    )

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, log_level),
    )
```

### src/main.py

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import structlog

from src.config import settings
from src.logging_config import configure_logging
from src.routers import users

configure_logging(log_level=settings.log_level)
logger = structlog.get_logger()

app = FastAPI(title="My API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router, prefix="/api/users", tags=["users"])

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.on_event("startup")
async def startup():
    logger.info("Application started")
```

### src/routers/users.py

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr

router = APIRouter()

class UserCreate(BaseModel):
    email: EmailStr
    name: str

class UserResponse(BaseModel):
    id: int
    email: str
    name: str

@router.post("/", response_model=UserResponse, status_code=201)
def create_user(user: UserCreate):
    # user is validated automatically
    return UserResponse(id=1, **user.model_dump())

@router.get("/{user_id}", response_model=UserResponse)
def get_user(user_id: int):
    # Fetch user from DB
    raise HTTPException(status_code=404, detail="User not found")
```

## Testing

```python
# tests/conftest.py
import pytest
from fastapi.testclient import TestClient
from src.main import app

@pytest.fixture
def client():
    return TestClient(app)

# tests/test_users.py
def test_create_user(client):
    response = client.post("/api/users/", json={"email": "test@example.com", "name": "Test"})
    assert response.status_code == 201
    assert response.json()["email"] == "test@example.com"
```

## Commands

```bash
# Development
uv run uvicorn src.main:app --reload

# Testing
uv run pytest

# Linting
uv run ruff check .
uv run ruff format .
uv run mypy src

# Security
uv run pip-audit
```

## Security Checklist

- [ ] Gitleaks in pre-commit
- [ ] pip-audit in pre-push
- [ ] Ruff security rules enabled (S)
- [ ] Pydantic validation on all inputs
- [ ] CORS configured with specific origins
- [ ] Secrets via pydantic-settings
