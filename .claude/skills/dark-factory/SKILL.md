---
name: dark-factory
description: "Orchestrates the full product planning pipeline — from conversational PRD elicitation through architecture, design, and atomic story breakdown. Use when the user wants to plan a new application, start a product pipeline, or says 'dark factory'. Manages 8 sequential phases with resumability via plan/pipeline-state.json."
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Skill
---

# Dark Factory — Product Planning Pipeline Orchestrator

You are the orchestrator for an 8-phase product planning pipeline. You guide a project from raw idea to implementation-ready stories.

**AAS Compliance:** Every application produced by this pipeline implements AAS (Agentic Accessibility Standard) v0.6 compliance. Read `.claude/templates/AAS-INTEGRATION-GUIDE.md` at initialization. The AAS conformance level (core/operational/governed) is auto-determined in Phase 2 from PRD signals and flows through `pipeline-state.json` metadata to scale all downstream output.

## How to Run Each Phase

For each phase, use the **Skill tool** to invoke the corresponding skill by name. The Skill tool loads and executes the skill's full instructions.

**Example:** To run Phase 1, call the Skill tool with `skill: "elicit-prd"`. To run Phase 2, call `skill: "generate-adrs"`. And so on.

Phase 1 (`elicit-prd`) is **interactive** — it will have a long conversation with the user. All other phases are generative and run without user interaction (aside from checkpoints between phases).

---

## Step 1: Initialize or Resume

Check whether `plan/pipeline-state.json` exists.

**If it does NOT exist:**

Create `plan/` and write `plan/pipeline-state.json`:

```json
{
  "project_name": "",
  "created_at": "<ISO timestamp>",
  "updated_at": "<ISO timestamp>",
  "current_phase": 1,
  "phases": {
    "1": { "name": "PRD Elicitation", "status": "pending", "started_at": null, "completed_at": null, "outputs": [] },
    "2": { "name": "Architecture Decision Records", "status": "pending", "started_at": null, "completed_at": null, "outputs": [] },
    "3": { "name": "Technical Architecture", "status": "pending", "started_at": null, "completed_at": null, "outputs": [] },
    "4": { "name": "System Design", "status": "pending", "started_at": null, "completed_at": null, "outputs": [] },
    "5": { "name": "API & Data Model", "status": "pending", "started_at": null, "completed_at": null, "outputs": [] },
    "6": { "name": "Implementation Plan", "status": "pending", "started_at": null, "completed_at": null, "outputs": [] },
    "7": { "name": "Epic Breakdown", "status": "pending", "started_at": null, "completed_at": null, "outputs": [] },
    "8": { "name": "Story Breakdown", "status": "pending", "started_at": null, "completed_at": null, "outputs": [] }
  },
  "metadata": {
    "prd_version": 0,
    "total_adrs": 0,
    "total_epics": 0,
    "total_stories": 0,
    "aas_conformance_level": null,
    "aas_conformance_determined_at": null
  }
}
```

Ask the user for the project name and update `project_name`.

**If it DOES exist:**

Read it. Find the first phase where `status !== "complete"`. That is the resume point. Tell the user: "Resuming from Phase N: [Phase Name]."

Read all outputs listed in completed phases to rebuild context.

---

## Step 2: Phase Execution Loop

For each phase starting from the current phase:

**Before running a phase:**
1. Update `pipeline-state.json`: set `status` to `"in_progress"` and `started_at` to current ISO timestamp
2. Read all outputs from completed phases to provide context
3. Create the output directory if it doesn't exist
4. **AAS Gate (Phase 3+ only):** If `current_phase >= 3`, read `pipeline-state.json` and verify `metadata.aas_conformance_level` is not null. If it is null, HALT and report: "AAS conformance level has not been determined. Phase 2 (ADR generation) must set `metadata.aas_conformance_level` before Phase 3 can proceed." Do not continue until this is resolved.

**Run the phase:**
Use the Skill tool to invoke the corresponding skill (see mapping below).

**After a phase completes:**
1. Verify output files exist using Glob
2. Update `pipeline-state.json`: set `status` to `"complete"`, `completed_at`, populate `outputs`, increment `current_phase`, update `updated_at` and metadata counts
3. Present checkpoint to the user:

```
Phase [N] complete: [Phase Name]

Files generated:
  - [file paths]

Continue to Phase [N+1]: [Next Phase Name]? (yes / no)
```

If the user says no, stop. They resume by running `/dark-factory` again.

---

## Step 3: Phase → Skill Mapping

| Phase | Skill to invoke | Notes |
|-------|----------------|-------|
| 1 | `elicit-prd` | **Interactive** — long conversation with user |
| 2 | `generate-adrs` | Generative |
| 3 | `generate-architecture` | Generative |
| 4 | `generate-system-design` | Generative |
| 5 | `generate-api-data` | Generative |
| 6 | `generate-implementation-plan` | Generative |
| 7 | `generate-epics` | Generative |
| 8 | `generate-stories` | Generative |

---

## Step 4: Output Directory Structure

```
plan/
├── pipeline-state.json
├── research/
│   ├── prd-research.md
│   └── adr-research.md
├── 01-prd/
│   └── PRD.md
├── 02-adrs/
│   └── ADR-0001-stack-selection.md ... ADR-XXXX-*.md
├── 03-architecture/
│   └── TECHNICAL-ARCHITECTURE.md
├── 04-system-design/
│   └── SYSTEM-DESIGN.md
├── 05-api-and-data/
│   ├── DATA-MODEL.md
│   └── API-DESIGN.md
├── 06-implementation-plan/
│   └── IMPLEMENTATION-PLAN.md
├── 07-epics/
│   ├── epics-index.json
│   └── EPIC-001-*.md ...
└── 08-stories/
    ├── stories-index.json
    └── EPIC-001/
        └── STORY-001-*.md ...
```

---

## Step 5: Completion

When all 8 phases complete, display a summary table with: phase name, status, file count, completed timestamp. List all generated files and total word count.

---

## Rules

- Always update `pipeline-state.json` at each state transition
- Never skip a phase — each depends on all previous outputs
- If a skill fails, do NOT mark the phase complete — report and stop
- Phase 1 is the only interactive phase; all others are generative
- Re-read `pipeline-state.json` before each phase to ensure state is current
