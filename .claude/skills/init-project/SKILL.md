---
name: init-project
description: Initialize a SmarterWiggum project by creating PRD, MANIFEST, issues, tasks, and custom work prompt based on user requirements
user-invocable: true
---

# Initialize SmarterWiggum Project

This skill guides you through creating a complete SmarterWiggum project structure including PRD, issues, tasks, and custom work prompt.

## What This Does

1. Gathers requirements from user through interactive questions
2. Creates a Product Requirements Document (PRD)
3. Generates MANIFEST.json with issues
4. Creates issue files with JSON frontmatter and detailed tasks
5. Generates custom work prompt tailored to the project
6. Stores prompts in `.claude/smarter-wiggum/`

## Process

### Step 1: Gather Requirements

Ask the user these questions (use AskUserQuestion tool):

1. **Project Type**
   - Web Application (Frontend + Backend)
   - Backend API
   - CLI Tool
   - Library/SDK
   - Mobile App
   - Other

2. **Primary Goal**
   - What is the main objective of this project?
   - What problem does it solve?

3. **Key Features** (multiselect)
   - List 5-8 major features the project should have

4. **Tech Stack Preferences**
   - Programming language(s)
   - Frameworks/libraries
   - Any specific technologies required?

5. **Quality Requirements**
   - Test coverage target (e.g., >80%)
   - Documentation requirements
   - Performance targets
   - Security requirements

6. **Timeline & Scope**
   - Small (1-2 weeks, <10 tasks)
   - Medium (2-4 weeks, 10-30 tasks)
   - Large (1-3 months, 30+ tasks)

### Step 2: Create PRD

Generate `PRD.md` in project root with:

```markdown
# Product Requirements Document: [Project Name]

## Overview
[Project description and goals]

## Objectives
1. [Primary objective]
2. [Secondary objectives]

## Target Users
[Who will use this?]

## Features

### Core Features (Must-Have)
1. **[Feature Name]**
   - Description
   - User stories
   - Acceptance criteria

### Advanced Features (Nice-to-Have)
1. **[Feature Name]**
   - Description

## Technical Requirements

### Tech Stack
- Language: [Language]
- Framework: [Framework]
- Database: [If applicable]
- Infrastructure: [Deployment targets]

### Non-Functional Requirements
- Performance: [Targets]
- Security: [Requirements]
- Scalability: [Considerations]
- Testing: [Coverage and strategy]

## Success Criteria
1. [Measurable criterion 1]
2. [Measurable criterion 2]

## Out of Scope
- [What this project will NOT do]

## Timeline
- Estimated Duration: [X weeks]
- Major Milestones: [Key dates]
```

### Step 3: Break Down into Issues

Analyze the PRD and create 3-6 issues (high-level features/epics):

**Issue Breakdown Pattern:**
1. **Setup/Infrastructure** (always first)
   - Project initialization
   - Build tooling
   - CI/CD
   - Development environment

2. **Core Functionality** (1-3 issues)
   - Group related features
   - 5-10 tasks per issue

3. **Advanced Features** (optional, 0-2 issues)
   - Nice-to-have features
   - Enhancements

4. **Testing & Documentation** (always last)
   - Comprehensive testing
   - Documentation
   - Production readiness

### Step 4: Create MANIFEST.json

Use the template at `~/.claude/skills/init-project/templates/MANIFEST.json.template`.

```json
{
  "project": "[Project Name]",
  "created": "[Timestamp]",
  "updated": "[Timestamp]",
  "currentIssue": "001",
  "totalIssues": [N],
  "completedIssues": 0,
  "github": {
    "enabled": false,
    "repo": ""
  },
  "issues": {
    "001": {
      "title": "[Issue Title]",
      "status": "NOT_STARTED",
      "file": "issues/001-[slug].md",
      "priority": "MEDIUM",
      "started": null,
      "completed": null,
      "totalTasks": [N],
      "completedTasks": 0,
      "currentTask": 1,
      "dependsOn": [],
      "blocks": [],
      "github": {
        "number": null,
        "url": null
      }
    }
  }
}
```

### Step 5: Create Issue Files

Use the template at `~/.claude/skills/init-project/templates/issue-json.template.md`.

For each issue, create `issues/XXX-slug.md` with JSON frontmatter:

```markdown
---json
{
  "id": "XXX",
  "title": "[Title]",
  "status": "NOT_STARTED",
  "priority": "MEDIUM",
  "currentTask": 1,
  "totalTasks": [N],
  "completedTasks": 0,
  "started": null,
  "completed": null,
  "dependsOn": [],
  "blocks": [],
  "github": {
    "number": null,
    "url": null
  }
}
---

# Issue XXX: [Title]

## Description
[Detailed description of what this issue accomplishes]

## Tasks

- [ ] [Specific, actionable task 1]
- [ ] [Specific, actionable task 2]
- [ ] [Specific, actionable task 3]
[... 5-10 tasks total ...]

## Guardrails
- Security: [Security requirements specific to this issue]
- Performance: [Performance targets]
- Code Quality: [Quality standards - linting, typing, etc.]

## Constitutional Requirements
- Testing: [Testing requirements for this issue]
- Documentation: [Documentation requirements]
- Error Handling: [Error handling requirements]

## Success Criteria
1. All tasks checked off
2. [Specific verification criterion]
3. [Specific verification criterion]
4. [Measurable quality metric]

## Verification Commands
\`\`\`bash
# Commands to verify this issue is complete
[test commands]
[lint commands]
[build commands]
\`\`\`

## Notes
<!-- Auto-generated notes from SmarterWiggum will appear here -->
```

### Step 6: Generate Custom Work Prompt

Create `.claude/smarter-wiggum/work-prompt.md` tailored to the project:

```markdown
# Custom Work Prompt for [Project Name]

You are working on **[Project Name]** - [brief description].

## Project Context

**Type:** [Project Type]
**Tech Stack:** [Technologies]
**Goal:** [Primary goal]

## Your Role

You are implementing tasks from the SmarterWiggum issue/task hierarchy. Each work session focuses on completing ONE task from the current issue.

## Task Execution Guidelines

### 1. Understand Context
- Read MANIFEST.md to see the overall project structure
- Read the current issue file to understand the feature being built
- Review PROGRESS.md to see what's been done
- Check the current task number

### 2. Implementation Standards

**Code Quality:**
- [Language]-specific best practices
- [Framework] conventions and patterns
- Type safety: [strict typing requirements]
- Linting: Must pass [linter] with [config]
- Formatting: Use [formatter] with [config]

**Testing:**
- Test coverage: >[X]%
- Testing framework: [framework]
- Test types: [unit/integration/e2e]
- Every function must have tests
- Edge cases must be covered

**Security:**
- Input validation: [specific requirements]
- Authentication: [auth strategy]
- Authorization: [authz strategy]
- Data sanitization: [requirements]
- Secrets management: [strategy]
- OWASP Top 10 awareness

**Performance:**
- [Specific performance targets]
- [Profiling requirements]
- [Optimization guidelines]

**Documentation:**
- [Documentation format - JSDoc, etc.]
- All public APIs documented
- Complex logic explained
- README updated as needed

### 3. Task Completion Workflow

1. **Read** the current task carefully
2. **Plan** your implementation approach
3. **Implement** the task fully
4. **Test** your implementation
5. **Verify** it meets all requirements
6. **Document** what you did (code comments, README updates)
7. **Commit** with clear message following [commit convention]
8. **Exit** - let Progress Phase verify

### 4. File Structure

Your code should follow this structure:
\`\`\`
[Project-specific file structure]
\`\`\`

### 5. Common Patterns

**[Pattern 1 Name]:**
\`\`\`[language]
[Code example]
\`\`\`

**[Pattern 2 Name]:**
\`\`\`[language]
[Code example]
\`\`\`

### 6. Tools & Commands

**Development:**
\`\`\`bash
[dev commands]
\`\`\`

**Testing:**
\`\`\`bash
[test commands]
\`\`\`

**Building:**
\`\`\`bash
[build commands]
\`\`\`

## Constitutional Requirements (Non-Negotiable)

1. **Never skip tests** - All code must have tests
2. **Never ignore linting** - Fix all lint errors
3. **Never hardcode secrets** - Use environment variables
4. **Never commit broken code** - Verify before committing
5. **Never skip error handling** - Handle all error cases
6. **Never use `any` types** - [if TypeScript]
7. **Never ignore security** - Validate all inputs

## Danger Zones (Extra Caution Required)

- [Project-specific areas requiring extra care]
- [Common pitfalls to avoid]
- [Integration points that need careful handling]

## Resources

- PRD: See PRD.md in project root
- Tech Docs: [Links to framework/library docs]
- Architecture: [Links to architecture docs if any]

## Current Task Instructions

**READ THESE FILES FIRST:**
1. MANIFEST.json - Master issue list
2. {CURRENT_ISSUE_FILE} - Current issue and tasks
3. PROGRESS.md - What's been done

**YOUR TASK:**
Implement Task #{CURRENT_TASK_NUMBER} from the current issue.

**FOCUS:**
- ONE task only
- Complete it fully
- Test it thoroughly
- Exit when done

**DO NOT:**
- Work on multiple tasks
- Mark tasks complete (Progress Phase does that)
- Skip tests or linting
- Commit broken code

Begin working now.
```

### Step 7: Create Generic Progress Prompt

Create `.claude/smarter-wiggum/progress-prompt.md`:

```markdown
# Progress Verification Prompt

You are verifying that work was completed correctly in the SmarterWiggum loop.

## Your Role

Independent verification - did the Work Phase actually complete what it said it did?

## Verification Process

### 1. Gather Evidence

**Git History:**
\`\`\`bash
git log -3 --oneline
git diff HEAD~1 HEAD --stat
\`\`\`

**Changed Files:**
\`\`\`bash
git status --short
\`\`\`

**Tests:**
\`\`\`bash
[Run test commands from issue]
\`\`\`

### 2. Verify Task Completion

Read the current task from {CURRENT_ISSUE_FILE}.

Check:
- ✓ Was the task actually implemented?
- ✓ Does the code match the task requirements?
- ✓ Are there tests for the new code?
- ✓ Do all tests pass?
- ✓ Does linting pass?
- ✓ Is there proper documentation?
- ✓ Are there any obvious bugs or issues?

### 3. Update Progress Log

Add entry to PROGRESS.md:

\`\`\`markdown
#### Iteration {ITERATION} - Issue {ISSUE_ID}, Task {TASK_NUMBER}
Timestamp: {TIMESTAMP}
Task: [Task description]
Status: COMPLETE | INCOMPLETE
Files Changed: [list]
Tests: PASSING | FAILING
Verification: [summary]
\`\`\`

### 4. Update Issue File

The script handles JSON updates automatically. Just verify the task checkbox:
- Change `- [ ]` to `- [x]` for this task

The script will automatically update the JSON frontmatter with:
- Incremented `completedTasks` count
- Updated `currentTask` to next uncompleted task number

### 5. Determine Next Action

Count unchecked tasks in issue file.

**If ALL tasks are [x]:**
- Update issue status to COMPLETE (script handles JSON)
- Update MANIFEST.json issue status to COMPLETE (script handles this)
- Output: `PROGRESS_RESULT: ISSUE_COMPLETE`

**If unchecked tasks remain:**
- Output: `PROGRESS_RESULT: CONTINUE_TASK_N`
  where N = next unchecked task number

## Output Format

YOU MUST END WITH ONE OF THESE EXACT LINES:
- `PROGRESS_RESULT: ISSUE_COMPLETE`
- `PROGRESS_RESULT: CONTINUE_TASK_N` (where N is task number)

Be strict - only mark complete if truly done.
```

### Step 8: Create Generic Audit Prompt

Create `.claude/smarter-wiggum/audit-prompt.md`:

```markdown
# Comprehensive Audit Prompt

You are performing final verification of ALL work in the SmarterWiggum project.

## Your Role

Quality gate - verify EVERYTHING is complete and correct before declaring victory.

## Audit Process

### 1. Verify All Issues

Read MANIFEST.json.

For EACH issue marked COMPLETE:
1. Read the issue file
2. Verify ALL tasks are checked [x]
3. Run all verification commands
4. Check all success criteria met

### 2. Run All Tests

\`\`\`bash
# Run complete test suite
[test commands from PRD/manifest]

# Check coverage
[coverage commands]

# Verify coverage meets target
\`\`\`

### 3. Check Code Quality

\`\`\`bash
# Linting
[lint commands]

# Type checking
[type check commands]

# Build
[build commands]
\`\`\`

### 4. Verify Success Criteria

From MANIFEST.json and PRD.md:
- [ ] All issues marked COMPLETE
- [ ] All tests passing
- [ ] Coverage meets target (>[X]%)
- [ ] Linting passes
- [ ] Build succeeds
- [ ] Documentation complete
- [ ] [Project-specific criteria]

### 5. Security Check

\`\`\`bash
# Check for vulnerabilities
npm audit  # or equivalent

# Check for secrets in code
git grep -i "api_key\|password\|secret"
\`\`\`

### 6. Spot Check Quality

Review a sample of the code:
- Are patterns consistent?
- Is error handling proper?
- Are edge cases covered?
- Is documentation accurate?

## Decision

**COMPLETE** if:
- ALL issues verified complete
- ALL tests passing
- ALL verification commands pass
- ALL success criteria met
- Code quality is high
- No security issues found

**INCOMPLETE** if:
- Any issue has incomplete work
- Tests failing
- Quality issues found
- Success criteria not met

Specify exactly what's missing and update issue files.

**BLOCKED** if:
- External dependency missing
- Human decision needed
- Blocker preventing completion

Document blocker in PROGRESS.md.

## Output Format

YOU MUST END WITH ONE OF THESE EXACT LINES:
- `AUDIT_RESULT: COMPLETE`
- `AUDIT_RESULT: INCOMPLETE`
- `AUDIT_RESULT: BLOCKED`

If INCOMPLETE, update issue files with specific missing work.
If BLOCKED, document in PROGRESS.md.
```

## Task Specificity Guidelines

When creating tasks, be SPECIFIC:

### ✅ Good Tasks
- "Create User model with email, passwordHash, createdAt fields and validation"
- "Implement POST /api/login endpoint that accepts email/password and returns JWT"
- "Add bcrypt password hashing with 12 rounds to auth service"
- "Write unit tests for User model validation (>90% coverage)"

### ❌ Vague Tasks
- "Create models"
- "Add authentication"
- "Make it secure"
- "Write tests"

## Output Summary

After creating everything, provide a summary:

\`\`\`markdown
# Project Initialized Successfully

Created:
- PRD.md
- MANIFEST.json with [N] issues
- [N] issue files in issues/ (JSON frontmatter format)
- Custom work prompt in .claude/smarter-wiggum/work-prompt.md
- Generic progress prompt in .claude/smarter-wiggum/progress-prompt.md
- Generic audit prompt in .claude/smarter-wiggum/audit-prompt.md

Next steps:
1. Review PRD.md and make any adjustments
2. Review MANIFEST.json and issue files
3. Run: smarter-wiggum

Total tasks to complete: [N]
\`\`\`

## Examples

Use the example in `~/code/smarter-wiggum/examples/todo-cli/` as a reference for structure and quality.
