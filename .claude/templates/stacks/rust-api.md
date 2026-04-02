# Stack: Rust API

Opinionated stack for building production-ready Rust APIs.

## Tools

| Layer | Tool | Docs |
|-------|------|------|
| Runtime | Rust + Tokio | — |
| Framework | Axum | [axum.md](../tools/rust/axum.md) |
| Validation | validator | — |
| Linting | Clippy | [clippy.md](../tools/rust/clippy.md) |
| Testing | cargo test | — |
| Security | cargo-audit | [cargo-audit.md](../tools/rust/cargo-audit.md) |
| Secrets | Gitleaks | [gitleaks.md](../tools/gitleaks.md) |

## Quick Start

```bash
cargo new my-api
cd my-api

# Add dependencies (edit Cargo.toml)
cargo add axum tokio -F tokio/full
cargo add serde -F serde/derive
cargo add serde_json
cargo add tower-http -F tower-http/cors,tower-http/trace
cargo add tracing tracing-subscriber
cargo add validator -F validator/derive
cargo add anyhow thiserror

# Install tools
cargo install cargo-audit cargo-watch
```

## Project Structure

```
my-api/
├── src/
│   ├── main.rs           # Entry point
│   ├── config.rs         # Configuration
│   ├── error.rs          # Error types
│   ├── routes/
│   │   ├── mod.rs
│   │   └── users.rs
│   └── models/
│       ├── mod.rs
│       └── user.rs
├── tests/
│   └── api_tests.rs
├── Cargo.toml
├── .cargo/
│   └── audit.toml
└── Makefile
```

## Configuration Files

### Cargo.toml

```toml
[package]
name = "my-api"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tower-http = { version = "0.5", features = ["cors", "trace"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
validator = { version = "0.18", features = ["derive"] }
anyhow = "1"
thiserror = "1"

[dev-dependencies]
tower = { version = "0.4", features = ["util"] }
http-body-util = "0.1"

[lints.rust]
unsafe_code = "forbid"

[lints.clippy]
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"
pedantic = "warn"
```

### .cargo/audit.toml

```toml
[advisories]
ignore = []
unmaintained = "warn"
yanked = "warn"
```

### Makefile

```makefile
.PHONY: dev build test lint security check

dev:
	cargo watch -x run

build:
	cargo build --release

test:
	cargo test

lint:
	cargo clippy --all-targets -- -D warnings
	cargo fmt --check

security:
	cargo audit
	gitleaks detect --source .

check: lint test security

fmt:
	cargo fmt
```

## Core Files

### src/main.rs

```rust
use axum::{routing::get, Router};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod error;
mod models;
mod routes;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let app = Router::new()
        .route("/health", get(health_check))
        .nest("/api/users", routes::users::router())
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind");

    tracing::info!("Server running on http://0.0.0.0:3000");
    axum::serve(listener, app)
        .await
        .expect("Failed to start server");
}

async fn health_check() -> &'static str {
    r#"{"status":"ok"}"#
}
```

### src/error.rs

```rust
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

pub struct AppError(anyhow::Error);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        tracing::error!("Application error: {}", self.0);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Internal server error" })),
        )
            .into_response()
    }
}

impl<E> From<E> for AppError
where
    E: Into<anyhow::Error>,
{
    fn from(err: E) -> Self {
        Self(err.into())
    }
}
```

### src/routes/users.rs

```rust
use axum::{
    extract::Path,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::error::AppError;

pub fn router() -> Router {
    Router::new()
        .route("/", get(list_users).post(create_user))
        .route("/:id", get(get_user))
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateUserRequest {
    #[validate(email)]
    email: String,
    #[validate(length(min = 1, max = 100))]
    name: String,
}

#[derive(Debug, Serialize)]
pub struct User {
    id: i64,
    email: String,
    name: String,
}

async fn create_user(
    Json(payload): Json<CreateUserRequest>,
) -> Result<impl IntoResponse, AppError> {
    payload.validate().map_err(|e| anyhow::anyhow!("Validation error: {}", e))?;

    let user = User {
        id: 1,
        email: payload.email,
        name: payload.name,
    };

    Ok((StatusCode::CREATED, Json(user)))
}

async fn get_user(Path(id): Path<i64>) -> Result<impl IntoResponse, AppError> {
    // Fetch from DB
    let _ = id;
    Err(AppError(anyhow::anyhow!("Not found")))
}

async fn list_users() -> Json<Vec<User>> {
    Json(vec![])
}
```

## Testing

```rust
// tests/api_tests.rs
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

#[tokio::test]
async fn test_health_check() {
    let app = my_api::create_app();

    let response = app
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_create_user() {
    let app = my_api::create_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/users")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"email":"test@example.com","name":"Test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
}
```

## Commands

```bash
make dev       # Run with watch mode
make build     # Release build
make test      # Run tests
make lint      # Run clippy + fmt check
make security  # Run cargo-audit + gitleaks
make check     # Run all checks
```

## Security Checklist

- [ ] `unsafe_code = "forbid"` in Cargo.toml
- [ ] Clippy with `unwrap_used`, `expect_used`, `panic` denied
- [ ] cargo-audit in CI
- [ ] Gitleaks in pre-commit
- [ ] Input validation with validator crate
- [ ] Error types don't leak internals
