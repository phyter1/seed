---
title: "[Application Name] — API Design"
date: YYYY-MM-DD
version: "1.0"
phase: "[e.g., Pre-implementation, MVP, v2]"
source_documents:
  - "[Path to PRD]"
  - "[Path to Data Model doc]"
  - "[Path to System Design doc]"
---

# [Application Name] — API Design

> **Purpose:** Define the complete API contract for the application — every endpoint, request shape, response shape, authentication mechanism, and error format. This is the interface contract between frontend and backend, and between this system and any external consumers. Every endpoint defined here must be implemented. Anything not defined here does not get built.

---

## 1. Overview

[2–3 sentences describing the API at a high level. Is it REST, GraphQL, gRPC? What is the primary consumer — first-party web client, mobile app, third-party developers? What are the key design principles?]

**API style:** [e.g., RESTful JSON, GraphQL, tRPC]

**Primary consumers:**
- [e.g., First-party web application (Next.js frontend)]
- [e.g., Mobile application (React Native)]
- [e.g., Third-party developers via public API]

**Design principles:**
- [Principle 1 — e.g., "Resource-oriented URLs. Nouns, not verbs."]
- [Principle 2 — e.g., "Consistent response envelope for all endpoints."]
- [Principle 3 — e.g., "Errors are always explicit — never return 200 with error in body."]
- [Principle 4 — e.g., "All mutating endpoints are idempotent where possible."]

---

## 2. Base URL and Versioning Strategy

**Base URL (production):** `https://api.[domain].com`

**Base URL (staging):** `https://api.staging.[domain].com`

**Versioning strategy:** [Choose one and explain]
- [Option A: URL path versioning — e.g., `/v1/users`, `/v2/users`]
- [Option B: Header versioning — e.g., `Accept: application/vnd.app.v1+json`]
- [Option C: No versioning — e.g., "Single version, backwards-compatible changes only. Breaking changes require coordination."]

**Current version:** `v1`

**Version lifecycle:**
- [e.g., Old versions deprecated with 6-month sunset window]
- [e.g., Deprecation announced via `Sunset` and `Deprecation` headers]
- [e.g., Breaking changes always require a new version]

---

## 3. Authentication and Authorization

### 3.1 Authentication Flow

[Describe the complete auth flow from the consumer's perspective.]

1. [Step 1 — e.g., Client sends `POST /auth/login` with credentials]
2. [Step 2 — e.g., Server validates and returns access token + refresh token]
3. [Step 3 — e.g., Client stores tokens — access in memory, refresh in HttpOnly cookie]
4. [Step 4 — e.g., Client includes access token in `Authorization` header on subsequent requests]
5. [Step 5 — e.g., When access token expires, client sends `POST /auth/refresh` to get new access token]
6. [Step 6 — e.g., On logout, client sends `POST /auth/logout` to revoke refresh token]

### 3.2 Token Format

- **Access token:** [e.g., JWT signed with RS256. Payload includes: `sub` (user ID), `role`, `iat`, `exp`]
- **Refresh token:** [e.g., Opaque random string, stored server-side in `session_tokens` table]
- **Access token expiry:** [e.g., 15 minutes]
- **Refresh token expiry:** [e.g., 30 days, sliding window on use]

### 3.3 Authorization Header Format

```
Authorization: Bearer {access_token}
```

### 3.4 Endpoint Protection

| Protection Level | Meaning | How Enforced |
|-----------------|---------|-------------|
| `Public` | No authentication required | No auth middleware |
| `Authenticated` | Valid access token required | Auth middleware on all routes in group |
| `Owner` | Must own the resource | Ownership check in handler or middleware |
| `Admin` | Must have admin role | Role check in middleware |

---

## 4. Endpoint Catalog

[Group endpoints by resource. For each endpoint, fully specify the request and response contract.]

---

### 4.1 Authentication

#### `POST /auth/register`

**Description:** Create a new user account.

**Auth required:** Public

**Rate limit:** 5 requests per IP per hour

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "SecureP@ss123",
  "displayName": "Jane Smith"
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `email` | string | Yes | Valid email format, max 255 chars |
| `password` | string | Yes | Min 8 chars, at least one uppercase, one number |
| `displayName` | string | No | Max 100 chars |

**Response — 201 Created:**
```json
{
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "displayName": "Jane Smith",
      "createdAt": "2024-01-15T10:30:00Z"
    },
    "accessToken": "eyJhbGciOiJSUzI1NiJ9..."
  }
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid email format, weak password |
| 409 | `EMAIL_IN_USE` | Email already registered |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many registration attempts |

---

#### `POST /auth/login`

**Description:** Authenticate with email and password.

**Auth required:** Public

**Rate limit:** 10 requests per IP per minute

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "SecureP@ss123"
}
```

**Response — 200 OK:**
```json
{
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiJ9...",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "displayName": "Jane Smith"
    }
  }
}
```

*Note: Refresh token set as HttpOnly cookie.*

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing fields |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password (same message intentionally) |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many login attempts |

---

#### `POST /auth/logout`

**Description:** Revoke the current refresh token.

**Auth required:** Authenticated

**Request body:** None

**Response — 204 No Content**

---

#### `POST /auth/refresh`

**Description:** Exchange a valid refresh token for a new access token.

**Auth required:** Public (refresh token in HttpOnly cookie)

**Request body:** None

**Response — 200 OK:**
```json
{
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiJ9..."
  }
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 401 | `INVALID_REFRESH_TOKEN` | Missing, expired, or revoked refresh token |

---

### 4.2 Users

#### `GET /users/me`

**Description:** Get the authenticated user's profile.

**Auth required:** Authenticated

**Response — 200 OK:**
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "displayName": "Jane Smith",
    "avatarUrl": "https://cdn.example.com/avatars/550e8400.jpg",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

---

#### `PATCH /users/me`

**Description:** Update the authenticated user's profile.

**Auth required:** Authenticated

**Request body:**
```json
{
  "displayName": "Jane M. Smith",
  "bio": "Product designer based in NYC."
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `displayName` | string | No | Max 100 chars |
| `bio` | string | No | Max 500 chars |

**Response — 200 OK:** Updated user object (same shape as `GET /users/me`)

---

### 4.3 [Resource Name — e.g., Projects]

#### `GET /[resources]`

**Description:** List all [resources] owned by the authenticated user.

**Auth required:** Authenticated

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | `active` | Filter by status. One of: `active`, `archived`, `all` |
| `limit` | integer | `20` | Page size. Max 100 |
| `cursor` | string | — | Pagination cursor from previous response |
| `sort` | string | `created_at:desc` | Sort field and direction |

**Response — 200 OK:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "My Project",
      "status": "active",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-20T14:22:00Z"
    }
  ],
  "meta": {
    "total": 47,
    "limit": 20,
    "nextCursor": "eyJpZCI6IjEyMyJ9",
    "hasMore": true
  }
}
```

---

#### `POST /[resources]`

**Description:** Create a new [resource].

**Auth required:** Authenticated

**Request body:**
```json
{
  "name": "My New Project",
  "description": "Optional description"
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | Yes | Min 1, max 200 chars |
| `description` | string | No | Max 2000 chars |

**Response — 201 Created:** Created resource object

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid fields |
| 403 | `LIMIT_REACHED` | User has reached their resource limit |

---

#### `GET /[resources]/:id`

**Description:** Get a single [resource] by ID.

**Auth required:** Authenticated (Owner)

**Path parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | uuid | Resource ID |

**Response — 200 OK:** Full resource object

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 403 | `FORBIDDEN` | Authenticated but not the owner |
| 404 | `NOT_FOUND` | Resource does not exist or was deleted |

---

#### `PATCH /[resources]/:id`

**Description:** Update a [resource].

**Auth required:** Authenticated (Owner)

**Request body:** Partial update — include only fields to change.

**Response — 200 OK:** Updated resource object

---

#### `DELETE /[resources]/:id`

**Description:** Delete a [resource].

**Auth required:** Authenticated (Owner)

**Response — 204 No Content**

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 403 | `FORBIDDEN` | Not the owner |
| 404 | `NOT_FOUND` | Resource does not exist |

---

*(Add sections for each resource group. Cover all CRUD operations and any resource-specific actions.)*

---

## 5. Common Response Formats

### 5.1 Success Response (Single Resource)

```json
{
  "data": {
    "id": "uuid",
    "field": "value",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-20T14:22:00Z"
  }
}
```

### 5.2 Success Response (Collection)

```json
{
  "data": [
    { "id": "uuid", "field": "value" }
  ],
  "meta": {
    "total": 100,
    "limit": 20,
    "nextCursor": "eyJpZCI6IjEyMyJ9",
    "hasMore": true
  }
}
```

### 5.3 Empty Success (Delete, Action with no body)

HTTP `204 No Content` — no body.

---

## 6. Pagination Strategy

**Strategy:** [Choose: Cursor-based (recommended for most cases) or Offset-based]

### Cursor-Based Pagination (recommended)

**Why:** Cursor pagination is stable — adding or removing items between pages does not cause items to be skipped or duplicated.

**Request parameters:**
- `limit` — number of items per page (default: 20, max: 100)
- `cursor` — opaque cursor string from previous response. Absent on first request.

**Response metadata:**
```json
{
  "meta": {
    "limit": 20,
    "nextCursor": "eyJpZCI6IjEyMyIsImNyZWF0ZWRBdCI6IjIwMjQtMDEtMTUifQ==",
    "hasMore": true
  }
}
```

**Cursor format:** Base64-encoded JSON containing the sort key values of the last item returned. Treated as opaque by consumers.

---

## 7. Rate Limiting

### 7.1 Rate Limit Tiers

| Tier | Applies To | Limit | Window |
|------|-----------|-------|--------|
| Unauthenticated | Public endpoints | 60 requests | 1 minute per IP |
| Authenticated | All authenticated endpoints | 600 requests | 1 minute per user |
| Sensitive operations | Login, register, password reset | 10 requests | 1 hour per IP |
| [Custom tier] | [Specific endpoints] | [Limit] | [Window] |

### 7.2 Rate Limit Headers

Every response includes:

```
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 543
X-RateLimit-Reset: 1705312800
Retry-After: 47
```

`Retry-After` is included only when the rate limit is exceeded.

### 7.3 Behavior When Exceeded

- Return `429 Too Many Requests`
- Include `Retry-After` header with seconds until limit resets
- Include error body with `RATE_LIMIT_EXCEEDED` code

---

## 8. Error Response Format

All errors follow this standard format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed. Check the details field for field-level errors.",
    "details": [
      {
        "field": "email",
        "message": "Must be a valid email address"
      },
      {
        "field": "password",
        "message": "Must be at least 8 characters"
      }
    ],
    "correlationId": "req_01HQ1234ABCD5678"
  }
}
```

**Fields:**

| Field | Type | Always Present | Description |
|-------|------|---------------|-------------|
| `error.code` | string | Yes | Machine-readable error code in SCREAMING_SNAKE_CASE |
| `error.message` | string | Yes | Human-readable summary. Safe for display to developers, not end users. |
| `error.details` | array | No | Field-level validation errors |
| `error.details[].field` | string | When present | Field path using dot notation for nested fields |
| `error.details[].message` | string | When present | Field-specific error message |
| `error.correlationId` | string | Yes | Request correlation ID for tracing in logs |

### Standard Error Codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `VALIDATION_ERROR` | 400 | Request body or query params failed validation |
| `AUTHENTICATION_REQUIRED` | 401 | Request requires authentication |
| `INVALID_CREDENTIALS` | 401 | Login credentials are incorrect |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh token is missing, invalid, or expired |
| `FORBIDDEN` | 403 | Authenticated but not authorized for this action |
| `NOT_FOUND` | 404 | Resource does not exist |
| `METHOD_NOT_ALLOWED` | 405 | HTTP method not supported for this endpoint |
| `CONFLICT` | 409 | State conflict — e.g., duplicate unique field |
| `LIMIT_REACHED` | 403 | Usage limit reached (quota, plan limit, etc.) |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `SERVICE_UNAVAILABLE` | 503 | Temporary outage or maintenance mode |

---

## 9. Webhook Design

[Include this section if the application sends webhooks to external consumers. Remove or mark N/A if not applicable.]

### 9.1 Webhook Events

| Event | Description | When Triggered |
|-------|-------------|---------------|
| `[entity].[action]` | [Description] | [When] |
| `[entity].[action]` | [Description] | [When] |

### 9.2 Payload Format

```json
{
  "id": "evt_01HQ1234ABCD5678",
  "type": "project.created",
  "createdAt": "2024-01-15T10:30:00Z",
  "data": {
    "object": {
      "id": "uuid",
      "type": "project",
      "attributes": {}
    }
  }
}
```

### 9.3 Delivery

- **Retry policy:** [e.g., 3 retries with exponential backoff — 1 min, 10 min, 60 min]
- **Timeout:** [e.g., 30 second response timeout]
- **Success criteria:** [e.g., HTTP 2xx response from consumer]
- **Dead letter:** [e.g., After all retries exhausted, event stored in dead letter log. Consumer can query for missed events.]

### 9.4 Security

- **Signature:** [e.g., HMAC-SHA256 signature of payload with consumer's webhook secret, delivered in `X-Webhook-Signature` header]
- **Signature format:** `sha256={hmac_hex}`
- **Verification:** Consumer must verify signature before processing payload
- **Replay protection:** [e.g., `id` field is unique per event. Consumers should deduplicate on event ID.]

---

## 10. Functional Requirements Traceability

[Map every functional requirement from the PRD to the endpoint(s) that implement it. This ensures nothing falls through the cracks.]

| FR ID | Requirement Summary | Endpoint(s) | Notes |
|-------|--------------------|--------------| ------|
| FR-001 | [Requirement description] | `POST /api/v1/[resource]` | [Notes if partial coverage or shared with other FRs] |
| FR-002 | [Requirement description] | `GET /api/v1/[resource]` | |
| FR-003 | [Requirement description] | `PATCH /api/v1/[resource]/:id` | |

*(Every FR-XXX from PRD Section 7 must appear in this table. An FR with no endpoint is a gap. An endpoint with no FR may be unnecessary.)*

---

## 11. API Changelog

| Version | Date | Change | Breaking? |
|---------|------|--------|-----------|
| 1.0 | YYYY-MM-DD | Initial API release | — |
| [version] | [date] | [What changed] | [Yes/No — if yes, explain impact] |

---

### Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0 | YYYY-MM-DD | | Initial draft |
