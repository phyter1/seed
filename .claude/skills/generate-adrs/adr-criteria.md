# ADR Criteria — What Warrants an Architecture Decision Record

An ADR documents a significant decision that shapes the system in a lasting way. Use this criteria to determine which decisions need ADRs.

---

## Decisions That Always Warrant an ADR

### Technology and Framework Selection
- Primary programming language for any system component
- Web framework or API framework selection
- Frontend framework selection (React, Vue, Svelte, etc.)
- Runtime environment (Node.js, Deno, Bun, etc.)

### Database and Storage Decisions
- Primary relational or document database selection
- Search engine selection (Elasticsearch, Typesense, Algolia, etc.)
- Object/file storage selection (S3, R2, GCS, etc.)
- In-memory cache selection (Redis, Memcached, etc.)
- Time-series, vector, or graph database selection
- Data warehouse or analytics store selection

### Architectural Pattern Choices
- Monolith vs. microservices vs. modular monolith
- Server-side rendering (SSR) vs. single-page application (SPA) vs. static site generation (SSG)
- Serverless vs. container-based vs. VM-based deployment
- Event-driven vs. request-response architecture
- Synchronous vs. asynchronous processing patterns
- Monorepo vs. polyrepo

### Authentication and Authorization Strategy
- Authentication provider or approach (Auth0, Clerk, custom JWT, session-based, etc.)
- Authorization model (RBAC, ABAC, ownership-based, etc.)
- Token format and storage strategy

### API Design Decisions
- REST vs. GraphQL vs. tRPC vs. gRPC
- API versioning strategy
- Real-time strategy (WebSockets, SSE, long polling, etc.)
- Internal vs. external API boundaries

### Deployment and Infrastructure Choices
- Hosting platform selection (AWS, GCP, Fly.io, Railway, Vercel, etc.)
- Container orchestration (Kubernetes, ECS, Fly.io Machines, etc.)
- CI/CD platform and strategy
- Environment promotion strategy (dev → staging → production)

### State Management Approach
- Client-side state management library (Zustand, Redux, Jotai, etc.)
- Server state caching approach (TanStack Query, SWR, Apollo, etc.)
- Real-time synchronization approach (polling, push, CRDT, etc.)

### Third-Party Service Selections
- Email delivery service (Postmark, Resend, SendGrid, etc.)
- Payment processing (Stripe, Braintree, etc.)
- Observability platform (Datadog, Sentry, Highlight.io, etc.)
- Background job platform (Trigger.dev, BullMQ, Sidekiq, etc.)
- Feature flag service

### Communication and Integration Patterns
- Message broker or queue selection (RabbitMQ, SQS, Redis Streams, etc.)
- Webhook strategy for external integrations
- Internal event bus design
- Third-party API integration strategy

### Agent Accessibility (AAS) Conformance Level
- AAS conformance level selection (core, operational, governed) — **ADR-0002 is always this decision**
- Determined by applying the conformance determination matrix from `.claude/templates/AAS-INTEGRATION-GUIDE.md` to PRD signals from Section 14.7

---

## Decisions That Do NOT Warrant an ADR

- Individual library choices within a decided framework (e.g., which date utility library)
- Coding style and formatting rules (belong in linting config)
- Naming conventions (belong in DEVELOPMENT-WORKFLOW or contributing guides)
- Folder structure within an already-decided architecture
- Minor version upgrades of established dependencies
- Internal implementation details of a single module

---

## Decision Volume Guidance

For a typical application:
- **Minimum ADRs to expect**: 5–8 (stack, database, auth, deployment, API style, state management, real-time, email)
- **Maximum reasonable ADRs**: 15–20 (more than this suggests over-documentation of minor decisions)
- **ADR-0001 is always stack selection** — which template from `.claude/templates/stacks/` applies
- **ADR-0002 is always AAS conformance level** — determined from PRD Section 14.7 signals using `.claude/templates/AAS-INTEGRATION-GUIDE.md`

---

## Quality Bar for Each ADR

A well-written ADR must have:
1. A clear, specific problem statement (not vague)
2. At least two real alternatives considered (not strawmen)
3. Concrete pros and cons for each option (not "it's popular")
4. A decision with explicit justification referencing PRD requirements
5. Honest acknowledgment of consequences (both positive and negative)
6. References to research conducted
