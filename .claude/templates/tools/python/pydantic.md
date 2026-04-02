# Tool: Pydantic

Data validation using Python type hints. The standard for FastAPI.

## Install

```bash
uv add pydantic
# or
pip install pydantic
```

## Why Pydantic

- **Type hints** - Validation from standard Python types
- **Fast** - Core written in Rust (v2)
- **IDE support** - Full autocomplete and type checking
- **Ecosystem** - FastAPI, SQLModel, Pydantic Settings

## Basic Usage

```python
from pydantic import BaseModel, EmailStr

class User(BaseModel):
    id: int
    email: EmailStr
    name: str
    age: int | None = None

# Validate (raises on error)
user = User(id=1, email="test@example.com", name="Test")

# From dict
user = User.model_validate({"id": 1, "email": "test@example.com", "name": "Test"})

# To dict
data = user.model_dump()

# To JSON
json_str = user.model_dump_json()
```

## Field Validation

```python
from pydantic import BaseModel, Field, field_validator

class User(BaseModel):
    # Field constraints
    name: str = Field(min_length=1, max_length=100)
    age: int = Field(ge=0, le=150)
    email: str = Field(pattern=r"^[\w\.-]+@[\w\.-]+\.\w+$")

    # With default
    role: str = Field(default="user")

    # Custom validation
    @field_validator("name")
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()
```

## Common Types

```python
from pydantic import BaseModel, EmailStr, HttpUrl, SecretStr
from datetime import datetime
from uuid import UUID

class Example(BaseModel):
    email: EmailStr
    url: HttpUrl
    password: SecretStr      # Hidden in repr/logs
    created_at: datetime
    id: UUID
    tags: list[str]
    metadata: dict[str, str]
```

## Optional & Default

```python
from pydantic import BaseModel

class User(BaseModel):
    required: str                    # Required
    optional: str | None = None      # Optional (can be None)
    with_default: str = "default"    # Has default

    # Factory default (for mutable types)
    tags: list[str] = Field(default_factory=list)
```

## Nested Models

```python
from pydantic import BaseModel

class Address(BaseModel):
    street: str
    city: str
    country: str

class User(BaseModel):
    name: str
    address: Address

# Validates nested structure
user = User(
    name="Test",
    address={"street": "123 Main", "city": "NYC", "country": "USA"}
)
```

## Model Inheritance

```python
from pydantic import BaseModel

class UserBase(BaseModel):
    email: str
    name: str

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int

    model_config = {"from_attributes": True}  # For ORM objects
```

## Settings Management

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    api_key: str
    debug: bool = False
    port: int = 8000

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }

settings = Settings()  # Loads from environment
```

```bash
uv add pydantic-settings
```

## Serialization Control

```python
from pydantic import BaseModel, Field

class User(BaseModel):
    internal_id: int = Field(exclude=True)  # Never serialize
    email: str
    password: str = Field(repr=False)       # Hide in repr

    model_config = {
        "json_schema_extra": {
            "examples": [{"email": "test@example.com"}]
        }
    }
```

## Error Handling

```python
from pydantic import BaseModel, ValidationError

try:
    user = User(email="invalid", name="")
except ValidationError as e:
    print(e.errors())
    # [{'type': 'value_error', 'loc': ('email',), 'msg': 'Invalid email'}]

    print(e.json())  # JSON format
```

## With FastAPI

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr

app = FastAPI()

class UserCreate(BaseModel):
    email: EmailStr
    name: str

class UserResponse(BaseModel):
    id: int
    email: str
    name: str

@app.post("/users", response_model=UserResponse, status_code=201)
def create_user(user: UserCreate):
    # user is already validated
    return UserResponse(id=1, **user.model_dump())
```

## Gotchas

1. **V1 vs V2** - Syntax changed significantly. Use v2 patterns.
2. **model_dump vs dict** - Use `model_dump()` (v2), not `.dict()` (v1)
3. **Mutable defaults** - Use `Field(default_factory=list)`, not `= []`
4. **from_attributes** - Required to convert ORM objects

## Pairs With

- [fastapi.md](./fastapi.md) - Web framework
- [ruff.md](./ruff.md) - Linting
- [pytest.md](./pytest.md) - Testing
