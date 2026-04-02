# Tool: Go Test

Go's built-in testing framework. Simple, fast, no dependencies.

## Install

Built into Go. No installation needed.

## Why Go Test

- **Built-in** - Part of the language
- **Fast** - Compiles and runs quickly
- **Parallel** - Easy parallelization
- **Simple** - Minimal API to learn

## Basic Usage

```go
// math_test.go
package math

import "testing"

func TestAdd(t *testing.T) {
    result := Add(1, 2)
    if result != 3 {
        t.Errorf("Add(1, 2) = %d; want 3", result)
    }
}

func TestMultiply(t *testing.T) {
    result := Multiply(2, 3)
    if result != 6 {
        t.Errorf("Multiply(2, 3) = %d; want 6", result)
    }
}
```

## Table-Driven Tests

```go
func TestAdd(t *testing.T) {
    tests := []struct {
        name string
        a, b int
        want int
    }{
        {"positive", 1, 2, 3},
        {"negative", -1, -2, -3},
        {"zero", 0, 0, 0},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Add(tt.a, tt.b)
            if got != tt.want {
                t.Errorf("Add(%d, %d) = %d; want %d", tt.a, tt.b, got, tt.want)
            }
        })
    }
}
```

## Assertions with testify

```bash
go get github.com/stretchr/testify
```

```go
import (
    "testing"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestWithAssert(t *testing.T) {
    // assert continues on failure
    assert.Equal(t, 3, Add(1, 2))
    assert.NotNil(t, result)
    assert.True(t, condition)
    assert.Contains(t, slice, item)
    assert.Error(t, err)
    assert.NoError(t, err)

    // require stops on failure
    require.NotNil(t, result)
}
```

## Setup & Teardown

```go
func TestMain(m *testing.M) {
    // Setup before all tests
    setup()

    code := m.Run()

    // Teardown after all tests
    teardown()

    os.Exit(code)
}

func TestWithCleanup(t *testing.T) {
    resource := createResource()
    t.Cleanup(func() {
        resource.Close()
    })

    // Test code
}
```

## Parallel Tests

```go
func TestParallel(t *testing.T) {
    t.Parallel()

    tests := []struct {
        name string
        input int
    }{
        {"case1", 1},
        {"case2", 2},
    }

    for _, tt := range tests {
        tt := tt // Capture range variable
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()
            // Test code
        })
    }
}
```

## Testing HTTP Handlers

```go
import (
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestHandler(t *testing.T) {
    req := httptest.NewRequest("GET", "/users", nil)
    w := httptest.NewRecorder()

    handler := NewRouter()
    handler.ServeHTTP(w, req)

    if w.Code != http.StatusOK {
        t.Errorf("status = %d; want %d", w.Code, http.StatusOK)
    }
}

// With JSON body
func TestCreateUser(t *testing.T) {
    body := strings.NewReader(`{"name": "Test"}`)
    req := httptest.NewRequest("POST", "/users", body)
    req.Header.Set("Content-Type", "application/json")
    w := httptest.NewRecorder()

    handler.ServeHTTP(w, req)

    assert.Equal(t, http.StatusCreated, w.Code)
}
```

## Mocking with interfaces

```go
// Define interface
type UserRepository interface {
    GetUser(id int) (*User, error)
}

// Mock implementation
type MockUserRepo struct {
    GetUserFunc func(id int) (*User, error)
}

func (m *MockUserRepo) GetUser(id int) (*User, error) {
    return m.GetUserFunc(id)
}

// Use in test
func TestGetUser(t *testing.T) {
    mock := &MockUserRepo{
        GetUserFunc: func(id int) (*User, error) {
            return &User{ID: id, Name: "Test"}, nil
        },
    }

    service := NewUserService(mock)
    user, err := service.GetUser(1)

    assert.NoError(t, err)
    assert.Equal(t, "Test", user.Name)
}
```

## Benchmarks

```go
func BenchmarkAdd(b *testing.B) {
    for i := 0; i < b.N; i++ {
        Add(1, 2)
    }
}

// Run: go test -bench=.
```

## Commands

```bash
go test                    # Run tests in current package
go test ./...              # Run all tests
go test -v                 # Verbose output
go test -run TestAdd       # Run specific test
go test -cover             # Show coverage
go test -coverprofile=c.out && go tool cover -html=c.out  # Coverage report
go test -race              # Race condition detection
go test -bench=.           # Run benchmarks
go test -short             # Skip long tests
```

## Project Structure

```
myapp/
  main.go
  main_test.go         # Tests in same package
  handlers/
    user.go
    user_test.go
  internal/
    service/
      user.go
      user_test.go
```

## Gotchas

1. **File naming** - Must end with `_test.go`
2. **Function naming** - Must start with `Test`, `Benchmark`, or `Example`
3. **Range variable capture** - Use `tt := tt` in parallel table tests
4. **No assertions** - Use `t.Error`/`t.Fatal` or testify

## Pairs With

- [golangci-lint.md](./golangci-lint.md) - Linting
- [testify](https://github.com/stretchr/testify) - Assertions
