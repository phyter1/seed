---
title: "ADR-XXXX: [Decision Title]"
date: YYYY-MM-DD
status: proposed
# status options: proposed | accepted | deprecated | superseded
phase: "[Phase name, e.g., Architecture, Implementation, Post-launch]"
version: "1.0"
source_documents:
  - "[Path or reference to PRD, architecture doc, or other source]"
  - "[Path or reference to related document]"
supersedes: ""
# supersedes: "ADR-XXXX" — fill in if this replaces a prior decision
---

# ADR-XXXX: [Decision Title]

> **Purpose:** Document a significant architectural or technical decision, the context that led to it, the alternatives considered, and the consequences of the choice. One decision per ADR. Be specific — vague ADRs are useless ADRs.

---

## Context and Problem Statement

[Describe the architectural, technical, or organizational challenge that forced a decision. What situation exists? What constraints apply? What triggered the need to make a decision now? Be concrete — describe the actual problem, not the solution.]

[Example: "We need to select a primary data store for user-generated content. The system must handle X writes/second at launch and scale to Y within 18 months. We have two engineers with PostgreSQL experience and none with MongoDB."]

---

## Decision Drivers

Factors that influenced this decision, in priority order:

1. [Most important driver — e.g., "Team expertise and operational capacity"]
2. [Second driver — e.g., "Consistency with existing infrastructure"]
3. [Third driver — e.g., "Total cost of ownership at projected scale"]
4. [Fourth driver — e.g., "Vendor lock-in risk and portability"]
5. [Add as many as needed]

---

## Options Considered

### Option 1: [Option Name]

[Brief description of this option — what it is and how it addresses the problem.]

**Pros:**
- [Advantage 1]
- [Advantage 2]
- [Advantage 3]

**Cons:**
- [Disadvantage 1]
- [Disadvantage 2]
- [Disadvantage 3]

---

### Option 2: [Option Name]

[Brief description of this option.]

**Pros:**
- [Advantage 1]
- [Advantage 2]

**Cons:**
- [Disadvantage 1]
- [Disadvantage 2]

---

### Option 3: [Option Name]

[Brief description of this option.]

**Pros:**
- [Advantage 1]
- [Advantage 2]

**Cons:**
- [Disadvantage 1]
- [Disadvantage 2]

---

## Decision Outcome

**Chosen option:** [Option Name]

**Justification:** [Why this option was selected over the alternatives. Reference specific decision drivers. Be direct — "we chose this because X, Y, and Z" not "this seemed like the best fit."]

**Decision date:** YYYY-MM-DD

**Decision maker(s):** [Names or roles who made this call]

---

## Consequences

### Positive
- [What improves or becomes possible as a result of this decision]
- [What risk or burden is removed]
- [What future options are preserved]

### Negative
- [What becomes harder or more expensive as a result]
- [What technical debt is accepted]
- [What future options are foreclosed]

### Neutral
- [Significant changes that are neither clearly good nor bad]
- [Things that must now be tracked or managed]
- [Follow-up work this decision creates]

---

## Related Decisions

- [ADR-XXXX: Title — relationship, e.g., "This decision depends on the database selection in ADR-0012"]
- [ADR-XXXX: Title — relationship]

---

## Research References

Sources and materials consulted in reaching this decision:

- [Title — URL or document path — brief note on relevance]
- [Title — URL or document path — brief note on relevance]
- [Title — URL or document path — brief note on relevance]

---

### Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0 | YYYY-MM-DD | | Initial draft |
