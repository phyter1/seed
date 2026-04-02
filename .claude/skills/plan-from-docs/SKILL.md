---
name: plan-from-docs
description: Analyze documentation/codebase in parallel and generate SmarterWiggum manifest/tasks that follow discovered patterns and constraints
user-invocable: true
---

# Plan From Docs

This skill reads existing documentation/codebase, discovers patterns and constraints, then generates a SmarterWiggum manifest and tasks that implement your requirements following the discovered architecture.

## What This Does

1. Asks for docs directory and what you want to implement
2. Spawns **parallel agents** to analyze docs
3. Discovers:
   - Architecture patterns
   - Code conventions
   - Tech stack
   - Constraints
   - Existing patterns to follow
4. Generates contextually-aware manifest/issues/tasks
5. Creates custom work prompt that references docs and patterns

## Process

### Step 1: Gather Requirements

Ask the user (use AskUserQuestion):

**Question 1: Documentation Directory**
- Header: "Docs Location"
- Question: "Where are your docs/codebase to analyze?"
- Options:
  - `./docs/` (Recommended - Documentation directory)
  - `./` (Current directory - entire codebase)
  - `./src/` (Source code only)
  - Custom path

**Question 2: What to Implement**
- Free text input
- "What do you want to implement? Be specific about features/functionality."

**Question 3: Analysis Depth**
- Header: "Depth"
- Question: "How thorough should the analysis be?"
- Options:
  - Quick (5-10 files, basic patterns)
  - Medium (20-30 files, comprehensive) (Recommended)
  - Deep (50+ files, exhaustive)

### Step 2: Parallel Doc Analysis

Use the Task tool to spawn **parallel Explore agents** to analyze docs.

**Strategy**: Divide and conquer
1. List all files in docs directory
2. Group files by category:
   - Architecture docs (architecture.md, design.md, etc.)
   - API/Interface docs (api.md, swagger.yml, etc.)
   - Code patterns (examples/, patterns/, etc.)
   - Configuration (package.json, tsconfig.json, etc.)
   - Tests (*.test.*, spec.*, etc.)
3. Spawn one agent per category (parallel execution)

**Agent Instructions**:
```markdown
You are analyzing {CATEGORY} documentation.

READ AND ANALYZE:
{FILE_LIST}

EXTRACT:
1. **Architecture Patterns**
   - File structure conventions
   - Module organization
   - Dependency patterns
   - Design patterns used

2. **Code Conventions**
   - Naming conventions (files, functions, variables)
   - TypeScript/type usage
   - Testing patterns
   - Error handling patterns
   - Documentation standards

3. **Tech Stack**
   - Languages and versions
   - Frameworks and libraries
   - Build tools
   - Testing frameworks

4. **Constraints & Requirements**
   - Performance requirements
   - Security requirements
   - Compatibility requirements
   - Code quality standards

5. **Example Patterns**
   - How features are implemented
   - Common code snippets
   - Configuration examples

OUTPUT FORMAT:
Return structured JSON:
{
  "category": "{CATEGORY}",
  "architecture": {
    "patterns": ["pattern1", "pattern2"],
    "structure": "description",
    "dependencies": ["dep1", "dep2"]
  },
  "conventions": {
    "naming": "description",
    "types": "description",
    "testing": "description",
    "errors": "description"
  },
  "techStack": {
    "languages": ["lang1"],
    "frameworks": ["framework1"],
    "tools": ["tool1"]
  },
  "constraints": {
    "performance": "requirements",
    "security": "requirements",
    "quality": "standards"
  },
  "examples": [
    {
      "pattern": "description",
      "code": "example snippet",
      "file": "source file"
    }
  ]
}
```

**Spawn agents in parallel**:
```markdown
Launch parallel analysis agents using the Task tool:

- Agent 1: Architecture docs
- Agent 2: API/Interface docs
- Agent 3: Code patterns/examples
- Agent 4: Configuration files
- Agent 5: Test files

Use Task tool with:
- subagent_type: "Explore"
- description: "Analyze {category} docs"
- prompt: {agent instructions above}

Wait for all agents to complete.
```

### Step 3: Synthesize Understanding

Once all parallel agents complete:

1. **Collect Results**: Gather JSON from all agents
2. **Merge Understanding**: Combine insights
3. **Identify Key Patterns**: Extract most important patterns
4. **Map to Requirements**: How do patterns apply to user's implementation request?

**Synthesis Output**:
```markdown
# Documentation Analysis Summary

## Tech Stack
- Languages: {discovered}
- Frameworks: {discovered}
- Tools: {discovered}

## Architecture
- Pattern: {e.g., "Microservices", "MVC", "Clean Architecture"}
- Structure: {file/module organization}
- Key Principles: {discovered principles}

## Code Conventions
- File Naming: {pattern}
- Function Naming: {pattern}
- Type Usage: {pattern}
- Testing: {pattern}
- Error Handling: {pattern}

## Constraints
- Performance: {requirements}
- Security: {requirements}
- Quality: {standards}

## Example Patterns
1. **{Pattern Name}**
   - Used for: {purpose}
   - Example: {code snippet}
   - Files: {references}

## Recommended Approach
Based on docs analysis, to implement "{user's request}", follow:
1. {Step matching discovered patterns}
2. {Step matching discovered patterns}
3. {Step matching discovered patterns}
```

### Step 4: Generate PRD

Create `PRD.md` that references discovered docs:

```markdown
# Product Requirements Document: {Implementation Name}

## Context

This implementation is based on analysis of existing documentation in `{docs_dir}`.

### Discovered Architecture
{Summary from synthesis}

### Discovered Tech Stack
{Summary from synthesis}

### Discovered Patterns
{Key patterns to follow}

## Objective
{User's implementation request}

## Requirements

### Must Follow Existing Patterns
1. **Architecture**: {discovered pattern} - See {doc reference}
2. **Naming**: {discovered convention} - See {doc reference}
3. **Testing**: {discovered pattern} - See {doc reference}
4. **Error Handling**: {discovered pattern} - See {doc reference}

### Functional Requirements
{Break down user's request}

### Non-Functional Requirements
{From discovered constraints}

## Implementation Strategy

Based on {docs_dir} analysis:
1. {Implementation step following discovered pattern}
2. {Implementation step following discovered pattern}
3. {Implementation step following discovered pattern}

## Reference Documentation
- Architecture: {file paths}
- Examples: {file paths}
- Patterns: {file paths}
```

### Step 5: Generate Manifest with Doc-Aware Issues

Create `MANIFEST.md` with issues that reference docs:

```markdown
# Project Manifest

## Metadata
Project: {Implementation Name}
Based On: {docs_dir}
Created: {timestamp}

## Discovered Context
Architecture: {pattern}
Tech Stack: {stack}
Key Patterns: {patterns}

## Current Status
Current Issue: 001
Total Issues: {N}
Completed Issues: 0

## Issues

### 001 - Setup Following {Discovered Pattern}
Status: NOT_STARTED
File: issues/001-setup-{pattern}.md
Context: Follows patterns from {doc references}
Started:
Completed:

### 002 - {Feature} Using {Discovered Pattern}
Status: NOT_STARTED
File: issues/002-{feature}.md
Context: Follows patterns from {doc references}
Started:
Completed:

...
```

### Step 6: Generate Doc-Aware Issue Files

Each issue file should **reference relevant docs**:

```markdown
# Issue {N}: {Title}

## Context from Documentation

**Architecture Pattern**: {discovered pattern}
**Reference Docs**:
- {doc1} - {what it shows}
- {doc2} - {what it shows}

**Example to Follow**:
\`\`\`{language}
// From {source file}
{relevant code snippet from docs}
\`\`\`

## Metadata
ID: {N}
Status: NOT_STARTED
Based On: {doc references}

## Description
{Description that explains how this follows discovered patterns}

## Tasks

- [ ] Review {doc reference} for {pattern}
- [ ] Implement {feature} following {pattern} from {doc}
- [ ] Follow naming convention: {discovered convention}
- [ ] Add tests matching pattern in {test example doc}
- [ ] Handle errors using {discovered error pattern}
- [ ] Document following {discovered doc pattern}

## Discovered Patterns to Follow

### Pattern 1: {Name}
**From**: {doc reference}
**Description**: {how pattern works}
**Example**:
\`\`\`{language}
{code example from docs}
\`\`\`

### Pattern 2: {Name}
**From**: {doc reference}
...

## Guardrails

Based on {docs_dir} analysis:
- Security: {discovered requirements}
- Performance: {discovered requirements}
- Code Quality: {discovered standards}

## Constitutional Requirements

From {docs_dir} conventions:
- Testing: {discovered testing pattern}
- Documentation: {discovered doc pattern}
- Error Handling: {discovered error pattern}

## Success Criteria
1. All tasks checked off
2. Follows patterns from {doc references}
3. Matches examples in {doc references}
4. {Specific verification based on docs}

## Verification Commands
\`\`\`bash
{Commands discovered from docs}
\`\`\`

## Reference Documentation
- {doc1}: {description}
- {doc2}: {description}
- {example file}: {description}
```

### Step 7: Generate Doc-Aware Work Prompt

Create `.claude/smarter-wiggum/work-prompt.md` that **heavily references docs**:

```markdown
# Custom Work Prompt for {Project}

You are implementing **{Project}** based on documentation analysis from `{docs_dir}`.

## CRITICAL: Follow Discovered Patterns

This project has **existing patterns** discovered from documentation. You MUST follow them.

### Architecture: {Discovered Pattern}
**Reference**: {doc files}
**Pattern**: {description}
**Example**:
\`\`\`{language}
// From {source}
{code example}
\`\`\`

**Your Code Must**:
- {Specific requirement from pattern}
- {Specific requirement from pattern}

### File Structure
**Discovered Pattern**: {structure}
**Reference**: {doc files}

\`\`\`
{discovered file structure}
\`\`\`

**Your Files Must**:
- Follow this structure exactly
- Match naming convention: {pattern}

### Naming Conventions
**Discovered from**: {doc references}

- **Files**: {pattern} (Example: {example from docs})
- **Functions**: {pattern} (Example: {example from docs})
- **Variables**: {pattern} (Example: {example from docs})
- **Types**: {pattern} (Example: {example from docs})

### Testing Pattern
**Discovered from**: {test file references}

**Pattern**:
\`\`\`{language}
// From {test example file}
{test pattern example}
\`\`\`

**Your Tests Must**:
- Follow this exact structure
- Use same testing framework: {framework}
- Match coverage requirements: {requirement}

### Error Handling Pattern
**Discovered from**: {doc references}

**Pattern**:
\`\`\`{language}
// From {source}
{error handling example}
\`\`\`

**Your Error Handling Must**:
- Follow this pattern exactly
- Use same error types: {types}

## Task Execution

### 1. Before Implementing
- READ the reference docs for current task
- REVIEW the example patterns
- UNDERSTAND how to apply the pattern

### 2. While Implementing
- FOLLOW discovered patterns exactly
- MATCH naming conventions
- REFERENCE example code from docs
- DO NOT invent new patterns

### 3. After Implementing
- VERIFY matches examples from docs
- CHECK follows all discovered conventions
- COMPARE with reference implementations

## Reference Documentation

### Architecture
{List of architecture docs with summaries}

### Examples
{List of example files with what patterns they show}

### Patterns
{List of pattern docs with what they define}

## Discovered Code Examples

### Example 1: {Pattern Name}
**From**: {file}
**Use For**: {when to use this}
\`\`\`{language}
{code from docs}
\`\`\`

### Example 2: {Pattern Name}
**From**: {file}
**Use For**: {when to use this}
\`\`\`{language}
{code from docs}
\`\`\`

## Constitutional Requirements

**These are NON-NEGOTIABLE** (discovered from {docs_dir}):
1. {Requirement from docs}
2. {Requirement from docs}
3. {Requirement from docs}

## Current Task Instructions

READ FIRST:
1. {Relevant doc for current task}
2. {Relevant example for current task}

IMPLEMENT:
Task #{CURRENT_TASK_NUMBER} from {CURRENT_ISSUE_FILE}

FOLLOW:
- Pattern from {doc reference}
- Example from {example reference}

Begin working now.
```

### Step 8: Summary Output

After generating everything:

```markdown
# Analysis Complete ✓

## Documentation Analyzed
Directory: {docs_dir}
Files Analyzed: {count}
Parallel Agents: {count}

## Discovered
- Architecture: {pattern}
- Tech Stack: {stack}
- Key Patterns: {count} patterns
- Code Examples: {count} examples
- Constraints: {list}

## Generated
- ✓ PRD.md (references {count} docs)
- ✓ MANIFEST.md ({count} issues)
- ✓ {count} issue files (each references relevant docs)
- ✓ Custom work prompt (heavily doc-aware)
- ✓ Generic progress/audit prompts

## Key Patterns to Follow
1. **{Pattern}**: {description} (from {doc})
2. **{Pattern}**: {description} (from {doc})
3. **{Pattern}**: {description} (from {doc})

## Referenced Documentation
- {doc1}: {count} references
- {doc2}: {count} references
- {doc3}: {count} references

## Next Steps
1. Review PRD.md
2. Review MANIFEST.md and issues/
3. Review discovered patterns
4. Run: smarter-wiggum

The generated tasks will implement "{user request}" while following all discovered patterns from {docs_dir}.
```

## Parallel Agent Orchestration

**Critical**: Use Task tool to spawn agents **in parallel** for performance.

### Agent Spawning Pattern

```markdown
I'm spawning {N} parallel agents to analyze documentation:

{Then make N Task tool calls in a SINGLE message}
```

**Example**:
```
I'll analyze your docs in parallel using 5 agents.

{Call Task tool 5 times in one message:}
- Task(subagent_type="Explore", prompt="Analyze architecture docs...")
- Task(subagent_type="Explore", prompt="Analyze API docs...")
- Task(subagent_type="Explore", prompt="Analyze code examples...")
- Task(subagent_type="Explore", prompt="Analyze config files...")
- Task(subagent_type="Explore", prompt="Analyze tests...")
```

This runs all 5 agents simultaneously, not sequentially.

### Agent Result Processing

Wait for all agents to complete, then:
1. Read each agent's output
2. Parse JSON results
3. Merge into unified understanding
4. Generate manifest/issues based on merged understanding

## Example Use Cases

### Use Case 1: Existing Codebase

```
User: /plan-from-docs
Docs: ./
What: Add user authentication
Depth: Medium

Skill:
- Analyzes entire codebase
- Discovers Express/TypeScript patterns
- Finds existing auth examples
- Generates tasks that match existing code style
```

### Use Case 2: Framework Docs

```
User: /plan-from-docs
Docs: ./node_modules/next/docs/
What: Build a blog with Next.js
Depth: Quick

Skill:
- Analyzes Next.js documentation
- Discovers Next.js patterns (app router, etc.)
- Generates tasks using Next.js conventions
```

### Use Case 3: API Spec

```
User: /plan-from-docs
Docs: ./api-spec/
What: Implement API client
Depth: Deep

Skill:
- Analyzes OpenAPI/Swagger specs
- Discovers endpoints and types
- Generates tasks to implement client matching spec
```

## Quality Guidelines

### Doc Analysis Quality

**Good Analysis**:
- Identifies concrete patterns with examples
- References specific files
- Extracts actual code snippets
- Finds constraints and requirements

**Bad Analysis**:
- Generic descriptions
- No file references
- No code examples
- Vague patterns

### Generated Task Quality

**Good Tasks**:
- Reference specific docs
- Include code examples from docs
- Follow discovered patterns
- Verifiable against docs

**Bad Tasks**:
- Generic "implement X"
- No doc references
- Ignore discovered patterns
- Can't verify against docs

## Error Handling

### If Docs Directory Empty

```markdown
Error: No documentation found in {docs_dir}

Options:
1. Try different directory?
2. Use /init-project instead (for new projects)
3. Manually create docs first
```

### If Analysis Finds No Clear Patterns

```markdown
Warning: Limited patterns discovered from {docs_dir}

Found:
- {what was found}

Missing:
- Architecture documentation
- Code examples
- Conventions

Recommendation:
- Add more documentation first, OR
- Use /init-project for fresh start, OR
- Proceed with generic patterns
```

### If User Request Conflicts with Docs

```markdown
Conflict Detected:
Your request: {user request}
Discovered pattern: {pattern}
Conflict: {explanation}

Options:
1. Adjust request to match patterns
2. Override patterns (not recommended)
3. Document why diverging from patterns
```

## Output Files

All generated files should heavily reference docs:

- `PRD.md` - References {docs_dir} throughout
- `MANIFEST.md` - Notes doc context per issue
- `issues/*.md` - Each includes relevant doc references and examples
- `.claude/smarter-wiggum/work-prompt.md` - Full of doc references and examples

## Advanced: Multi-Source Analysis

If analyzing multiple doc sources:

```
Docs 1: ./docs/ (project docs)
Docs 2: ./src/ (existing code)
Docs 3: ./node_modules/framework/docs/ (framework docs)

Spawn agents for each source in parallel.
Merge results with priority: project > code > framework
```

## Success Criteria

A successful /plan-from-docs run produces:
1. Tasks that reference specific docs
2. Work prompt full of doc examples
3. Issues that follow discovered patterns
4. Verification commands from docs
5. When loop runs, code matches discovered patterns

The generated code should look like it was written by someone who deeply understood the documentation.
