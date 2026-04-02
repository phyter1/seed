# Stack: Go API

Opinionated stack for building production-ready Go APIs.

## Tools

| Layer | Tool | Docs |
|-------|------|------|
| Runtime | Go 1.22+ | — |
| Framework | Chi / stdlib | — |
| Validation | go-playground/validator | — |
| Linting | golangci-lint | [golangci-lint.md](../tools/go/golangci-lint.md) |
| Testing | go test + testify | [go-test.md](../tools/go/go-test.md) |
| Security | gosec + govulncheck | [audit.md](../tools/audit.md) |
| Secrets | Gitleaks | [gitleaks.md](../tools/gitleaks.md) |

## Quick Start

```bash
mkdir my-api && cd my-api
go mod init github.com/username/my-api

# Install dependencies
go get github.com/go-chi/chi/v5
go get github.com/go-playground/validator/v10
go get github.com/stretchr/testify

# Install tools
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
go install golang.org/x/vuln/cmd/govulncheck@latest
```

## Project Structure

```
my-api/
├── cmd/
│   └── server/
│       └── main.go         # Entry point
├── internal/
│   ├── config/
│   │   └── config.go       # Configuration
│   ├── handlers/
│   │   ├── users.go
│   │   └── users_test.go
│   ├── middleware/
│   │   └── logging.go
│   ├── models/
│   │   └── user.go
│   └── services/
│       └── user_service.go
├── pkg/
│   └── validator/
│       └── validator.go
├── .golangci.yml
├── Makefile
└── go.mod
```

## Configuration Files

### .golangci.yml

```yaml
run:
  timeout: 5m

linters:
  enable:
    - errcheck
    - gosimple
    - govet
    - ineffassign
    - staticcheck
    - unused
    - gosec
    - gofmt
    - goimports
    - misspell
    - gocritic

linters-settings:
  errcheck:
    check-type-assertions: true
  gosec:
    excludes:
      - G104

issues:
  exclude-rules:
    - path: _test\.go
      linters:
        - errcheck
        - gosec
```

### Makefile

```makefile
.PHONY: dev build test lint security check

dev:
	go run cmd/server/main.go

build:
	go build -o bin/server cmd/server/main.go

test:
	go test -v -race -cover ./...

lint:
	golangci-lint run

security:
	govulncheck ./...
	gitleaks detect --source .

check: lint test security

# Git hooks
.PHONY: install-hooks
install-hooks:
	echo '#!/bin/sh\ngitleaks protect --staged' > .git/hooks/pre-commit
	echo '#!/bin/sh\nmake check' > .git/hooks/pre-push
	chmod +x .git/hooks/pre-commit .git/hooks/pre-push
```

## Core Files

### cmd/server/main.go

```go
package main

import (
    "log"
    "net/http"
    "os"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"

    "github.com/username/my-api/internal/config"
    "github.com/username/my-api/internal/handlers"
)

func main() {
    cfg := config.Load()

    r := chi.NewRouter()

    // Middleware
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)
    r.Use(middleware.RealIP)

    // Routes
    r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte(`{"status":"ok"}`))
    })

    r.Route("/api/users", func(r chi.Router) {
        r.Get("/", handlers.ListUsers)
        r.Post("/", handlers.CreateUser)
        r.Get("/{id}", handlers.GetUser)
    })

    log.Printf("Server starting on :%s", cfg.Port)
    if err := http.ListenAndServe(":"+cfg.Port, r); err != nil {
        log.Fatal(err)
    }
}
```

### internal/config/config.go

```go
package config

import "os"

type Config struct {
    Port        string
    DatabaseURL string
    LogLevel    string
}

func Load() *Config {
    return &Config{
        Port:        getEnv("PORT", "8080"),
        DatabaseURL: getEnv("DATABASE_URL", ""),
        LogLevel:    getEnv("LOG_LEVEL", "info"),
    }
}

func getEnv(key, fallback string) string {
    if value := os.Getenv(key); value != "" {
        return value
    }
    return fallback
}
```

### internal/handlers/users.go

```go
package handlers

import (
    "encoding/json"
    "net/http"

    "github.com/go-chi/chi/v5"
    "github.com/go-playground/validator/v10"

    "github.com/username/my-api/internal/models"
)

var validate = validator.New()

type CreateUserRequest struct {
    Email string `json:"email" validate:"required,email"`
    Name  string `json:"name" validate:"required,min=1,max=100"`
}

func CreateUser(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
        return
    }

    if err := validate.Struct(req); err != nil {
        http.Error(w, `{"error":"validation failed"}`, http.StatusBadRequest)
        return
    }

    user := models.User{
        ID:    1,
        Email: req.Email,
        Name:  req.Name,
    }

    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(user)
}

func GetUser(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")
    // Fetch user by ID
    _ = id

    http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
}

func ListUsers(w http.ResponseWriter, r *http.Request) {
    users := []models.User{}
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(users)
}
```

## Testing

```go
// internal/handlers/users_test.go
package handlers

import (
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"

    "github.com/stretchr/testify/assert"
)

func TestCreateUser(t *testing.T) {
    body := `{"email":"test@example.com","name":"Test"}`
    req := httptest.NewRequest("POST", "/users", strings.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    w := httptest.NewRecorder()

    CreateUser(w, req)

    assert.Equal(t, http.StatusCreated, w.Code)
}

func TestCreateUserInvalidEmail(t *testing.T) {
    body := `{"email":"invalid","name":"Test"}`
    req := httptest.NewRequest("POST", "/users", strings.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    w := httptest.NewRecorder()

    CreateUser(w, req)

    assert.Equal(t, http.StatusBadRequest, w.Code)
}
```

## Commands

```bash
make dev       # Run development server
make build     # Build binary
make test      # Run tests
make lint      # Run linter
make security  # Run security checks
make check     # Run all checks
```

## Security Checklist

- [ ] golangci-lint with gosec enabled
- [ ] govulncheck in CI
- [ ] Gitleaks in pre-commit
- [ ] Input validation with go-playground/validator
- [ ] No secrets in code
- [ ] Error handling (no ignored errors)
