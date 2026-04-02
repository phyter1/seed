# Tool: Axum

Ergonomic, modular web framework for Rust. Built on Tokio and Tower.

## Install

```toml
# Cargo.toml
[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tower-http = { version = "0.5", features = ["cors", "trace"] }
tracing = "0.1"
tracing-subscriber = "0.3"
```

## Why Axum

- **Type-safe** - Compile-time route checking
- **Modular** - Tower middleware ecosystem
- **Fast** - Zero-cost abstractions
- **Ergonomic** - No macros needed for routes

## Quick Start

```rust
// src/main.rs
use axum::{routing::get, Router, Json};
use serde::Serialize;

#[derive(Serialize)]
struct Message {
    message: String,
}

async fn hello() -> Json<Message> {
    Json(Message { message: "Hello, World!".into() })
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/", get(hello));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

## Request Handling

```rust
use axum::{
    extract::{Path, Query, State, Json},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct CreateUser {
    email: String,
    name: String,
}

#[derive(Serialize)]
struct User {
    id: i64,
    email: String,
    name: String,
}

async fn create_user(
    State(db): State<Database>,
    Json(payload): Json<CreateUser>,
) -> impl IntoResponse {
    let user = db.create_user(&payload.email, &payload.name).await;
    (StatusCode::CREATED, Json(user))
}

async fn get_user(
    State(db): State<Database>,
    Path(id): Path<i64>,
) -> Result<Json<User>, StatusCode> {
    db.get_user(id)
        .await
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}
```

## Router Organization

```rust
// src/routes/users.rs
use axum::{routing::{get, post}, Router};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_users).post(create_user))
        .route("/:id", get(get_user).delete(delete_user))
}

// src/main.rs
mod routes;

#[tokio::main]
async fn main() {
    let app = Router::new()
        .nest("/api/users", routes::users::router())
        .with_state(state);

    // ...
}
```

## Middleware

```rust
use axum::{Router, middleware};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

let app = Router::new()
    .route("/", get(handler))
    .layer(TraceLayer::new_for_http())
    .layer(CorsLayer::permissive());
```

## Error Handling

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
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": self.0.to_string() })),
        ).into_response()
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

// Use in handlers
async fn handler() -> Result<Json<Data>, AppError> {
    let data = fallible_operation()?;
    Ok(Json(data))
}
```

## Project Structure

```
src/
  main.rs           # Entry point
  lib.rs            # Library root
  config.rs         # Configuration
  routes/
    mod.rs
    users.rs
  models/
    mod.rs
    user.rs
  services/
    mod.rs
    user_service.rs
  db/
    mod.rs
```

## Testing

```rust
// tests/api_tests.rs
use axum::{body::Body, http::{Request, StatusCode}};
use tower::ServiceExt;

#[tokio::test]
async fn test_hello() {
    let app = create_app();

    let response = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
```

## Scripts

```toml
# Cargo.toml
[[bin]]
name = "server"
path = "src/main.rs"
```

```bash
cargo run             # Run
cargo watch -x run    # Watch mode (install cargo-watch)
cargo test            # Test
cargo clippy          # Lint
```

## Gotchas

1. **State must be Clone** - Use `Arc` for shared state
2. **Extractors order** - `Body` must be last, it consumes the request
3. **Error handling** - Implement `IntoResponse` for custom errors
4. **Async trait** - Use `#[async_trait]` for async trait methods

## Pairs With

- [clippy.md](./clippy.md) - Linting
- [cargo-audit.md](./cargo-audit.md) - Security
- [sqlx](https://github.com/launchbadge/sqlx) - Database
- [tower](https://github.com/tower-rs/tower) - Middleware
