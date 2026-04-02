# Tool: pytest

The standard Python testing framework. Simple, powerful, extensible.

## Install

```bash
uv add --dev pytest pytest-cov pytest-asyncio
# or
pip install pytest pytest-cov pytest-asyncio
```

## Why pytest

- **Simple** - Just write functions, no classes needed
- **Powerful fixtures** - Dependency injection for tests
- **Rich ecosystem** - Plugins for everything
- **Great output** - Clear failure messages

## Basic Usage

```python
# test_math.py
def test_add():
    assert 1 + 2 == 3

def test_multiply():
    assert 2 * 3 == 6

class TestCalculator:
    def test_divide(self):
        assert 10 / 2 == 5
```

## Assertions

```python
# Basic
assert value == expected
assert value != other
assert value is None
assert value is not None

# Truthiness
assert value
assert not value

# Collections
assert item in collection
assert len(collection) == 3

# Exceptions
import pytest

def test_raises():
    with pytest.raises(ValueError):
        raise ValueError("error")

def test_raises_match():
    with pytest.raises(ValueError, match="specific"):
        raise ValueError("specific message")

# Approximate
assert 0.1 + 0.2 == pytest.approx(0.3)
```

## Fixtures

```python
import pytest

@pytest.fixture
def user():
    return {"id": 1, "name": "Test"}

def test_user_name(user):
    assert user["name"] == "Test"

# Fixture with setup/teardown
@pytest.fixture
def database():
    db = Database()
    db.connect()
    yield db
    db.disconnect()

# Fixture scope
@pytest.fixture(scope="module")  # Once per module
def expensive_resource():
    return create_resource()

# Autouse fixture
@pytest.fixture(autouse=True)
def reset_state():
    yield
    State.reset()
```

## Parametrization

```python
import pytest

@pytest.mark.parametrize("input,expected", [
    (1, 2),
    (2, 4),
    (3, 6),
])
def test_double(input, expected):
    assert input * 2 == expected

@pytest.mark.parametrize("x", [1, 2, 3])
@pytest.mark.parametrize("y", [10, 20])
def test_multiply(x, y):
    assert x * y > 0
```

## Async Tests

```python
import pytest

@pytest.mark.asyncio
async def test_async_function():
    result = await async_operation()
    assert result == expected

# Async fixture
@pytest.fixture
async def async_client():
    async with AsyncClient() as client:
        yield client
```

## Mocking

```python
from unittest.mock import Mock, patch, MagicMock

def test_with_mock():
    mock_fn = Mock(return_value=42)
    assert mock_fn() == 42
    mock_fn.assert_called_once()

def test_with_patch():
    with patch("module.function") as mock:
        mock.return_value = "mocked"
        result = module.function()
        assert result == "mocked"

@patch("module.function")
def test_with_decorator(mock_fn):
    mock_fn.return_value = "mocked"
    # test code
```

## Testing FastAPI

```python
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Hello"}

def test_create_user():
    response = client.post("/users", json={"name": "Test"})
    assert response.status_code == 201
    assert "id" in response.json()
```

## Configuration

```toml
# pyproject.toml
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_functions = ["test_*"]
asyncio_mode = "auto"
addopts = "-v --cov=src --cov-report=term-missing"
```

## Commands

```bash
pytest                    # Run all tests
pytest tests/test_api.py  # Run specific file
pytest -k "test_user"     # Run tests matching pattern
pytest -v                 # Verbose output
pytest --cov=src          # With coverage
pytest -x                 # Stop on first failure
pytest --lf               # Run last failed
pytest -n auto            # Parallel (needs pytest-xdist)
```

## Project Structure

```
src/
  __init__.py
  main.py
tests/
  __init__.py
  conftest.py      # Shared fixtures
  test_main.py
  test_api.py
```

## conftest.py

```python
# tests/conftest.py
import pytest

@pytest.fixture
def app():
    """Shared app fixture."""
    from main import create_app
    return create_app()

@pytest.fixture
def client(app):
    """Test client fixture."""
    from fastapi.testclient import TestClient
    return TestClient(app)
```

## Gotchas

1. **Name convention** - Files must start with `test_` or end with `_test.py`
2. **Fixtures are injected** - Parameter name must match fixture name
3. **Async tests** - Need `pytest-asyncio` and `@pytest.mark.asyncio`
4. **Import paths** - Use `src` layout or configure `pythonpath`

## Pairs With

- [fastapi.md](./fastapi.md) - Web framework
- [ruff.md](./ruff.md) - Linting
- [pydantic.md](./pydantic.md) - Validation
