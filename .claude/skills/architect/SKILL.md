---
name: architect
description: Generate comprehensive technical architecture from PRD with heavy web research and Architecture Decision Records. Use this skill when detailed system design is needed, when technology decisions need documentation, or when ADRs are required.
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, AskUserQuestion, Task
argument-hint: [path-to-prd]
user-invocable: true
---

# Architecture Generation from PRD

**Input**: `$ARGUMENTS` (path to PRD document)
**Output**: Comprehensive architecture documentation with ADRs

## Process Overview

1. **Analyze** the PRD requirements
2. **Research** current best practices and technologies
3. **Make** and document technology decisions
4. **Design** the system architecture
5. **Create** Architecture Decision Records (ADRs)
6. **Output** complete architecture documentation

## Step 1: PRD Analysis

Read and analyze the PRD. Extract and categorize:
- **Functional Requirements**: What the system must do
- **Non-Functional Requirements**: Performance, scalability, security
- **Integration Requirements**: External systems and services
- **Data Requirements**: What data exists and how it flows
- **User Context**: Devices, connectivity, usage patterns
- **Constraints**: Timeline, budget, team skills

## Step 2: Research Phase

**CRITICAL**: Conduct comprehensive web research before decisions.

Research for each technology area:
- Current state (latest versions, features)
- Performance characteristics
- Ecosystem health (community, maintenance)
- Comparison with alternatives
- Integration patterns
- Known issues and mitigations

Store research in `plan/research/[project-name]-architecture-research.md`.

## Step 3: Architecture Decisions

For each major decision, create an ADR:

### ADR Format
```markdown
## ADR-XXX: [Title]

**Status**: Proposed | Accepted | Deprecated
**Date**: YYYY-MM-DD
**Context**: [What is the issue?]
**Decision**: [What is the change?]
**Consequences**: [Positive and negative impacts]
**Alternatives**: [What else was considered and why rejected]
```

### Required ADRs
- ADR-001: Primary language/runtime
- ADR-002: Web framework
- ADR-003: Database technology
- ADR-004: Authentication approach
- ADR-005: Deployment platform
- Additional ADRs for significant decisions

## Step 4: System Design

Design and document:

### Component Architecture
- Component breakdown
- Responsibilities
- Interfaces between components

### Data Architecture
- Entity relationship model
- Data flow diagrams
- Storage decisions

### API Design
- Endpoint structure
- Request/response formats
- Error handling approach

### Security Architecture
- Authentication flow
- Authorization model
- Data protection

### Infrastructure
- Deployment architecture
- Scaling strategy
- Monitoring approach

## Step 5: Generate Architecture Document

**Save to**: `plan/architecture/[project-name]-architecture.md`

Include:
- Executive Summary
- System Overview (Context Diagram, Key Components)
- Architecture Decision Records
- Component Architecture (diagrams, interfaces)
- Data Architecture (model, flow, storage)
- API Design (endpoints, contracts, errors)
- Security Architecture (auth, authz, data protection)
- Infrastructure (deployment, scaling, DR)
- Observability (logging, metrics, alerting)
- Implementation Phases
- References

## Quality Checklist

- [ ] All ADRs have clear rationale
- [ ] Architecture addresses all PRD requirements
- [ ] Diagrams are clear and complete
- [ ] Security considerations comprehensive
- [ ] Scaling strategy defined
- [ ] Monitoring approach specified

---

**Begin architecture generation. Start by reading the PRD.**
