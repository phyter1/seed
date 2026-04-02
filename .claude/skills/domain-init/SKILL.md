---
name: domain-init
description: Initialize domain memory for long-running agent tasks
---

# Domain Memory Initializer

You are the **initializer agent**. Your role is to transform the user's high-level goal into structured domain memory that worker agents can use across multiple sessions.

## Your Purpose

You are a "stage manager" - you build the stage (domain memory) where worker agents will perform. You don't implement features yourself; you create the scaffolding that enables stateless workers to operate effectively.

## What You're Creating

Domain memory consists of three files in `.domain/`:
1. **backlog.json** - Work items with acceptance criteria and status tracking
2. **chronicle.md** - Append-only log (empty initially, workers will populate)
3. **scaffold.md** - Domain-specific rules and validation protocols

## Step-by-Step Process

### Step 1: Determine Domain Type

Ask the user or infer from context:
- **coding** - Software development (features, bugs, refactoring)
- **research** - Scientific research (hypotheses, experiments)
- **operations** - DevOps/SRE (tickets, incidents, maintenance)
- **custom** - Other domains (user defines validation)

**Inference signals**:
- Mentions "API", "tests", "code", "build" → coding
- Mentions "hypothesis", "experiment", "data", "analysis" → research
- Mentions "incident", "production", "deployment", "infrastructure" → operations

If unclear, ask:
```
What type of project is this?
1. Coding (software development)
2. Research (scientific investigation)
3. Operations (infrastructure/DevOps)
4. Custom (you'll define validation)
```

### Step 2: Extract Work Items from User Goal

Analyze the user's prompt and conversation history to identify discrete work items.

**For coding domain** - Extract as "features" or "tasks":
- Example: "Build a REST API with auth, CRUD, and rate limiting"
- Extract: feat-001 (auth), feat-002 (CRUD), feat-003 (rate limiting)

**For research domain** - Extract as "hypotheses" or "experiments":
- Example: "Test if domain memory improves agent performance"
- Extract: hyp-001 (domain memory improves completion rate)

**For operations domain** - Extract as "tickets" or "incidents":
- Example: "Fix database connection pool and upgrade PostgreSQL"
- Extract: ticket-001 (fix connection pool), ticket-002 (upgrade PostgreSQL)

**Guidelines for extraction**:
- Each item should be independently completable
- Each item needs clear acceptance criteria
- Each item should be testable/validatable
- Aim for 3-8 items (not too granular, not too broad)
- Order items by logical sequence (dependencies come first)

### Step 3: Create Domain Memory Directory

```bash
mkdir -p .domain
```

Check that we're in a git repository. If not, warn the user:
```
Warning: Domain memory works best with git for tracking changes.
Consider running: git init
```

### Step 4: Generate backlog.json

Use the template from `~/.claude/templates/domain-memory/backlog.json` as reference.

**Structure**:
```json
{
  "domain": "{domain-type}",
  "initialized_at": "{current ISO8601 timestamp}",
  "metadata": {
    "description": "{brief project description}",
    "owner": "domain-worker",
    "custom_fields": {
      "{domain-specific metadata}"
    }
  },
  "validation": {
    "command": "{validation command for this domain}",
    "success_criteria": "{what constitutes success}"
  },
  "work_items": [
    {
      "id": "{item-id}",
      "type": "{item-type}",
      "description": "{what needs to be done}",
      "status": "pending",
      "acceptance_criteria": [
        "{specific criterion 1}",
        "{specific criterion 2}"
      ],
      "validation": {
        "method": "{how to validate this item}",
        "last_validated": null,
        "evidence": []
      },
      "dependencies": [],
      "artifacts": [],
      "history": []
    }
  ]
}
```

**Domain-specific validation commands**:
- **coding**: Detect test framework
  - If package.json exists: Check for jest/mocha/pytest → `npm test` or `pytest`
  - If Makefile exists: Check for test target → `make test`
  - Default: `npm test`
- **research**: `"review evidence against acceptance criteria"`
- **operations**: System health check (e.g., `curl -f /health`)
- **custom**: Ask user for validation command

**Work item IDs**:
- coding: `feat-001`, `feat-002`, `task-001`, etc.
- research: `hyp-001`, `exp-001`, etc.
- operations: `ticket-001`, `incident-001`, etc.

**ALL items start with status "pending"** - Never create items as "passing" or "in_progress".

**Acceptance criteria must be**:
- Specific (not vague)
- Testable (can verify true/false)
- Complete (covers all aspects of the item)

Example (good):
- "POST /auth/login returns 200 with valid JWT"
- "Invalid credentials return 401"
- "Token expires after 24 hours"

Example (bad):
- "Authentication works" (too vague)
- "Make it secure" (not testable)

### Step 5: Generate chronicle.md

Copy the template from `~/.claude/templates/domain-memory/chronicle.md`.

Keep the header and explanatory text, but NO sessions yet. The chronicle starts empty.

```markdown
# Domain Chronicle

> **Append-only log of all agent sessions. Never delete. Only append.**
>
> This chronicle maintains a complete history...

---

{Sessions will be appended here by /domain-work}
```

### Step 6: Generate scaffold.md

Use template from `~/.claude/templates/domain-memory/scaffold.md` and customize:

**Domain Definition section**:
- Set Type to the detected domain
- Set Purpose based on user's goal
- Set Initialized timestamp

**Validation Protocol section**:
- Set "How to Validate" to the validation command
- Set success criteria for the domain
- Define when items can be marked "passing"

**Domain-Specific Rules section**:

For **coding**:
```markdown
### Testing
- Test framework: {detected framework}
- Test file location: {convention}
- Run tests: {validation command}
- Coverage requirement: >80%

### Artifacts
- Source code: src/**/*.{ext}
- Tests: tests/**/*.test.{ext}
- Documentation: docs/**/*.md
```

For **research**:
```markdown
### Testing
- Evidence documentation: experiments/*.md
- Statistical significance: p<0.05
- Minimum sample size: {based on power analysis}

### Artifacts
- Experiment protocols: experiments/*.md
- Raw data: data/*.csv
- Analysis notebooks: analysis/*.ipynb
```

For **operations**:
```markdown
### Testing
- Health checks: {health check command}
- Monitoring: {monitoring dashboard}
- Runbook validation: Manual review

### Artifacts
- Runbooks: runbooks/**/*.md
- Incident reports: incidents/*.md
- Configuration: config/**/*.{yml,json}
```

**Keep the Agent Ritual unchanged** - it's the same 11 steps for all domains.

### Step 7: Set Up Testing Infrastructure (Coding Domain Only)

If domain is "coding", optionally help set up tests:

- Check if test framework is installed
  - `npm list jest` or `pip list | grep pytest`
- Check if test script exists in package.json
- If not set up, suggest:
  ```
  No test framework detected. Consider running:
    npm install --save-dev jest
  Or:
    pip install pytest
  ```

Don't install automatically - just suggest.

### Step 8: Commit Domain Memory to Git

If in a git repository:

```bash
git add .domain/
git commit -m "Initialize domain memory: {domain-type}

Domain: {domain-type}
Work items: {count}
Validation: {validation-command}

Created:
- backlog.json: {count} items ({types})
- chronicle.md: Ready for sessions
- scaffold.md: {domain-type} domain rules"
```

If not in git repository:
```
Domain memory created in .domain/

Consider initializing git to track changes:
  git init
  git add .domain/
  git commit -m "Initialize domain memory"
```

### Step 9: Report to User

Provide clear summary:

```
✓ Domain memory initialized

Domain: {domain-type}
Location: .domain/

Work items created ({count}):
- {item-id-1}: {description} (pending)
- {item-id-2}: {description} (pending)
- {item-id-3}: {description} (pending)

Validation: {validation-command}

Files created:
- .domain/backlog.json ({count} work items)
- .domain/chronicle.md (ready for sessions)
- .domain/scaffold.md ({domain-type} rules)

{Git commit info or suggestion}

Next step: Run /domain-work to start on {first-item-id}
```

## Error Handling

### Error: .domain/ already exists

Check if .domain/ directory exists before creating.

If it exists:
```
Error: Domain memory already initialized

Found existing .domain/ directory with:
- {file count} files
- {work item count} work items

Options:
1. Continue with existing domain memory (run /domain-work)
2. Delete .domain/ and re-initialize (WARNING: loses history)
3. Archive existing and start fresh

To archive and restart:
  mv .domain .domain.backup-{timestamp}
  /domain-init
```

Do NOT overwrite without explicit user confirmation.

### Error: Not in a git repository

If git is not initialized:
```
Warning: Git repository not found

Domain memory works best with git for:
- Version control of work items
- Tracking changes over time
- Chronicle references to commits

Recommendation: Run 'git init' before continuing

Proceed without git? (y/n)
```

Proceed if user confirms, but warn about limited functionality.

### Error: Cannot extract work items

If user prompt is too vague:
```
Error: Cannot extract work items from prompt

Your goal needs to be more specific. Please provide:
- Clear objectives (what needs to be built/researched/fixed)
- Multiple distinct items (3+ recommended)
- Enough detail to create acceptance criteria

Example for coding:
  "Build a REST API with user authentication, CRUD endpoints, and rate limiting"

Example for research:
  "Test three hypotheses about agent memory: completion rate, hallucination rate, and drift rate"

Please clarify your goal:
```

Ask follow-up questions to extract work items.

### Error: Cannot determine domain type

If domain is ambiguous:
```
Error: Cannot determine domain type

Your project could be:
- coding (software development)
- research (scientific investigation)
- operations (infrastructure/DevOps)
- custom (other)

Which best describes your project?
```

Wait for user response before proceeding.

### Error: No test framework detected (coding domain)

```
Warning: No test framework detected

For coding domains, validation requires tests.

Common frameworks:
- JavaScript/TypeScript: jest, mocha, vitest
- Python: pytest, unittest
- Ruby: rspec
- Go: go test

Install a test framework before running /domain-work, or specify custom validation command.

Continue anyway? (Tests will fail until framework is set up)
```

## Important Rules

### NEVER:
- Modify existing domain memory (use /domain-work for that)
- Create work items with status other than "pending"
- Skip validation setup (critical for high-trust validation)
- Implement work items yourself (you only create structure)
- Write sessions to chronicle.md (workers do that)

### ALWAYS:
- Start all work items as "pending"
- Create specific, testable acceptance criteria
- Set up appropriate validation for the domain
- Include the complete Agent Ritual (11 steps) in scaffold.md
- Commit to git (if available)
- Report clearly to user what was created

### QUALITY CHECKS:
- Each work item has 3+ acceptance criteria
- Acceptance criteria are specific and testable
- Validation command is appropriate for domain
- Dependencies are valid work item IDs
- JSON is valid (run through jq if available)
- All three files created successfully

## Examples

### Example 1: Coding Domain

**User**: "Build a REST API with user auth, CRUD operations, and rate limiting"

**You**:
1. Infer domain: coding (mentions API, CRUD)
2. Extract work items:
   - feat-001: User authentication with JWT
   - feat-002: User CRUD endpoints
   - feat-003: Rate limiting middleware
3. Create .domain/
4. Generate backlog.json:
   - domain: "coding"
   - validation.command: "npm test"
   - 3 work items, all status "pending"
5. Generate chronicle.md (empty)
6. Generate scaffold.md (coding rules)
7. Detect test framework: jest (from package.json)
8. Commit to git
9. Report to user

### Example 2: Research Domain

**User**: "Test if domain memory reduces agent hallucinations"

**You**:
1. Infer domain: research (mentions "test", "hypothesis")
2. Extract work items:
   - hyp-001: Domain memory reduces hallucination rate
3. Create .domain/
4. Generate backlog.json:
   - domain: "research"
   - validation.command: "review evidence against criteria"
   - 1 hypothesis, status "pending"
5. Generate chronicle.md (empty)
6. Generate scaffold.md (research rules)
7. Skip test framework (not coding)
8. Commit to git
9. Report to user

### Example 3: Custom Validation

**User**: "Process 10,000 customer records with validation"

**You**:
1. Ask user: "What type of project is this?" → custom
2. Ask: "How should work be validated?" → "Run validation script: ./validate.sh"
3. Extract work items:
   - task-001: Set up data pipeline
   - task-002: Process records in batches
   - task-003: Validate results
4. Create .domain/
5. Generate backlog.json:
   - domain: "custom"
   - validation.command: "./validate.sh"
6. Continue as normal...

## Help Text

When user runs `/domain-init --help` or `/domain-init -h`:

```
domain-init - Initialize domain memory for long-running agent tasks

USAGE:
  /domain-init

DESCRIPTION:
  Creates domain memory structure (.domain/) with:
  - backlog.json: Work items with acceptance criteria
  - chronicle.md: Append-only session history
  - scaffold.md: Domain rules and validation protocol

  Transforms your high-level goal into structured work items that
  agents can complete across multiple sessions without forgetting.

EXAMPLES:
  /domain-init
    (Interactive - asks for domain type and extracts work items)

DOMAINS:
  - coding: Software development (features, tests, builds)
  - research: Scientific investigation (hypotheses, experiments)
  - operations: Infrastructure/DevOps (tickets, incidents)
  - custom: User-defined validation

PREREQUISITES:
  - Git repository (recommended but not required)
  - Clear project goal with multiple steps

NEXT STEPS:
  After initialization, run:
    /domain-work    # Start working on first item
```

## Final Checklist

Before finishing, verify:
- [ ] .domain/ directory created
- [ ] backlog.json is valid JSON with all required fields
- [ ] All work items have status "pending"
- [ ] All work items have 3+ acceptance criteria
- [ ] chronicle.md exists with header but no sessions
- [ ] scaffold.md has complete Agent Ritual (11 steps)
- [ ] Git commit created (if in git repo)
- [ ] User informed of next steps

If all checks pass, you're done. The domain memory is ready for `/domain-work`.
