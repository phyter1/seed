---
name: task-loop-interactive
description: Interactive task development with human-in-the-loop collaboration
tools: TodoWrite, Read, Write, Edit, MultiEdit, Glob, Grep, Task, Bash, NotebookEdit, WebSearch
---

[[ultrathink]]

# Interactive Task Development Pipeline

**Human-in-the-loop collaborative task development with user approval at each stage.**

## Task Input Analysis

**Task**: `$ARGUMENTS`

### Initial Questions
1. **Scope**: New functionality or modifying existing code?
2. **Requirements**: Specific constraints or preferences?
3. **Success Criteria**: What defines completion?
4. **Technical Approach**: Preferred technologies/patterns?
5. **Quality Standards**: Testing requirements, performance needs, documentation?

**⏯️ PAUSE**: Confirm task understanding before proceeding.

## Pipeline Stages

### 1. Task Breakdown
- Launch `task-breakdown` agent with user input
- Create detailed implementation plan
- Update task manifest: `progress: "Documentation"`

**⏯️ PAUSE**: Review and approve task breakdown before implementation.

### 2. Context Gathering  
- Launch `task-context` agent for codebase analysis
- Research implementation patterns and dependencies
- Update task manifest: `progress: "Context Gathering"`

**⏯️ PAUSE**: Review context findings and confirm approach.

### 3. Development
- Launch `task-developer` agent for implementation
- Track progress with milestone check-ins
- Update task manifest: `progress: "Development"`

**Interactive Development Features**:
- Real-time progress updates at major milestones
- Quality check points for user feedback
- Course correction opportunities

**⏯️ PAUSE**: Review implementation before testing.

### 4. Testing & Validation
- Execute test suites and validate functionality
- Handle test failures collaboratively
- Update task manifest: `progress: "Testing"`

**Test Failure Handling**:
- Present failure analysis and resolution options
- Allow user choice between automated fixes or manual intervention

**⏯️ PAUSE**: Confirm all tests pass before code review.

### 5. Linting
- Run code quality checks and linting
- Apply automated fixes where possible
- Update task manifest: `progress: "Linting"`

**⏯️ PAUSE**: Review linting results and approve fixes.

### 6. Code Review
- Launch `task-code-review` agent for quality assessment
- Present findings and recommendations
- Update task manifest: `progress: "Code Review"`

**Review Discussion**:
- Collaborate on improvement recommendations
- User chooses between accepting current state or applying improvements

**⏯️ PAUSE**: Approve code quality before completion.

### 7. Completion & Integration
- Final quality gate assessment
- Git integration with user-approved changes
- Update task manifest: `progress: "Complete"`

**Git Integration**:
- Show changes for review before committing
- User chooses commit message approach (auto-generated or custom)

## Progress Tracking

**Task Manifest Status Values**:
- `"Not Started"` - Initial state
- `"Documentation"` - Task breakdown phase  
- `"Test Planning"` - Test criteria definition
- `"Context Gathering"` - Codebase analysis and research
- `"Development"` - Active implementation
- `"Linting"` - Code quality checks
- `"Code Review"` - Quality assessment
- `"Complete"` - Successfully finished
- `"Failed"` - Encountered unresolvable issues

## Error Handling

**Collaborative Problem Solving**:
When issues arise, present:
1. Problem description and impact
2. Root cause analysis  
3. Resolution options (automated, alternative approach, manual intervention)

**User Choice Points**:
- `analyze` - Detailed investigation
- `fix` - Attempt automated resolution
- `skip` - Continue if safe to skip
- `manual` - User-guided resolution

## User Controls

**Available Commands During Pipeline**:
- `pause` - Pause for discussion
- `modify` - Request approach changes
- `continue` - Proceed with current approach
- `detail` - Get more information about current step
- `back` - Return to previous stage

## Usage Examples

### Basic Usage
```bash
task-loop-interactive "Add user authentication to the login component"
```

### Complex Task
```bash
task-loop-interactive "Implement caching layer with Redis - focus on performance"
```

### Recovery
```bash  
task-loop-interactive --resume
```

## Benefits

**Enhanced Control**: User approval at every major decision point
**Transparency**: Full visibility into development process  
**Quality Assurance**: Collaborative validation at each stage
**Risk Mitigation**: Early issue detection with user guidance
**Learning**: Understand development patterns through guided process

---

**Interactive pipeline ready for collaborative development**