# Tool: structlog

Structured logging for Python. Makes logging a joy.

## Install

```bash
uv add structlog
# or
pip install structlog
```

## Why structlog

- **Structured** - Key-value pairs, not string formatting
- **Flexible** - Processors modify log entries
- **Beautiful** - Great console output
- **Fast** - Minimal overhead

## Basic Usage

```python
import structlog

logger = structlog.get_logger()

logger.info("User logged in", user_id="123", action="login")
logger.error("Request failed", error=str(e), request_id=request_id)
```

## Configuration

```python
# src/logging_config.py
import structlog
import logging
import sys

def configure_logging(json_logs: bool = False, log_level: str = "INFO"):
    """Configure structlog for the application."""

    shared_processors = [
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    if json_logs:
        # Production: JSON output
        processors = shared_processors + [
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ]
    else:
        # Development: Pretty console output
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(colors=True),
        ]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Configure stdlib logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, log_level.upper()),
    )
```

## Usage in App

```python
# src/main.py
from logging_config import configure_logging
import structlog

# Configure at startup
configure_logging(
    json_logs=os.getenv("JSON_LOGS", "false").lower() == "true",
    log_level=os.getenv("LOG_LEVEL", "INFO"),
)

logger = structlog.get_logger(__name__)

logger.info("Application started", version="1.0.0")
```

## Bound Loggers (Context)

```python
import structlog

logger = structlog.get_logger()

# Bind context that persists
request_logger = logger.bind(
    request_id="abc-123",
    user_id="user-456",
)

request_logger.info("Processing request")
# Output includes request_id and user_id

request_logger.info("Request complete", duration_ms=150)
# Also includes request_id and user_id
```

## FastAPI Integration

```python
# src/middleware/logging.py
import structlog
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
import time
import uuid

logger = structlog.get_logger()

class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())
        start_time = time.time()

        # Bind context for this request
        request_logger = logger.bind(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        request_logger.info("Request started")

        # Make logger available in request state
        request.state.logger = request_logger

        response = await call_next(request)

        duration_ms = (time.time() - start_time) * 1000
        request_logger.info(
            "Request completed",
            status_code=response.status_code,
            duration_ms=round(duration_ms, 2),
        )

        response.headers["X-Request-ID"] = request_id
        return response

# src/main.py
from fastapi import FastAPI
from middleware.logging import LoggingMiddleware

app = FastAPI()
app.add_middleware(LoggingMiddleware)

@app.get("/users/{user_id}")
async def get_user(user_id: str, request: Request):
    request.state.logger.info("Fetching user", user_id=user_id)
    # ...
```

## Error Logging

```python
import structlog

logger = structlog.get_logger()

try:
    result = risky_operation()
except Exception as e:
    logger.exception(
        "Operation failed",
        error=str(e),
        user_id=user_id,
        operation="risky_operation",
    )
    raise
```

## Security: Never Log Secrets

```python
# ❌ NEVER log these
logger.info("User data", password=user.password, api_key=api_key)

# ✅ Log safe fields only
logger.info("User data", user_id=user.id, email=user.email)

# Filter sensitive fields with processor
def filter_secrets(logger, method_name, event_dict):
    sensitive_keys = {"password", "api_key", "token", "secret"}
    for key in list(event_dict.keys()):
        if key in sensitive_keys:
            event_dict[key] = "[REDACTED]"
    return event_dict

structlog.configure(
    processors=[
        filter_secrets,
        # ... other processors
    ]
)
```

## Custom Processors

```python
import structlog

def add_app_context(logger, method_name, event_dict):
    """Add application context to all logs."""
    event_dict["app"] = "my-api"
    event_dict["env"] = os.getenv("ENVIRONMENT", "development")
    return event_dict

def add_correlation_id(logger, method_name, event_dict):
    """Add correlation ID from context var."""
    from contextvars import ContextVar
    correlation_id = correlation_id_var.get(None)
    if correlation_id:
        event_dict["correlation_id"] = correlation_id
    return event_dict

structlog.configure(
    processors=[
        add_app_context,
        add_correlation_id,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer(),
    ]
)
```

## Testing

```python
import structlog
from structlog.testing import capture_logs

def test_logging():
    with capture_logs() as captured:
        logger = structlog.get_logger()
        logger.info("Test message", user_id="123")

    assert captured[0]["event"] == "Test message"
    assert captured[0]["user_id"] == "123"
```

## Output Formats

### Development (Console)

```
2024-01-15 10:30:45 [info     ] Request started            method=GET path=/users request_id=abc-123
2024-01-15 10:30:45 [info     ] Request completed          duration_ms=15.2 method=GET path=/users request_id=abc-123 status_code=200
```

### Production (JSON)

```json
{"event": "Request started", "method": "GET", "path": "/users", "request_id": "abc-123", "timestamp": "2024-01-15T10:30:45.123Z", "level": "info"}
{"event": "Request completed", "method": "GET", "path": "/users", "request_id": "abc-123", "status_code": 200, "duration_ms": 15.2, "timestamp": "2024-01-15T10:30:45.138Z", "level": "info"}
```

## Gotchas

1. **Configure once** - Call `structlog.configure()` at startup only
2. **Bind returns new** - `logger.bind()` returns new logger, doesn't mutate
3. **exception() for errors** - Use `logger.exception()` to include traceback
4. **JSON in prod** - Always use JSON logs in production for parsing

## Pairs With

- [fastapi.md](./fastapi.md) - Web framework
- [ruff.md](./ruff.md) - Linting
- [pytest.md](./pytest.md) - Testing
