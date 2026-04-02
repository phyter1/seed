---
allowed-tools: TodoWrite, Read, Write, Edit, Glob, Grep, Task, Bash
argument-hint: [task-manifest-file-path]
description: Autonomous task development pipeline with iterative testing until acceptance criteria met
---

[[ultrathink]]

# Task Loop Development Pipeline

**Autonomous task development with docs-research → test-criteria → context → develop → lint → review pipeline**

**Task Manifest**: `$ARGUMENTS` (JSON format - see [Task Protocol](../protocols/task.md))

## Pipeline Orchestration

**Autonomous task-driven development with iterative validation:**
- Complete development pipeline for individual tasks or collections
- Agent coordination: docs-researcher, task-test-criteria, task-context, task-developer, task-lint, task-code-review
- Iterative testing until ALL acceptance tests pass
- Automated git branch management, commits, and push
- Intelligent retry logic with context preservation
- Real-time progress tracking

## Task Input Processing

**Input Type Detection**:
- **Single File**: `task.json` - Process individual task
- **Directory**: `./tasks/` - Find all `*.json` files
- **Pattern**: `tasks/*.json` - Glob pattern matching
- **Task Collection**: Array of task objects in JSON format

**Task Structure** (per [Task Protocol](../protocols/task.md)):
```json
[
  {
    "content": "task-001.md",
    "test_criteria": "task-001-tests.md", 
    "context": "task-001-context.md",
    "status": "pending|in_progress|completed",
    "priority": "high|medium|low",
    "id": "task-001",
    "dependencies": ["prerequisite-task-id"],
    "tags": ["frontend", "api"],
    "estimated_hours": 2.5,
    "can_parallelize": true,
    "resource_conflicts": ["src/components/", "src/types/"]
  }
]
```

## Progress Tracking

**Simple manifest-based progress tracking using existing task structure:**
- Update task `status` field directly in manifest file
- Progress values: `"Not Started" | "Documentation" | "Test Planning" | "Context Gathering" | "Development" | "Linting" | "Code Review" | "Complete" | "Failed"`

## Development Pipeline Process

### 1. Task Analysis and Planning
- Parse task manifest file: `$ARGUMENTS`
- Identify task dependencies and parallel execution opportunities  
- Create execution plan with dependency resolution
- Update task status: `"Not Started"` → `"Documentation"`

### 2. Documentation Research  
- Launch `docs-researcher` agent for technology/framework research
- Create/update global knowledge base documentation in `~/.claude/docs/`
- Update task status: `"Documentation"` → `"Test Planning"`

### 3. Test Criteria Definition
- Launch `task-test-criteria` agent with documentation context
- Create comprehensive test specifications and acceptance criteria
- Output: `task-{id}-tests.md` file
- Update task status: `"Test Planning"` → `"Context Gathering"`

### 4. Implementation Context Creation
- Launch `task-context` agent for codebase analysis  
- Create implementation guidance and integration templates
- Output: `task-{id}-context.md` file
- Update task status: `"Context Gathering"` → `"Development"`

### 5. Development and Implementation
- Launch `task-developer` agent with full context (docs, tests, implementation guidance)
- Implement using TDD approach with comprehensive testing
- Create git commit with conventional format
- Update task status: `"Development"` → `"Linting"`

### 6. Code Quality Validation
- Launch `task-lint` agent for code quality checks and auto-fixes
- Run linting scripts from package.json, apply automatic formatting
- **Retry Logic**: Up to 3 attempts, user guidance requested if max exceeded  
- Update task status: `"Linting"` → `"Code Review"`

### 7. Code Review and Final Validation
- Launch `task-code-review` agent for comprehensive quality assessment
- Validate implementation against task requirements and test criteria  
- **Retry Logic**: Re-invoke task-developer with review feedback if NEEDS_REVISION
- Update task status: `"Code Review"` → `"Complete"` or `"Failed"`

## Iterative Validation and Retry Logic

**Quality Gates:**
- All linting must pass or be auto-fixed
- All tests must pass (>90% coverage target)
- Code review must return APPROVED status
- Each stage has 3-attempt limit with user guidance on failure

**Error Handling:**
- **Linting Failures**: Re-invoke task-developer with linting error context
- **Test Failures**: Re-invoke task-developer with test failure analysis
- **Review Failures**: Re-invoke task-developer with specific improvement guidance
- **User Guidance**: Interactive prompts when max attempts reached

**Parallel Execution:**
- Tasks with no dependencies execute concurrently in Wave 1
- Dependent tasks execute in subsequent waves after prerequisites complete
- Resource conflicts force sequential execution within groups
- Branch isolation prevents merge conflicts during parallel development

## Git Integration and Completion

**Branch Management:**
- Create feature branch for task implementation
- Automated commit creation with conventional format
- Push branch to remote repository with upstream tracking

**Final Validation:**
- Verify all tasks completed successfully
- Confirm all acceptance tests passing
- Run final integration test suite
- Generate completion summary with branch and PR information

## Usage Examples

**Single Task:**
```bash
task-loop task.json
```

**Task Collection:**
```bash  
task-loop tasks.json
```

**Directory Processing:**
```bash
task-loop ./tasks/
```

**Pattern Matching:**
```bash
task-loop tasks/*.json
```

## Expected Task Structure

```json
[
  {
    "content": "implement-auth.md",
    "test_criteria": "auth-tests.md",
    "context": "auth-context.md", 
    "status": "pending",
    "priority": "high",
    "id": "auth-001",
    "dependencies": [],
    "tags": ["frontend", "auth"],
    "estimated_hours": 3,
    "can_parallelize": true,
    "resource_conflicts": ["src/auth/", "src/types/user.ts"]
  }
]
```

---

**Task loop orchestrator ready for autonomous development pipeline execution**