---
name: design
description: Generate UX design specification from PRD including wireframes, user flows, and component inventory. Use this skill after PRD synthesis when you need to define the user experience before implementation, when wireframes or user flows are needed, or when accessibility requirements need to be documented.
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, AskUserQuestion
argument-hint: [path-to-prd]
user-invocable: true
---

# Design Specification Generation

**Input**: `$ARGUMENTS` (path to PRD document)
**Output**: Complete design specification with user flows, wireframes, and component inventory

## Process Overview

```
PRD Analysis → User Flows → Wireframes → Design System → DDR
      ↓            ↓           ↓             ↓           ↓
  Extract      Map user     ASCII/        Component   Document
  UX needs     journeys     describe      inventory   decisions
```

## Step 1: PRD Analysis for UX

Read the PRD and extract design-relevant information:

### User Context
- **Personas**: Who are the users? Technical level?
- **Goals**: What are users trying to accomplish?
- **Context**: Where/when will they use this?
- **Frequency**: Daily use vs occasional?

### Interaction Patterns
- **Primary Actions**: What do users do most?
- **Data Entry**: Forms, uploads, complex input?
- **Data Display**: Tables, charts, lists?
- **Navigation**: Hierarchy depth, breadth?

### Constraints
- **Accessibility**: WCAG requirements
- **Performance**: Offline support? Low bandwidth?
- **Platform**: Web, mobile, desktop?

## Step 2: User Flow Mapping

For each major feature, create user flows showing:
- Entry points and triggers
- Decision points and branches
- Happy path steps
- Error states and recovery
- Success outcomes

## Step 3: Wireframe Generation

Create ASCII wireframes for key screens focusing on:
- Layout and information hierarchy
- Component placement
- Interaction notes
- Responsive behavior
- Accessibility considerations

## Step 4: Component Inventory

Extract reusable components:

**Categories**:
- Layout (page shells, navigation, containers)
- Data Display (tables, lists, cards, detail views)
- Data Entry (forms, inputs, validation)
- Feedback (success, error, loading, empty states)
- Navigation (primary, secondary, breadcrumbs, tabs)

For each component document:
- Purpose and usage
- Variants
- States (default, hover, active, disabled, loading, error)
- Accessibility requirements (keyboard, screen reader, ARIA)

## Step 5: Design Decision Records (DDRs)

Document key design decisions:
- Context (why decision needed)
- Decision made
- Alternatives considered
- Consequences and tradeoffs

## Step 6: Generate Design Specification

**Save to**: `plan/design/[project-name]-design-spec.md`

Include:
- Executive Summary
- User Analysis (Personas, Journey Map)
- Information Architecture (Site Map, Navigation)
- User Flows (per feature)
- Wireframes (per screen)
- Component Inventory
- Design System Recommendations (Typography, Color, Spacing, Breakpoints)
- Accessibility Requirements (WCAG 2.1 AA)
- Design Decision Records
- Implementation Notes

## Quality Checklist

- [ ] All PRD features have corresponding user flows
- [ ] Wireframes cover all critical screens
- [ ] Component inventory is complete
- [ ] Accessibility requirements documented
- [ ] Design decisions have rationale
- [ ] Responsive considerations addressed
- [ ] Error states documented

---

**Begin design specification generation. Start by reading and analyzing the PRD.**
