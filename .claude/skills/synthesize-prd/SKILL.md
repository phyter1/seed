---
name: synthesize-prd
description: Transform an ideation capture document into a comprehensive Product Requirements Document. Use this skill after /ideate is complete, when you have raw ideation notes that need to be formalized, or when the user wants to create a PRD from existing research.
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, AskUserQuestion, Task
argument-hint: [path-to-ideation-document]
user-invocable: true
---

# PRD Synthesis from Ideation

**Input**: `$ARGUMENTS` (path to ideation capture document)
**Output**: Complete PRD following protocol specifications

## Process Overview

1. **Read** the ideation capture document
2. **Research** to fill gaps and validate assumptions
3. **Synthesize** into PRD format
4. **Validate** completeness and coherence
5. **Output** the final PRD document

## Step 1: Read and Analyze Ideation

Read the ideation capture document at `$ARGUMENTS`.

Analyze for:
- **Completeness**: What sections are well-defined vs. sparse?
- **Assumptions**: What was assumed that needs validation?
- **Gaps**: What critical information is missing?
- **Ambiguities**: What needs clarification?

## Step 2: Research Phase

For each gap or assumption, conduct targeted research:

### Market Research
- Industry context and trends
- Competitor analysis
- User expectations in the space

### Technical Research
- Current best practices
- Common integration patterns
- Security/compliance requirements

### Business Research
- Pricing models in the space
- Monetization strategies
- Success metrics for similar products

Store research in `plan/research/[project-name]-prd-research.md`.

## Step 3: Gap Resolution

If critical information is missing, ask the user using AskUserQuestion.

## Step 4: PRD Generation

Generate the PRD at `plan/prd/PRD-[project-name]-v1.0.md` with sections:

- Document Information (ID, dates, status, version)
- Executive Summary
- Product Overview (Purpose, Strategic Context, Problem Statement)
- Success Metrics and KPIs
- Target Users and Personas
- User Stories and Scenarios (organized by Epic)
- Feature Requirements (Core MVP, Future)
- Non-Functional Requirements (Performance, Security, Reliability, Usability)
- Technical Specifications
- Constraints and Assumptions
- Scope Definition (In/Out of Scope)
- Timeline and Milestones
- Risk Assessment
- Open Questions and Decisions
- Dependencies
- Appendices (Glossary, Research, References)

## Step 5: Validation

### Completeness Checklist
- [ ] All personas have clear goals and pain points
- [ ] All user stories have testable acceptance criteria
- [ ] All features have clear functional requirements
- [ ] All non-functional requirements are measurable
- [ ] All assumptions are documented
- [ ] All risks have mitigation strategies

### Coherence Checklist
- [ ] Features trace back to user stories
- [ ] User stories trace back to personas
- [ ] Personas trace back to problem statement
- [ ] Success metrics align with business objectives

## Output

**Save to**: `plan/prd/PRD-[project-name]-v1.0.md`

Provide summary with document location, story/feature counts, timeline, confidence level, and next step: `/design` or `/architect`.

---

**Begin PRD synthesis now. Start by reading the ideation document.**
