# Domain Scaffolding

> **Rules of engagement for agents working in this domain**
>
> This document defines how agents should operate in this domain, including validation protocols,
> the mandatory bootup ritual, and domain-specific quality standards.

## Domain Definition

**Type**: {coding|research|operations|custom}
**Purpose**: {Brief description of what this domain memory system is for}
**Initialized**: {ISO8601 timestamp}

## Validation Protocol

### How to Validate

```bash
{command to run validation - e.g., npm test, pytest, make test, etc.}
```

For non-code domains:
```
{description of validation process - e.g., "review evidence against hypothesis criteria"}
```

### Success Criteria

A work item is considered "passing" when:
- Criterion 1 (specific to domain)
- Criterion 2 (specific to domain)
- Criterion 3 (specific to domain)

### When to Mark Items as "Passing"

A work item can ONLY be marked as "passing" when:

1. **All acceptance criteria are met** - No exceptions
2. **Validation succeeds** - The validation command/process completes successfully
3. **Evidence is recorded** - Proof of validation is captured in the work item
4. **Changes are committed** - Work is persisted in version control (if applicable)

Never mark an item as "passing" based on assumptions or partial completion.

## Agent Ritual (Bootup Protocol)

Every agent session MUST follow this exact sequence:

### 1. Ground: Read Chronicle
```bash
Read .domain/chronicle.md
```
Focus on the last 3-5 sessions minimum. Understand:
- What was done recently
- What failed and why
- What's currently blocked
- Important context or warnings
- Patterns of what works vs what doesn't

### 2. Orient: Read Backlog
```bash
Read .domain/backlog.json
```
Review ALL work items. Note:
- Which items are pending (ready to start)
- Which items are failing (need retry)
- Which items are blocked (need external help)
- Which items are passing (completed - skip these)
- Which items are in progress (another agent working on them)

### 3. Check: Review Artifacts
For items that have been worked on:
- Read files listed in the `artifacts` array
- Check if dependencies are satisfied
- Look for blockers mentioned in chronicle
- Understand existing code/work patterns

### 4. Select: Pick ONE Work Item
Selection priority (in order):
1. If user specified work-item-id explicitly, use that
2. Else, pick first "failing" item (retry failed work)
3. Else, pick first "pending" item with satisfied dependencies
4. Never pick "blocked" items (they need external unblocking)
5. Never pick "passing" items (already complete)
6. Never pick "in_progress" items (another agent is working on it)

Update selected item status to "in_progress" in backlog.json.

### 5. Plan: Determine Approach
Based on:
- Acceptance criteria for the work item
- Domain scaffolding rules (this document)
- Existing codebase/work patterns (from artifacts review)
- Chronicle notes about what's worked before and what hasn't
- Dependencies and their current state

Create a mental plan (or write notes if complex). Do not proceed until approach is clear.

### 6. Execute: Implement
- Create or modify files as needed
- Follow quality standards from this scaffold
- Follow patterns from existing code/work (maintain consistency)
- Record all files created/modified for the artifacts array
- Work incrementally and test as you go

### 7. Validate: Run Validation
Get validation command/process from:
- Domain-level validation in backlog.json
- OR work-item-specific validation method

Run validation and capture output.

Determine result:
- **Passing**: All acceptance criteria met, validation succeeds
- **Failing**: Tests fail, criteria not met, errors encountered
- **Blocked**: External dependency missing, cannot proceed

### 8. Update: Update Backlog Status
Edit `.domain/backlog.json`:

Update the work item with:
- New status (passing/failing/blocked)
- Validation timestamp (now)
- Evidence array (test output, error messages, etc.)
- Artifacts array (files created/modified)
- History entry (status change with notes)

Be honest - never claim "passing" unless validation proves it.

### 9. Chronicle: Append Session
Append a complete session entry to `.domain/chronicle.md`:

Include all sections:
- Session ID and timestamp
- Work item and objective
- Actions taken
- Validation results with evidence
- State changes
- Artifacts created/modified/deleted
- Commits (if any)
- Notes (context, learnings, blockers)
- Next steps

Never modify existing chronicle entries - only append.

### 10. Commit: Commit Changes
If status is "passing":
```bash
git add {modified files}
git commit -m "{work-item-id}: {description}

Acceptance criteria:
- {criterion 1}
- {criterion 2}

Validation: passing
{additional context if needed}"
```

If status is "failing" or "blocked":
- DO NOT commit implementation code (it's incomplete)
- Only commit backlog.json and chronicle.md updates
- Implementation code should only be committed when passing

### 11. Exit: Report to User
Provide a clear summary:
- Work item ID and description
- Status (passing/failing/blocked)
- What was accomplished
- What's next (or what's blocking)

Then end the session cleanly. Do not retain conversational memory.

## Domain-Specific Rules

### Testing
{How to test in this domain - framework, conventions, coverage requirements}

Example (coding):
- Test framework: Jest
- Test file location: `tests/**/*.test.js`
- Coverage requirement: >80%
- Run tests: `npm test`

Example (research):
- Evidence documentation: `experiments/*.md`
- Statistical significance: p<0.05
- Minimum sample size: 20 trials per condition

### Artifacts
{What types of artifacts should be created and maintained}

Example (coding):
- Source code: `src/**/*.ts`
- Tests: `tests/**/*.test.ts`
- Documentation: `docs/**/*.md`

Example (operations):
- Runbooks: `runbooks/**/*.md`
- Incident reports: `incidents/*.md`
- Configuration: `config/**/*.yml`

### Dependencies
{How to handle dependencies between work items}

- Check dependencies array before starting work
- Only work on items whose dependencies have status "passing"
- If dependency is failing/blocked, skip this item
- Document dependency issues in chronicle notes

### Blocked Items
{What to do when encountering blockers}

When you cannot complete a work item due to external factors:

1. Mark status as "blocked" (never leave as "in_progress")
2. Document the blocker clearly in validation.evidence
3. Add detailed notes in chronicle explaining:
   - What specifically is blocking
   - What needs to happen to unblock
   - Who/what can resolve it
4. DO NOT commit incomplete implementation code
5. Move to next available work item if any

## Quality Standards

{Domain-specific quality requirements}

Example standards for coding:
- Code style: Follow project linting rules
- Type safety: TypeScript strict mode
- Documentation: Public APIs must have JSDoc comments
- Error handling: All async operations must handle errors
- Security: No hardcoded secrets or credentials

Example standards for research:
- Reproducibility: All experiments must be reproducible
- Data integrity: Raw data never modified, only copied
- Statistical rigor: All claims backed by statistical tests
- Documentation: Methods section must be complete

Example standards for operations:
- Safety: Always test in staging before production
- Reversibility: All changes must be reversible
- Documentation: All runbooks must be up to date
- Monitoring: All changes must update monitoring

## Constraints

{Hard constraints that must never be violated}

Example constraints:
- Never commit failing tests
- Never skip validation before marking "passing"
- Never modify chronicle history (append only)
- Never work on multiple items in one session
- Never mark blocked items as passing without resolving blockers
- Never commit secrets or credentials
- Never delete production data
- Never bypass security controls

## Success Patterns

{Patterns that have worked well in this domain}

Based on chronicle history, these patterns lead to success:
- {Pattern 1 - e.g., "Write tests before implementation"}
- {Pattern 2 - e.g., "Read similar code before starting"}
- {Pattern 3 - e.g., "Validate incrementally, not just at the end"}

## Failure Patterns

{Patterns that have led to failures}

Based on chronicle history, avoid these patterns:
- {Anti-pattern 1 - e.g., "Implementing without reading existing code"}
- {Anti-pattern 2 - e.g., "Assuming tests pass without running them"}
- {Anti-pattern 3 - e.g., "Working on dependent items before dependencies complete"}
