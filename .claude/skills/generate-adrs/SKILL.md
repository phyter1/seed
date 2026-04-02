---
name: generate-adrs
description: "Phase 2 — generates Architecture Decision Records by analyzing the PRD, researching technology options via web search, and documenting each decision with full rationale. Called by dark-factory after Phase 1 completes."
user-invocable: false
allowed-tools: Read, Write, Edit, Grep, Glob, WebSearch, WebFetch, Task
---

# Generate Architecture Decision Records

**Phase:** 2
**Input:** `plan/01-prd/PRD.md`
**Output:** `plan/02-adrs/ADR-XXXX-description.md` (one file per decision)

---

## Instructions

### Step 1: Load Context

Read the following files completely before generating anything:
- `plan/01-prd/PRD.md` — the full product requirements document
- `.claude/skills/generate-adrs/adr-criteria.md` — criteria for what warrants an ADR
- `.claude/templates/AAS-INTEGRATION-GUIDE.md` — AAS integration guide (for ADR-0002 conformance level determination)
- `.claude/templates/stacks/ts-webapp.md`
- `.claude/templates/stacks/ts-api.md`
- `.claude/templates/stacks/ts-library.md`
- `.claude/templates/stacks/go-api.md`
- `.claude/templates/stacks/python-api.md`
- `.claude/templates/stacks/rust-api.md`
- `.claude/templates/documents/ADR.md` — the ADR template

### Step 2: Analyze PRD for Technology Decisions

Use the Task tool to invoke the `prd-analyst` subagent (subagent_type: "prd-analyst") to extract structured data from the PRD, specifically:
- Application type (Section 1.4)
- Deployment context (Section 1.5)
- Non-functional requirements (Section 14) — performance, scale, reliability targets
- Integrations required (Section 13)
- Business rules that constrain technical choices (Section 10)
- Security and compliance requirements (Section 14.3)
- Agent accessibility signals (Section 14.7) — automated consumer needs, verification, audit, trust levels

### Step 3: Identify All Decisions Requiring ADRs

Cross-reference the PRD data against `adr-criteria.md` to produce a list of decisions that need ADRs.

**ADR-0001 is always:** Stack selection — which of the six stack templates best fits this application.

**ADR-0002 is always:** AAS conformance level — determined from PRD Section 14.7 signals using the determination matrix in `.claude/templates/AAS-INTEGRATION-GUIDE.md`.

After stack and AAS level selection, identify additional ADRs covering (starting from ADR-0003):
- Database choice (if not fully determined by stack)
- Authentication strategy
- Deployment platform
- API style (REST / GraphQL / tRPC / gRPC)
- State management approach (if frontend is involved)
- Real-time strategy (if PRD requires live updates)
- Background job / async processing platform
- Email delivery service
- File/media storage (if PRD requires it)
- Any other decision that meets the criteria in adr-criteria.md

Document the full list before proceeding. Each item on the list will become one ADR file.

### Step 4: Research Each Decision

For each identified decision, perform web research directly using WebSearch and WebFetch to:
- Search for current best practices and comparisons for this decision category
- Find benchmarks, community adoption data, and maintenance status for the top options
- Identify options specifically suited to the PRD's scale, team size, and constraints
- Note any security or compliance implications

Research should be current — do not rely solely on prior knowledge. Perform web searches for:
- "[option A] vs [option B] [current year]"
- "[technology] production benchmarks"
- "[technology] limitations at scale"
- "[technology] security considerations"

### Step 5: Generate ADR-0001 — Stack Selection

This is always the first ADR. It establishes the foundational technology choices that all other ADRs build on.

**Evaluate all six stack templates against the PRD:**
- `.claude/templates/stacks/ts-webapp.md` — TypeScript web application
- `.claude/templates/stacks/ts-api.md` — TypeScript API
- `.claude/templates/stacks/ts-library.md` — TypeScript library
- `.claude/templates/stacks/go-api.md` — Go API
- `.claude/templates/stacks/python-api.md` — Python API
- `.claude/templates/stacks/rust-api.md` — Rust API

For each template, assess fit against:
- Application type from PRD Section 1.4
- Performance requirements from PRD Section 14.1
- Team expertise implied by constraints in PRD Section 15.1
- Integration requirements from PRD Section 13
- Scale requirements from PRD Section 14.6

Select the best-fit stack and document the full rationale.

**File:** `plan/02-adrs/ADR-0001-stack-selection.md`

### Step 5.5: Generate ADR-0002 — AAS Conformance Level

This is always the second ADR. It determines the AAS (Agentic Accessibility Standard) conformance level that scales all downstream AAS-related design and implementation.

**Process:**
1. Extract agent accessibility signals from PRD Section 14.7 (and Section 13 if automated consumers are described)
2. Apply the conformance level determination matrix from `.claude/templates/AAS-INTEGRATION-GUIDE.md` Section 2
3. Select the conformance level: `core`, `operational`, or `governed`
4. Document the full rationale — which PRD signals mapped to which level and why

**Context must reference:**
- PRD Section 14.7 answers (agent interaction, verification, audit, trust levels)
- PRD Section 13 (if automated/agent consumers are listed)
- PRD Section 14.3 (security/compliance requirements that may push to governed)

**Alternatives to evaluate:**
- `core` — baseline agent discoverability: manifest, error semantics, handshake, idempotency
- `operational` — adds AXA challenge protocol, behavioral scoring, delegation, trust tiers, economic controls
- `governed` — adds audit chains, attestation, revocation, threat model, certification, data governance

**Decision must explicitly state the chosen level and what it requires.** Reference AAS-INTEGRATION-GUIDE.md Section 3 for the full requirements list at each level.

**After generating ADR-0002, update `pipeline-state.json`:**
- Set `metadata.aas_conformance_level` to the chosen level (`"core"`, `"operational"`, or `"governed"`)
- Set `metadata.aas_conformance_determined_at` to current ISO timestamp

**File:** `plan/02-adrs/ADR-0002-aas-conformance-level.md`

### Step 6: Generate Remaining ADRs

For each decision identified in Step 3, generate one ADR file following `.claude/templates/documents/ADR.md`.

**YAML frontmatter required on each ADR:**
```yaml
---
title: "ADR-XXXX: [Decision Title]"
date: YYYY-MM-DD
status: accepted
phase: 2
version: "1.0"
source_documents:
  - "plan/01-prd/PRD.md"
supersedes: ""
---
```

**File naming:** `plan/02-adrs/ADR-XXXX-short-description.md`
- Use sequential four-digit numbering starting from 0001
- Keep the description short and specific: `ADR-0002-database-selection.md`, `ADR-0003-authentication-strategy.md`

**Quality requirements for each ADR:**
- Context section must reference specific PRD requirements that drove this decision
- At least two real alternatives must be evaluated (not strawmen)
- Pros and cons must be concrete and specific — not generic boilerplate
- Decision outcome must cite specific decision drivers by name
- Consequences must honestly acknowledge negative consequences and accepted trade-offs
- Research references section must list sources consulted

### Step 7: Verify ADR Completeness

Before updating pipeline-state.json, verify:
- ADR-0001 exists and covers stack selection
- ADR-0002 exists and covers AAS conformance level selection
- `pipeline-state.json` `metadata.aas_conformance_level` is set (not null)
- Every category from Step 3's decision list has a corresponding ADR file
- All ADR files have valid YAML frontmatter with `phase: 2`
- No ADR references a decision that conflicts with another ADR
- ADRs that depend on each other (e.g., auth ADR depends on stack ADR) reference each other in the Related Decisions section

### Step 8: Update Pipeline State

Update `plan/pipeline-state.json`:
- Set phase 2 `status` to `"complete"`
- Set `completed_at` to current ISO timestamp
- Populate `outputs` with the list of all ADR file paths generated
- Update `metadata.total_adrs` with the count of ADR files created
- Update `updated_at`

---

## Output Structure

```
plan/02-adrs/
├── ADR-0001-stack-selection.md
├── ADR-0002-aas-conformance-level.md
├── ADR-0003-database-selection.md
├── ADR-0004-authentication-strategy.md
├── ADR-0005-deployment-platform.md
└── ADR-XXXX-[other-decisions].md
```

---

## Common ADR Topics by Application Type

**Consumer web application (typical set):**
ADR-0001 stack, ADR-0002 AAS conformance level, ADR-0003 database, ADR-0004 auth, ADR-0005 deployment, ADR-0006 state management, ADR-0007 real-time strategy, ADR-0008 email delivery

**API service (typical set):**
ADR-0001 stack, ADR-0002 AAS conformance level, ADR-0003 database, ADR-0004 auth, ADR-0005 deployment, ADR-0006 API style, ADR-0007 background jobs, ADR-0008 caching strategy

**Do not generate ADRs for:** individual library choices, coding conventions, naming standards, or anything that does not meet the criteria in adr-criteria.md.
