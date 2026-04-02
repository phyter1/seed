---
name: breakdown
description: Break architecture into implementable issues and atomic tasks with dependencies and parallelization opportunities. Use this skill when architecture is complete and implementation is ready to begin, when you need to create a work breakdown structure, or when planning sprints.
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, AskUserQuestion, Task
argument-hint: [path-to-architecture-doc]
user-invocable: true
---

# Architecture to Task Breakdown

**Input**: `$ARGUMENTS` (path to architecture document)
**Output**: MANIFEST.md, issues/, and tasks/

## Process Overview

```
Architecture → Features → Issues → Tasks → MANIFEST
      ↓           ↓         ↓        ↓         ↓
   Read        Extract   Create   Break    Generate
   doc         features  issues   down     manifest
```

## Step 1: Feature Extraction

Read the architecture and identify implementable features:
- Core features (MVP)
- Supporting features
- Infrastructure requirements
- Integration points

## Step 2: Issue Creation

For each feature, create an issue at `plan/issues/ISSUE-XXX.md`:

### Issue Format
```markdown
# Issue: [ISSUE-XXX] [Title]

**Feature**: [Feature name]
**Priority**: P0 (Must Have) | P1 (Should Have) | P2 (Nice to Have)
**Status**: Open

## Summary
[2-3 sentences describing what this delivers]

## User Story
As a [persona], I want to [action], so that [benefit].

## Acceptance Criteria
- [ ] [Criterion 1]
- [ ] [Criterion 2]

## Technical Scope
[Components, APIs, data changes]

## Dependencies
**Depends On**: [Issue IDs]
**Blocks**: [Issue IDs]

## Tasks
[List of TASK-XXX references]
```

## Step 3: Task Breakdown

For each issue, create atomic tasks at `plan/tasks/TASK-XXX.md`:

### Task Constraints
- **1-4 hours** of work maximum
- **Independently implementable**
- **Testable** with clear criteria
- **Specific files** to modify identified

### Task Format
```markdown
# Task: [TASK-XXX] [Title]

**Issue**: [ISSUE-XXX]
**Priority**: P0 | P1 | P2
**Estimate**: [hours]

## Summary
[One sentence]

## Context
**Why**: [Link to requirement]
**Dependencies**: [Tasks that must complete first]
**Blocks**: [Tasks waiting on this]

## Acceptance Criteria
- [ ] [Specific criterion 1]
- [ ] [Specific criterion 2]

## Technical Details
### Files to Modify
| File | Action | Description |
|------|--------|-------------|
| path/to/file | Create/Modify | [What to do] |

## Test Requirements
- [ ] [Unit test]
- [ ] [Integration test]

## Definition of Done
- [ ] Code written following conventions
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] No lint/type errors
```

## Step 4: Dependency Analysis

Map dependencies between tasks:
- What blocks what?
- What can run in parallel?
- What's on the critical path?

## Step 5: Generate MANIFEST

Create `plan/MANIFEST.md`:

```markdown
# Implementation Manifest

## Overview
| Metric | Count |
|--------|-------|
| Total Issues | [n] |
| Total Tasks | [n] |
| P0 (Must Have) | [n] |

## Phases
### Phase 1: Foundation
[Issues and tasks for foundation]

### Phase 2: Core Features
[Issues and tasks for core]

### Phase 3: Polish
[Issues and tasks for polish]

## Dependency Graph
[ASCII visualization]

## Issue Index
[Table with links]

## Task Index
[Table with links]

## Critical Path
[Tasks that block the most]

## Parallelization Opportunities
[Tasks that can run concurrently]
```

## Quality Checklist

- [ ] All features have issues
- [ ] All issues have tasks
- [ ] All tasks are 1-4 hours
- [ ] All tasks have acceptance criteria
- [ ] Dependencies are explicit
- [ ] Critical path identified
- [ ] Parallel opportunities noted

---

**Begin breakdown. Start by reading the architecture document.**
