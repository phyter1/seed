---
name: generate-api-data
description: "Phase 5 — generates both the Data Model (entities, relationships, indexes, migrations) and API Design (endpoint catalog, auth, pagination, rate limiting) documents. Called by dark-factory after Phase 4."
user-invocable: false
allowed-tools: Read, Write, Edit, Grep, Glob
---

# Generate API Design and Data Model Documents

**Phase:** 5
**Input:** `plan/01-prd/PRD.md`, `plan/02-adrs/*.md`, `plan/03-architecture/TECHNICAL-ARCHITECTURE.md`, `plan/04-system-design/SYSTEM-DESIGN.md`
**Output:** `plan/05-api-and-data/DATA-MODEL.md` and `plan/05-api-and-data/API-DESIGN.md`

---

## Instructions

### Step 1: Load All Upstream Context

Read the following files completely before generating anything:
- `plan/01-prd/PRD.md` — full product requirements, especially:
  - Section 7 (Functional Requirements) — every requirement becomes one or more endpoints
  - Section 8 (User Flows) — each flow defines a sequence of API calls
  - Section 9 (Content & Data) — every entity and relationship
  - Section 10 (Business Rules) — constraints become validation rules and database constraints
  - Section 12 (Auth & Permissions) — auth requirements per endpoint, role-based access
  - Section 13 (Integrations) — external APIs that the system calls
- All files matching `plan/02-adrs/ADR-*.md`
- `plan/03-architecture/TECHNICAL-ARCHITECTURE.md`
- `plan/04-system-design/SYSTEM-DESIGN.md`
- `plan/02-adrs/ADR-0002-aas-conformance-level.md` — AAS conformance level
- `.claude/templates/AAS-INTEGRATION-GUIDE.md` — AAS integration guide (Section 4 for entities, endpoints, error codes)
- `.claude/templates/documents/DATA-MODEL.md` — data model template (if it exists)
- `.claude/templates/documents/API-DESIGN.md` — API design template (if it exists)

### Step 2: Derive All Data Entities

From PRD Section 9 (Content & Data) and Section 3 (Users), identify every entity the system must store. For each entity:

**Entity definition:**
- Name (singular PascalCase)
- Description of what it represents
- Field list: each field with name (snake_case), type, nullable, unique, default value, description
- Primary key strategy (UUID v4 preferred for portability)
- Audit fields: `created_at`, `updated_at` on every entity; `deleted_at` if soft-delete is used
- Indexes: which fields or combinations need indexes for query performance

**Field types to use:**
- String fields: specify max length based on business rules from PRD Section 10.2
- Numeric fields: specify precision for money (use integer cents, not float)
- Enum fields: list all valid values explicitly
- JSON/JSONB fields: describe the expected structure
- Timestamps: always use timezone-aware types

**Relationships:**
For each relationship between entities:
- Type: one-to-one, one-to-many, many-to-many
- Cardinality: required vs. optional on each side
- Foreign key: field name and referenced table
- Cascade behavior: on delete (restrict, cascade, set null) and on update
- For many-to-many: define the junction table with its own fields if applicable

**Validation rules:**
Every business rule from PRD Section 10.2 and 10.3 that constrains a field must be expressed as:
- Database constraint (check constraint, unique constraint, not null)
- Application-level validation rule (Zod schema or equivalent per stack)
- Both where applicable (defense in depth)

### Step 3: Design Migration Strategy

Define the approach for evolving the database schema:
- Migration tool (from stack template)
- Migration naming convention
- How migrations are run (CI/CD gate, startup check, manual)
- Policy on destructive migrations in production (always additive first, then cleanup)
- Rollback strategy

### Step 4: Design Data Lifecycle

For every entity in the system, define:
- Retention policy: how long data is kept
- Deletion behavior: hard delete vs. soft delete (and which approach per entity)
- Soft delete implementation: `deleted_at` timestamp, filtered from queries by default
- What is recoverable vs. permanently deleted
- Archival strategy for old data (if applicable per PRD Section 9.4)

### Step 5: Generate DATA-MODEL.md

Generate `plan/05-api-and-data/DATA-MODEL.md`.

**YAML frontmatter:**
```yaml
---
title: "[Application Name] — Data Model"
date: YYYY-MM-DD
version: "1.0"
phase: 5
source_documents:
  - "plan/01-prd/PRD.md"
  - "plan/04-system-design/SYSTEM-DESIGN.md"
---
```

**Required sections:**
1. Overview — entity list with one-line descriptions, entity relationship summary
2. Entity Reference Diagram — Mermaid ER diagram showing all entities and their relationships
3. Entity Definitions — one detailed subsection per entity covering all fields, types, constraints, indexes
4. Relationship Definitions — explicit list of all relationships with cardinality and cascade behavior
5. Indexes — dedicated section listing all indexes by entity (name, columns, type, purpose)
6. Validation Rules — by entity, the validation rules applied at both database and application level
7. Migration Strategy — tooling, naming, execution, rollback
8. Data Lifecycle — retention, deletion behavior, archival per entity, GDPR/right-to-erasure considerations

**AAS data entities (always included, scaled by ADR-0002 conformance level):**

Include AAS-specific data entities from `.claude/templates/AAS-INTEGRATION-GUIDE.md` Section 4.2:
- **Core:** `AASSession` (agent sessions), `AASIdempotencyRecord` (idempotency tracking), `AASOperation` (operation registry)
- **Operational adds:** `AXAChallengeRecord` (challenge state), `AXABehavioralBaseline` (behavioral baselines), `AASDelegation` (delegation chains), `AASChallengeCatalog` (challenge types)
- **Governed adds:** `AASAuditEvent` (audit chain), `AASRevocationEntry` (revoked tokens), `AASAttestationRecord` (attestation evidence)

Each AAS entity must be documented with the same detail as business entities: fields, types, constraints, indexes, relationships.

**Every entity in PRD Section 9 must appear in this document. If an entity is implied but not explicitly named in the PRD, name it and document it.**

### Step 6: Derive All Required API Endpoints

From PRD Section 7 (Functional Requirements) and Section 8 (User Flows), derive every endpoint needed:

**For each user flow in Section 8:**
- Map each step to an API call
- Identify the HTTP method and resource path
- Note which user role initiates this call (from PRD Section 12)

**For each functional requirement in Section 7:**
- Determine if it requires a new endpoint or is served by an existing one
- If a requirement is not covered by any mapped endpoint, add the missing endpoint

**Endpoint naming conventions:**
- RESTful resources in plural: `/users`, `/projects`, `/posts`
- Nested resources where ownership is tight: `/projects/{projectId}/tasks`
- Actions that don't map to CRUD: use verbs as sub-resources `/sessions` (login), `/invitations/{id}/accept`
- API version prefix: `/api/v1/`

**If GraphQL was selected in ADRs:**
Instead of REST endpoints, define:
- Query operations with arguments and return types
- Mutation operations with input types and return types
- Subscription operations (if real-time required)
- Input type definitions

### Step 7: Design Each Endpoint in Detail

For each endpoint, define:

**Request:**
- HTTP method and path
- Path parameters with types and validation
- Query parameters with types, validation, and defaults
- Request body schema (if applicable) — every field with type, required/optional, validation rules
- Required headers (Authorization, Content-Type)

**Response:**
- Success response HTTP status code
- Success response body schema — every field with type and description
- All possible error response codes with when they occur

**Authorization:**
- Which roles can call this endpoint (from PRD Section 12)
- Resource-level access check if applicable (e.g., "user can only update their own profile")

**Rate limiting:**
- Which rate limit tier applies (per-IP, per-user-authenticated, per-plan)
- Specific limit if different from the default tier

**Pagination (for list endpoints):**
- Pagination strategy: cursor-based or offset-based
- Default page size and maximum page size
- Sort parameters and default sort order

### Step 8: Design API-Wide Conventions

Define conventions applied uniformly across the entire API:

**Authentication:**
- How auth tokens are passed (Authorization header, HttpOnly cookie)
- Token format (Bearer JWT, session cookie)
- What happens when a token is expired or invalid

**Rate limiting tiers:**
- Define each tier (anonymous, authenticated, premium) with request limits and windows
- How rate limit status is communicated to clients (headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)

**Pagination:**
- Standard pagination query parameters (`limit`, `cursor` or `page`, `offset`)
- Standard pagination response envelope fields

**Error response format:**
Define the standard error JSON structure. Must include:
```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable message",
    "correlationId": "uuid",
    "details": [
      { "field": "email", "message": "Must be a valid email address" }
    ]
  }
}
```

**Success response envelope (if applicable):**
Whether list responses use an envelope: `{ "data": [...], "pagination": {...} }`

**Timestamps:**
All timestamps in ISO 8601 UTC format.

### Step 9: Generate API-DESIGN.md

Generate `plan/05-api-and-data/API-DESIGN.md`.

**YAML frontmatter:**
```yaml
---
title: "[Application Name] — API Design"
date: YYYY-MM-DD
version: "1.0"
phase: 5
source_documents:
  - "plan/01-prd/PRD.md"
  - "plan/04-system-design/SYSTEM-DESIGN.md"
  - "plan/05-api-and-data/DATA-MODEL.md"
---
```

**Required sections:**
1. API Overview — base URL, versioning strategy, API style (REST/GraphQL)
2. Authentication — how tokens are passed, token format, error on invalid token
3. Rate Limiting — tier definitions, limit headers
4. Pagination — strategy, parameters, response envelope
5. Error Response Format — standard error structure with examples
6. Endpoint Reference — one subsection per resource group, each endpoint documented completely
7. For each endpoint: method + path, description, auth requirements, request schema, response schema, error codes, user flow(s) it supports (by reference)

**Every endpoint must reference the user flow(s) from PRD Section 8 it supports.** An endpoint that supports no user flow is either unnecessary or represents a missing flow in the PRD.

**AAS API endpoints (always included, scaled by ADR-0002 conformance level):**

Include AAS endpoints from `.claude/templates/AAS-INTEGRATION-GUIDE.md` Section 4.3:
- **Core:** `GET /.well-known/aas.json` (manifest), `POST /v1/auth/nonce` (nonce request), `POST /v1/auth/token` (token exchange)
- **Operational adds:** `POST /v1/auth/challenge` (challenge request), `POST /v1/auth/challenge/verify` (challenge verification), `GET /v1/auth/challenge/catalog` (challenge catalog)
- **Governed adds:** `POST /v1/auth/attest` (attestation), `POST /v1/auth/revoke` (token revocation)

Each AAS endpoint must be documented with the same detail as business endpoints: request/response schemas, auth requirements, error codes.

**Error response format — AAS `application/problem+json`:**

All error responses across the entire API (both business and AAS endpoints) MUST use the `application/problem+json` format per AAS v0.6 Section 5.4. This replaces any custom error envelope. The format validates against `aas-problem-v0.4.schema.json` and uses error codes from `aas-error-codes-v0.6.schema.json`:

```json
{
  "type": "https://aas.dev/errors/MACHINE_READABLE_CODE",
  "title": "Human-readable title",
  "status": 400,
  "detail": "Specific detail about what went wrong",
  "instance": "/request/correlation-id",
  "error_code": "MACHINE_READABLE_CODE",
  "retryable": false,
  "retry_after_seconds": null
}
```

**Every functional requirement from PRD Section 7 must be covered by at least one endpoint.** At the end of the API design, include a traceability table mapping FR-XXX identifiers to endpoint(s).

### Step 10: Update Pipeline State

Update `plan/pipeline-state.json`:
- Set phase 5 `status` to `"complete"`
- Set `completed_at` to current ISO timestamp
- Populate `outputs` with `["plan/05-api-and-data/DATA-MODEL.md", "plan/05-api-and-data/API-DESIGN.md"]`
- Update `updated_at`

---

## Output Structure

```
plan/05-api-and-data/
├── DATA-MODEL.md
└── API-DESIGN.md
```

---

## Quality Checks Before Marking Complete

**Data Model:**
- [ ] Every entity from PRD Section 9 has a definition
- [ ] Every entity has a primary key, audit fields, and at least one index
- [ ] Every relationship has defined cardinality and cascade behavior
- [ ] Every business rule from PRD Section 10.2 appears as a validation rule
- [ ] ER diagram is syntactically valid Mermaid
- [ ] No entity exists without a stated purpose tied to the PRD

**API Design:**
- [ ] Every functional requirement from PRD Section 7 maps to at least one endpoint
- [ ] Every user flow from PRD Section 8 maps to a complete sequence of endpoints
- [ ] Every endpoint specifies auth requirements
- [ ] Every list endpoint has pagination defined
- [ ] Error response format uses `application/problem+json` with AAS error codes across all endpoints
- [ ] Traceability table is complete — no FR-XXX left unmapped
- [ ] AAS data entities are included in the data model (scaled by ADR-0002 conformance level)
- [ ] AAS API endpoints are included in the API design (scaled by ADR-0002 conformance level)
- [ ] All error responses use AAS error codes from `aas-error-codes-v0.6.schema.json`
- [ ] AAS endpoints include proper request/response schemas referencing AAS v0.6 schema files
