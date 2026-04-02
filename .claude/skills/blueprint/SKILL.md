---
name: blueprint
description: Transform a PRD into a complete implementation blueprint with customized, justified tech stack. Use this skill when you have a PRD and need to select technologies, when starting implementation planning, or when the user asks what tech stack to use.
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, AskUserQuestion, Task
argument-hint: [path-to-prd]
user-invocable: true
---

# PRD to Implementation Blueprint

**Input**: `$ARGUMENTS` (path to PRD document)
**Output**: Complete implementation blueprint with justified tech stack

## Process Overview

```
PRD Analysis → Stack Selection → Blueprint Generation
      ↓              ↓                  ↓
  Extract        Match to          Generate
  signals        tools             blueprint
```

## Step 1: PRD Analysis

Read the PRD and extract implementation-relevant signals:

### Application Characteristics
- **Type**: API-only | Web app | Mobile | CLI | Library | Hybrid
- **User-facing vs internal**
- **Expected scale**: Users, requests, data volume
- **Performance requirements**: Latency, throughput

### Data Requirements
- **Persistence**: PostgreSQL, SQLite, none
- **Real-time sync**: Convex, WebSockets, SSE
- **File storage**: Images, documents, media
- **Search**: Full-text, vector/semantic

### Feature Signals
- **Authentication**: OAuth, magic link, SSO, custom
- **Background jobs**: Email, processing, scheduling
- **Email sending**: Transactional, marketing
- **AI/LLM features**: Chat, generation, embeddings
- **Payment processing**: Stripe, subscriptions

### Deployment & Operations
- **Target**: Vercel, self-hosted, edge, hybrid
- **Monitoring requirements**
- **Compliance**: GDPR, HIPAA, SOC2

## Step 2: Stack Selection

### Base Stack Decision Matrix

| PRD Signals | Base Stack |
|-------------|------------|
| API-only, no frontend | `ts-api` |
| Web app with SSR | `ts-webapp` |
| NPM package/library | `ts-library` |
| Python ML/data focus | `python-api` |
| High-performance, systems | `rust-api` or `go-api` |
| Mobile app | `mobile-rn` or `mobile-flutter` |

### Tool Customization

**ADD if PRD requires:**
- Real-time collaboration → Convex
- Traditional SQL → Drizzle ORM + PostgreSQL
- Background jobs → Trigger.dev
- Transactional email → Resend
- Complex forms → React Hook Form
- Rich data tables → TanStack Table
- AI features → Vercel AI SDK
- Payments → Stripe

**REMOVE if PRD doesn't require:**
- Convex → if no real-time needs
- Trigger.dev → if no background jobs
- Resend → if no email sending

## Step 3: Generate Blueprint

**Save to**: `plan/blueprints/[project-name]-blueprint.md`

Include:
- Executive Summary
- PRD Analysis (Requirements, Constraints)
- Architecture Overview (diagram, data flow)
- Tech Stack (each tool with PRD justification)
- Tools NOT Included (with reasons)
- Development Workflow (TDD, security, git)
- Testing Strategy
- Project Structure
- Configuration Files (complete, ready to use)
- Implementation Phases
- Quick Start Commands
- Environment Variables
- Security Checklist
- Monitoring & Observability

## Quality Checklist

- [ ] Every tool choice justified by PRD requirement
- [ ] Unjustified tools explicitly excluded
- [ ] Architecture diagram included
- [ ] Implementation phases align with PRD priorities
- [ ] Security checklist comprehensive
- [ ] Quick start commands complete and correct
- [ ] All config files provided

---

**Begin blueprint generation. Start by reading and analyzing the PRD.**
