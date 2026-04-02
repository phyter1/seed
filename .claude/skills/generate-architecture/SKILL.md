---
name: generate-architecture
description: "Phase 3 — generates the Technical Architecture Document from PRD and ADRs, including system context, component diagrams, infrastructure, data flow, and security architecture. Called by dark-factory after Phase 2."
user-invocable: false
allowed-tools: Read, Write, Edit, Grep, Glob, WebSearch, WebFetch, Task
---

# Generate Technical Architecture Document

**Phase:** 3
**Input:** `plan/01-prd/PRD.md`, `plan/02-adrs/*.md`
**Output:** `plan/03-architecture/TECHNICAL-ARCHITECTURE.md`

---

## Instructions

### Step 1: Load All Upstream Context

Read the following files completely before generating anything:
- `plan/01-prd/PRD.md` — full product requirements
- All files matching `plan/02-adrs/ADR-*.md` — every ADR generated in Phase 2
- `plan/02-adrs/ADR-0001-stack-selection.md` specifically — to identify the selected stack
- `plan/02-adrs/ADR-0002-aas-conformance-level.md` specifically — to identify the AAS conformance level
- `.claude/templates/AAS-INTEGRATION-GUIDE.md` — AAS integration guide (Section 4 for architecture components)
- `.claude/templates/documents/TECHNICAL-ARCHITECTURE.md` — the architecture document template
- `.claude/templates/DEVELOPMENT-WORKFLOW.md` — engineering standards that must be reflected in security architecture

Read the selected stack template based on what ADR-0001 decided:
- `.claude/templates/stacks/ts-webapp.md` (if TypeScript web app)
- `.claude/templates/stacks/ts-api.md` (if TypeScript API)
- `.claude/templates/stacks/ts-library.md` (if TypeScript library)
- `.claude/templates/stacks/go-api.md` (if Go API)
- `.claude/templates/stacks/python-api.md` (if Python API)
- `.claude/templates/stacks/rust-api.md` (if Rust API)

### Step 2: Research Current Architecture Patterns

Perform web research using WebSearch and WebFetch to find current architecture patterns for the chosen stack and application type. Search for:
- "[stack name] production architecture patterns [current year]"
- "[application type] architecture best practices"
- "scalable [stack] architecture for [PRD application type]"
- "[selected database] connection patterns [stack name]"
- "[deployment platform from ADR] architecture patterns"

Gather concrete examples, patterns, and trade-offs. Do not rely solely on prior knowledge.

### Step 3: Identify All External Actors and Systems

From the PRD, catalog:
- All user types (Section 3.1 and 3.2)
- All required integrations (Section 13.1 and 13.2)
- All external systems implied by business rules (Section 10)
- Authentication providers decided in ADRs

These become the nodes in the System Context Diagram.

### Step 4: Design Major System Components

Based on PRD requirements and ADR decisions, identify all major components:
- Frontend application (if applicable per stack)
- API server(s)
- Background worker(s) — if PRD has async processing requirements
- Database(s) — per ADR decisions
- Cache layer — per ADR decisions
- Job queue — if background processing required
- CDN / static asset delivery — if web app

For each component, define:
- Purpose and responsibilities
- What it exposes (APIs, events, files)
- What it consumes (databases, caches, other services)
- Technology from the selected stack template

**AAS Module (always included, scaled by conformance level from ADR-0002):**

Add an AAS module component to the architecture. Consult `.claude/templates/AAS-INTEGRATION-GUIDE.md` Section 4.1 for the modules required at each conformance level:
- **Core:** aas-manifest, aas-errors, aas-handshake, aas-idempotency
- **Operational:** Core + axa-challenge, axa-behavioral, axa-delegation, aas-trust-tiers, aas-economics
- **Governed:** Operational + aas-audit, axa-attestation, aas-revocation, aas-governance

The AAS module should appear as a distinct component in the component architecture with its sub-modules listed based on the conformance level.

### Step 5: Design Infrastructure

Based on deployment ADR decisions and PRD non-functional requirements:
- Hosting platform for each component
- Networking and DNS strategy
- CDN configuration and what gets cached
- Monitoring, observability, and alerting tools
- Environment structure (local, dev, staging, production)

Infrastructure must satisfy:
- Uptime requirement from PRD Section 14.2
- Performance requirements from PRD Section 14.1
- Scale requirements from PRD Section 14.6

### Step 6: Design Data Flows

Trace data through the system for the PRD's primary use cases (Section 5):
- Primary write path: user action → validation → persistence → response
- Primary read path: request → cache check → database → response
- Async/background path: trigger → queue → worker → result

For applications with real-time requirements (per ADR), document the real-time data flow as well.

### Step 7: Design Security Architecture

Security architecture must align with `.claude/templates/DEVELOPMENT-WORKFLOW.md` standards. Cover:

**Authentication flow** (per auth ADR):
- Full step-by-step flow from user credential submission to token issuance
- Token format (JWT, opaque session, etc.)
- Token storage strategy (HttpOnly cookie, not localStorage)
- Refresh mechanism and session duration

**Authorization**:
- Model chosen (RBAC, ABAC, ownership-based)
- Enforcement point in the stack
- Permission mapping per user role from PRD Section 12.2

**Encryption**:
- In transit: TLS enforcement strategy
- At rest: database encryption, field-level encryption for PII
- Password hashing algorithm and parameters
- Secrets management (environment variables, never in code)

**Network security**:
- CORS policy
- Rate limiting strategy and limits per tier
- Input validation enforcement points
- SQL injection and injection attack prevention
- CSRF protection approach
- Security headers (CSP, HSTS, X-Frame-Options, etc.)

**AAS security architecture (scaled by ADR-0002 conformance level):**
- Agent session management: nonce-based handshake, token issuance, session lifecycle
- At operational+: AXA challenge verification, behavioral monitoring, delegation chain validation
- At governed: audit chain integrity, token revocation, attestation verification
- JWT claim validation: AAS minimum claim set (core), AXA extended claims (operational+), delegation claims (operational+)
- Error semantics: `application/problem+json` with AAS error codes mapped to HTTP status codes

### Step 8: Design Scalability Strategy

Based on PRD Section 14.6 (scalability) and Section 14.1 (performance):
- Horizontal scaling strategy for each component
- Caching layers with TTL and invalidation strategy
- Database scaling approach (connection pooling, read replicas, when needed)
- What cannot be horizontally scaled and how that constraint is managed

### Step 9: Generate the Document

Generate `plan/03-architecture/TECHNICAL-ARCHITECTURE.md` following `.claude/templates/documents/TECHNICAL-ARCHITECTURE.md`.

**YAML frontmatter:**
```yaml
---
title: "[Application Name from PRD] — Technical Architecture"
date: YYYY-MM-DD
version: "1.0"
phase: 3
source_documents:
  - "plan/01-prd/PRD.md"
  - "plan/02-adrs/ADR-0001-stack-selection.md"
  - "[list all other ADR files]"
---
```

**Required content:**
1. System overview with architecture pattern, deployment model, and key properties
2. System context diagram in Mermaid C4Context format — all external actors and systems
3. Component architecture — one section per major component with purpose, responsibilities, interfaces, and technology
4. Component interaction diagram in Mermaid graph format
5. Infrastructure architecture — hosting table, networking, CDN, monitoring
6. Data flow section — primary write path, primary read path, async processing, sequence diagram in Mermaid
7. Security architecture — complete auth flow, authorization, encryption, network security, secrets management
8. Scalability strategy — horizontal scaling, vertical scaling, caching layers, database scaling
9. Cross-cutting concerns — logging, error tracking, feature flags, background jobs
10. Technology stack summary table — every layer with technology, version, and justification referencing relevant ADR
11. Architecture decision references — list all ADRs and how each applies

**Diagram requirements:**
- All diagrams must use Mermaid syntax or ASCII — no image dependencies
- System context diagram must include all external actors from PRD Section 13
- Component interaction diagram must show all components and their communication paths
- Data flow sequence diagram must cover at least the primary write and read paths

**Traceability requirement:**
Every major design decision in this document must either:
- Reference the ADR that made the decision (cite by ADR number)
- Or include inline rationale citing the specific PRD requirement

### Step 10: Update Pipeline State

Update `plan/pipeline-state.json`:
- Set phase 3 `status` to `"complete"`
- Set `completed_at` to current ISO timestamp
- Populate `outputs` with `["plan/03-architecture/TECHNICAL-ARCHITECTURE.md"]`
- Update `updated_at`

---

## Quality Checks Before Marking Complete

- [ ] All user types from PRD appear in system context diagram
- [ ] All external integrations from PRD Section 13 appear in system context diagram
- [ ] Every component has technology justified by the selected stack or an ADR
- [ ] Security architecture covers all points from DEVELOPMENT-WORKFLOW.md
- [ ] All Mermaid diagrams are syntactically valid (use correct syntax)
- [ ] Technology stack table includes every layer, not just the framework
- [ ] Every ADR is referenced somewhere in the document
- [ ] AAS module appears in component architecture with sub-modules scaled to ADR-0002 conformance level
- [ ] AAS security architecture subsection is present covering agent session management and error semantics
- [ ] AAS endpoints from AAS-INTEGRATION-GUIDE.md Section 4.3 appear in data flow diagrams (scaled by level)
- [ ] ADR-0002 (AAS conformance level) is referenced in the architecture decision references section
