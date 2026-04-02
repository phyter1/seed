# Tool: FastAPI

Modern, fast Python web framework. Auto-generates OpenAPI docs from type hints.

## Install

```bash
uv add fastapi uvicorn[standard]
# or
pip install fastapi uvicorn[standard]
```

## Why FastAPI

- **Fast** - One of the fastest Python frameworks (Starlette + Pydantic)
- **Type-safe** - Full Python type hint support
- **Auto docs** - OpenAPI/Swagger generated automatically
- **Async native** - Built on ASGI, supports async/await

## Quick Start

```python
# src/main.py
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello World"}

@app.get("/users/{user_id}")
def read_user(user_id: int):
    return {"user_id": user_id}
```

```bash
uvicorn src.main:app --reload
# Docs at http://localhost:8000/docs
```

## With Pydantic

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr

app = FastAPI()

class UserCreate(BaseModel):
    email: EmailStr
    name: str

class User(BaseModel):
    id: int
    email: EmailStr
    name: str

@app.post("/users", response_model=User, status_code=201)
def create_user(user: UserCreate):
    # user is validated automatically
    return User(id=1, **user.model_dump())

@app.get("/users/{user_id}", response_model=User)
def get_user(user_id: int):
    user = db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
```

## Dependency Injection

```python
from fastapi import Depends, FastAPI
from typing import Annotated

app = FastAPI()

def get_db():
    db = Database()
    try:
        yield db
    finally:
        db.close()

@app.get("/users")
def list_users(db: Annotated[Database, Depends(get_db)]):
    return db.get_users()
```

## Middleware

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request, call_next):
    print(f"{request.method} {request.url.path}")
    response = await call_next(request)
    return response
```

## Project Structure

```
src/
  main.py           # App entry point
  config.py         # Settings/env
  routers/
    users.py        # User routes
    __init__.py
  models/
    user.py         # Pydantic models
  services/
    user_service.py # Business logic
  db/
    database.py     # Database setup
```

## Router Organization

```python
# src/routers/users.py
from fastapi import APIRouter

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/")
def list_users():
    return []

@router.post("/")
def create_user(user: UserCreate):
    return user

# src/main.py
from fastapi import FastAPI
from src.routers import users

app = FastAPI()
app.include_router(users.router)
```

## Testing

```python
# tests/test_users.py
from fastapi.testclient import TestClient
from src.main import app

client = TestClient(app)

def test_create_user():
    response = client.post("/users", json={"email": "test@example.com", "name": "Test"})
    assert response.status_code == 201
    assert response.json()["email"] == "test@example.com"

def test_get_user_not_found():
    response = client.get("/users/999")
    assert response.status_code == 404
```

## Scripts

```toml
# pyproject.toml
[project.scripts]
dev = "uvicorn src.main:app --reload"
start = "uvicorn src.main:app"
```

## Gotchas

1. **Sync vs Async** - Use `async def` for I/O-bound operations
2. **Path order** - More specific routes must come before dynamic ones
3. **Response model** - Always use `response_model` for type safety and docs
4. **Validation errors** - Return 422, not 400. That's FastAPI's convention.

## Pairs With

- [pydantic.md](./pydantic.md) - Validation
- [ruff.md](./ruff.md) - Linting
- [pytest.md](./pytest.md) - Testing
- [structlog.md](./structlog.md) - Logging
