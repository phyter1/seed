---
name: generate-system-design
description: "Phase 4 — generates the System Design Document with module breakdown, state management, caching, error handling, background jobs, and event system. Called by dark-factory after Phase 3."
user-invocable: false
allowed-tools: Read, Write, Edit, Grep, Glob
---

# Generate System Design Document

**Phase:** 4
**Input:** `plan/01-prd/PRD.md`, `plan/02-adrs/*.md`, `plan/03-architecture/TECHNICAL-ARCHITECTURE.md`
**Output:** `plan/04-system-design/SYSTEM-DESIGN.md`

---

## Instructions

### Step 1: Load All Upstream Context

Read the following files completely before generating anything:
- `plan/01-prd/PRD.md` — full product requirements
- All files matching `plan/02-adrs/ADR-*.md` — every architecture decision
- `plan/02-adrs/ADR-0002-aas-conformance-level.md` specifically — AAS conformance level
- `plan/03-architecture/TECHNICAL-ARCHITECTURE.md` — the technical architecture
- `.claude/templates/AAS-INTEGRATION-GUIDE.md` — AAS integration guide (Section 4 for module details, error codes)
- `.claude/templates/documents/SYSTEM-DESIGN.md` — the system design template (if it exists; otherwise follow the structure defined in this skill)
- `.claude/templates/DEVELOPMENT-WORKFLOW.md` — error handling standards, logging standards, TDD cycle

### Step 2: Derive Module Boundaries

From the PRD and architecture document, identify all discrete modules (also called bounded contexts or subsystems). A module is a cohesive group of functionality with a clear public interface.

For each PRD functional area (Section 7), determine which module owns it. Common modules include:
- Authentication and identity
- User profile and account management
- Core domain entity management (one module per major domain concept)
- Notification system
- Background processing / jobs
- File/media handling (if applicable)
- Analytics or reporting (if applicable)
- Admin functionality (if applicable)

Each module must have a clear owner — no feature should belong to two modules.

**AAS modules (always included, scaled by ADR-0002 conformance level):**

Include AAS modules from `.claude/templates/AAS-INTEGRATION-GUIDE.md` Section 4.1 as part of the module breakdown. These are separate modules from the application's business logic:
- **Core:** aas-manifest (manifest serving + operation registry), aas-errors (error middleware), aas-handshake (nonce/session management), aas-idempotency (idempotency key tracking)
- **Operational adds:** axa-challenge (challenge protocol engine), axa-behavioral (behavioral scoring), axa-delegation (delegation tokens), aas-trust-tiers (trust classification), aas-economics (budget enforcement)
- **Governed adds:** aas-audit (audit chain), axa-attestation (attestation verification), aas-revocation (token revocation), aas-governance (threat model, portability, certification)

Each AAS module must be documented with the same detail as business modules: purpose, public interface, internal structure, dependencies, data owned.

### Step 3: Define Module Detail

For each module identified in Step 2, define:

**Purpose:** One sentence describing what this module is responsible for.

**Public interface:** The operations this module exposes to the rest of the system. Be specific — name the functions, events, or API endpoints. This is the contract other modules depend on.

**Internal structure:** How the module is organized internally. Typical layers:
- Routes or controllers (request handling)
- Service layer (business logic)
- Repository or data access layer (persistence)
- Domain models or types

**Dependencies:** Which other modules this module calls. Must be explicitly listed so the dependency graph can be derived.

**Data owned:** Which entities from the data model this module owns. Every entity must have exactly one owning module.

### Step 4: Design State Management Strategy

Determine where application state lives. For every category of state in the application:

**Server state (persisted):** Entities stored in the primary database — which module owns them.

**Cache state:** What is stored in the cache layer, TTL, and invalidation triggers. Based on the caching ADR if one was made.

**Client state (if frontend):** What is kept in client memory — distinguish between:
- Server cache state (data fetched from API, managed by TanStack Query / SWR / Apollo)
- Local UI state (ephemeral, component-level, not persisted)
- Shared application state (cross-component, managed by state library per stack template)

**Real-time state (if applicable):** What state is pushed from server to client, what triggers updates, what the latency requirement is.

### Step 5: Design Caching Strategy

For each caching layer identified in the architecture:

**What is cached:** Specific entities, query results, or computed values — not vague categories.

**Cache key structure:** How cache keys are constructed to allow targeted invalidation.

**TTL:** Time-to-live for each cached item type. Different entities may warrant different TTLs.

**Invalidation triggers:** What events cause each cache entry to be invalidated. Be specific — "user updates their profile" not "data changes."

**Cache miss behavior:** What happens when a cache miss occurs — fallback to database, return empty, queue a background computation.

**Consistency requirements:** Where eventual consistency is acceptable vs. where strong consistency is required.

### Step 6: Design Error Handling Strategy

Following `.claude/templates/DEVELOPMENT-WORKFLOW.md` standards:

**Custom error class hierarchy:**
Define the error class hierarchy the application will use. Every error category must have a class. At minimum:
- AppError (base class) with message, code, HTTP status, context
- ValidationError (400) — invalid input
- AuthenticationError (401) — not authenticated
- AuthorizationError (403) — authenticated but not permitted
- NotFoundError (404) — entity not found
- ConflictError (409) — state conflict (duplicate, version mismatch)
- RateLimitError (429) — rate limit exceeded
- ExternalServiceError (502/503) — external dependency failed

**AAS error code mapping:**
Map all 26 AAS error codes (from `aas-error-codes-v0.6.schema.json`, listed in AAS-INTEGRATION-GUIDE.md Section 4.4) to the custom error class hierarchy. Every AAS error code must map to exactly one error class. The 9 AXA-specific codes are only relevant at operational+ conformance.

**Error propagation pattern:**
How errors bubble from data layer → service layer → route handler → HTTP response.

**Client error contract:**
The JSON structure returned to API clients for errors. Must include:
- Error code (machine-readable string)
- Message (human-readable)
- Correlation ID (for support tracing)
- Validation details (for 400 errors — field-level messages)

**Logging on error:**
What is logged when each error type occurs. Must follow DEVELOPMENT-WORKFLOW.md: always include correlation ID, user ID if available, action context. Never log PII, passwords, tokens.

**Correlation ID flow:**
How correlation IDs are generated (at request ingress), propagated through service calls, and included in all log entries and error responses.

### Step 7: Design Background Jobs System

For every async processing requirement in the PRD (Sections 7 and 10.4):

**Job types:** Catalog every job type with:
- Name and trigger event
- Payload structure
- Processing time expectation
- Idempotency requirement (what happens if it runs twice)
- Priority level

**Queue design:**
- Separate queues by priority or job category (if applicable)
- Concurrency limits per queue
- Job timeout per type

**Retry policy:**
- Default retry count (recommend 3)
- Backoff strategy (exponential with jitter)
- When a job goes to the dead letter queue

**Dead letter handling:**
- What happens to dead-lettered jobs — alerting, manual retry, permanent failure

**Job monitoring:**
- Queue depth alerting thresholds
- Processing latency alerting
- Dead letter queue size alerting

### Step 8: Design Events and Notifications

**AAS domain events (always included, scaled by conformance level):**

Include AAS-specific domain events in the events catalog:
- **Core:** `AgentSessionCreated`, `AgentSessionExpired`, `ManifestUpdated`, `IdempotencyKeyConflict`
- **Operational adds:** `ChallengeIssued`, `ChallengeVerified`, `ChallengeFailed`, `BehavioralConfidenceDrop`, `RechallengeTriggered`, `DelegationTokenIssued`, `DelegationRejected`, `TrustTierAssigned`
- **Governed adds:** `AuditEventEmitted`, `AuditChainAnchored`, `TokenRevoked`, `AttestationVerified`, `AttestationFailed`

Each event follows the same structure as business domain events (name, emitting module, consuming modules, payload schema).

**Internal events (domain events):**
List every business event that components emit when state changes. For each:
- Event name (past tense: UserRegistered, OrderPlaced, PaymentFailed)
- Emitting module
- Consuming modules
- Payload schema

**User-facing notifications:**
For every notification in PRD Section 11.6:
- Trigger event
- Notification type (in-app, email, push)
- Template or content description
- Delivery guarantee (at-least-once, at-most-once)
- Timing (immediate, delayed, batched)

**Email system design:**
If email is required:
- Templating approach
- Unsubscribe handling
- Bounce and complaint handling
- Transactional vs. marketing email separation

### Step 9: Design File and Media Handling (if applicable)

Only include if PRD requires file upload or media:
- Upload flow (direct upload to storage vs. server-proxied)
- Accepted file types and size limits from PRD
- Storage organization (directory structure or key convention)
- Processing pipeline (resize, transcode, virus scan, etc.)
- CDN delivery strategy
- Access control (public, private, presigned URLs)
- Cleanup and lifecycle management

### Step 10: Generate the Document

Generate `plan/04-system-design/SYSTEM-DESIGN.md`.

**YAML frontmatter:**
```yaml
---
title: "[Application Name] — System Design"
date: YYYY-MM-DD
version: "1.0"
phase: 4
source_documents:
  - "plan/01-prd/PRD.md"
  - "plan/03-architecture/TECHNICAL-ARCHITECTURE.md"
  - "[list all ADR files]"
---
```

**Required sections:**
1. Module Breakdown — one subsection per module with purpose, public interface, internal structure, dependencies, data owned
2. Module Dependency Graph — text-based diagram showing which modules depend on which (no cycles allowed)
3. State Management Strategy — server, cache, client (if applicable), real-time (if applicable)
4. Caching Strategy — layers, what is cached, TTL, invalidation, consistency
5. Error Handling Strategy — error class hierarchy, propagation, client contract, logging, correlation IDs
6. Background Jobs System — job catalog, queue design, retry policy, dead letter handling, monitoring
7. Events and Notifications System — domain events, user notifications, email system
8. File and Media Handling — only if applicable per PRD
9. Third-Party Integration Details — per integration: auth mechanism, data flow, error handling, fallback, circuit breaker
10. Module Dependency Graph — visual Mermaid diagram of all module relationships

**Traceability requirement:**
Every design decision must trace back to:
- A specific PRD requirement (cite section and requirement ID if available), or
- An ADR (cite by number)

No design element should exist without a stated reason.

### Step 11: Update Pipeline State

Update `plan/pipeline-state.json`:
- Set phase 4 `status` to `"complete"`
- Set `completed_at` to current ISO timestamp
- Populate `outputs` with `["plan/04-system-design/SYSTEM-DESIGN.md"]`
- Update `updated_at`

---

## Quality Checks Before Marking Complete

- [ ] Every PRD functional area (Section 7) is owned by exactly one module
- [ ] No circular dependencies exist in the module dependency graph
- [ ] Error class hierarchy covers all error categories needed by the application
- [ ] Every background job in PRD Section 10.4 has a corresponding job definition
- [ ] Every notification in PRD Section 11.6 has a corresponding notification design
- [ ] All design decisions cite a PRD requirement or ADR
- [ ] Error handling strategy is consistent with DEVELOPMENT-WORKFLOW.md standards
- [ ] AAS modules appear in the module breakdown with full detail (scaled by ADR-0002 conformance level)
- [ ] AAS error codes are mapped to the error class hierarchy
- [ ] AAS domain events are included in the events catalog
