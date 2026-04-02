---
name: factory
description: Run the complete autonomous pipeline from idea to implementation-ready tasks. Use this skill when starting a completely new project, when the user wants end-to-end autonomous execution, or when all pipeline stages need to run in sequence.
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, AskUserQuestion, Task, Bash
argument-hint: [idea-description]
user-invocable: true
---

# Full Pipeline Execution (Dark Factory)

Execute the complete ideation-to-implementation pipeline autonomously.

**Input**: `$ARGUMENTS` (idea description or path to existing document)
**Output**: Complete project artifacts ready for implementation

## Pipeline Stages

```
IDEATE → PRD → DESIGN → BLUEPRINT → ARCHITECT → SECURITY → BREAKDOWN
   ↓       ↓      ↓         ↓           ↓          ↓          ↓
 Ideas   Full   UX Spec   Tech      Detailed   Threat    Tasks/
Captured  PRD   Created   Stack     Design     Model     Issues
```

## Execution

### Stage 1: Ideation
If starting from idea description, conduct ideation session.
If given a file path, check if it's ideation, PRD, or architecture and skip completed stages.

**Output**: `plan/ideation/[project]-ideation.md`

### Stage 2: PRD Synthesis
Transform ideation into comprehensive PRD.
- Research market context
- Define personas and journeys
- Specify requirements

**Output**: `plan/prd/PRD-[project]-v1.0.md`

### Stage 3: Design Specification
Generate UX design from PRD.
- Map user flows
- Create wireframes
- Build component inventory

**Output**: `plan/design/[project]-design-spec.md`

### Stage 4: Blueprint Generation
Select technology stack based on PRD signals.
- Choose base stack
- Customize tools
- Justify choices

**Output**: `plan/blueprints/[project]-blueprint.md`

### Stage 5: Architecture
Generate detailed technical architecture.
- System diagrams
- Data models
- ADRs

**Output**: `plan/architecture/[project]-architecture.md`

### Stage 6: Threat Model
Generate STRIDE threat analysis.
- Trust boundaries
- Threat enumeration
- Mitigations

**Output**: `plan/security/[project]-threat-model.md`

### Stage 7: Task Breakdown
Break architecture into implementable units.
- Issues from features
- Tasks from issues
- Dependencies mapped

**Output**: `plan/MANIFEST.md`, `plan/issues/`, `plan/tasks/`

## Stage Transitions

Between each stage:
1. Validate previous stage output
2. Summarize key findings
3. Begin next stage

If errors or gaps found:
1. Document the issue
2. Attempt resolution via research
3. If unresolvable, ask user for input

## Completion Summary

```
Pipeline Complete!

Documents Generated:
- Ideation: plan/ideation/[project]-ideation.md
- PRD: plan/prd/PRD-[project]-v1.0.md
- Design: plan/design/[project]-design-spec.md
- Blueprint: plan/blueprints/[project]-blueprint.md
- Architecture: plan/architecture/[project]-architecture.md
- Threat Model: plan/security/[project]-threat-model.md
- Manifest: plan/MANIFEST.md
- Issues: [count] in plan/issues/
- Tasks: [count] in plan/tasks/

Ready for Implementation:
1. Review generated documents
2. Validate architecture decisions
3. Begin task execution with TDD workflow
```

---

**Begin pipeline execution. Analyze input to determine starting stage.**
