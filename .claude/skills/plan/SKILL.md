---
name: plan
description: Interactive questionnaire-driven planning that captures comprehensive project requirements, tooling, conventions, and preferences to generate detailed PRD, MANIFEST, and custom prompts
user-invocable: true
---

# Interactive Project Planner

This skill conducts a comprehensive interactive questionnaire to capture **everything** about your project, then generates a detailed PRD, MANIFEST, issues, and fully customized work prompts.

## What This Does

Instead of generic planning, this asks **progressive, detailed questions** about:
- Project type and architecture
- Tech stack and frameworks
- Development tooling (package managers, linters, formatters)
- Testing strategy (what, where, when, coverage)
- Git workflow (hooks, commit style, branch strategy)
- Code conventions (naming, structure, patterns)
- Type-specific details (state management, database, auth, etc.)

Then generates:
- ✅ Comprehensive PRD with all decisions documented
- ✅ MANIFEST with appropriate issues for your stack
- ✅ Custom work prompts using your conventions
- ✅ Verification commands using your tools
- ✅ Config files (package.json, tsconfig.json, .eslintrc, etc.)
- ✅ Git hooks setup

## Process

This is a **progressive questionnaire** - we start high-level and drill down based on your answers.

### Phase 1: Project Foundation

Ask fundamental questions using AskUserQuestion:

**Question 1: Project Type**
```markdown
Question: What type of project are you building?
Header: Project Type
Options:
- Web Application (Frontend) - React, Vue, Svelte, etc.
- Web Application (Full-Stack) - Next.js, SvelteKit, Remix, etc.
- API / Backend Service - REST, GraphQL, gRPC
- CLI Tool - Command-line application
- Library / Package - Reusable code for others
- Monorepo - Multiple packages/apps
- Mobile App - React Native, Flutter
- Desktop App - Electron, Tauri
```

**Question 2: Primary Goal**
```markdown
Question: What is the primary goal of this project?
Header: Goal
Options:
- MVP / Prototype - Quick validation, iteration speed
- Production Application - Scalable, maintainable, battle-tested
- Internal Tool - Team productivity, specific workflow
- Open Source - Community-driven, documentation-heavy
```

**Question 3: Team Size & Context**
```markdown
Question: Who will be working on this?
Header: Team
Options:
- Solo Developer - Just you
- Small Team (2-5) - Close collaboration
- Large Team (6+) - Need strict conventions
- Open Source Contributors - Need excellent docs
```

### Phase 2: Tech Stack (Based on Project Type)

**If Web Application (Frontend):**

**Question: Framework**
```markdown
Question: Which frontend framework?
Header: Framework
Options:
- React 18+ - Component-based, hooks, ecosystem
- Next.js 14+ - React with SSR, routing, optimizations
- Vue 3 - Composition API, SFC, reactive
- Svelte / SvelteKit - Compiled, reactive, minimal runtime
```

**Question: Language**
```markdown
Question: TypeScript or JavaScript?
Header: Language
Options:
- TypeScript (Strict) - Full type safety, no any (Recommended)
- TypeScript (Relaxed) - Types but allow flexibility
- JavaScript (ESNext) - Modern JS, no types
```

**Question: Styling**
```markdown
Question: How will you style components?
Header: Styling
Options:
- Tailwind CSS - Utility-first, customizable (Recommended)
- CSS Modules - Scoped styles, traditional CSS
- Styled Components - CSS-in-JS, dynamic
- Vanilla CSS - Plain CSS files
```

**Question: State Management**
```markdown
Question: State management approach?
Header: State
Options:
- React Context + Hooks - Built-in, simple (Recommended for small apps)
- Zustand - Minimal, hooks-based (Recommended for medium apps)
- Redux Toolkit - Standardized, DevTools, mature
- Jotai / Recoil - Atomic state, granular
```

**Question: Form Handling**
```markdown
Question: Form library?
Header: Forms
Options:
- React Hook Form - Minimal re-renders, performant (Recommended)
- Formik - Mature, full-featured
- Vanilla - No library, manual control
```

**Question: Validation**
```markdown
Question: Data validation library?
Header: Validation
Options:
- Zod - TypeScript-first, type inference (Recommended)
- Yup - Schema-based, mature
- Joi - Powerful, verbose
- None - Manual validation
```

**If API / Backend:**

**Question: Framework**
```markdown
Question: Backend framework?
Header: Framework
Options:
- Express.js - Minimal, flexible, mature
- Fastify - Fast, low overhead, modern
- NestJS - Structured, TypeScript-native, enterprise
- Hono - Ultra-fast, edge-ready, minimal
```

**Question: API Style**
```markdown
Question: API architecture?
Header: API Style
Options:
- REST - Standard HTTP, resource-based
- GraphQL - Query language, flexible client
- tRPC - End-to-end TypeScript, type-safe
- gRPC - Protocol buffers, high-performance
```

**Question: Database**
```markdown
Question: Database?
Header: Database
Options:
- PostgreSQL - Relational, powerful, JSON support (Recommended)
- MongoDB - Document store, flexible schema
- SQLite - Embedded, simple, portable
- MySQL - Relational, widely supported
```

**Question: ORM / Query Builder**
```markdown
Question: Database tooling?
Header: ORM
Options:
- Prisma - Type-safe, migrations, modern (Recommended)
- Drizzle - Lightweight, SQL-like, fast
- TypeORM - Decorators, full-featured
- Kysely - Type-safe query builder
- Raw SQL - No ORM, direct control
```

**Question: Authentication**
```markdown
Question: Auth strategy?
Header: Auth
Options:
- JWT - Stateless, scalable
- Session-based - Server-side, traditional
- OAuth2 / OIDC - Third-party providers
- Passport.js - Multi-strategy, pluggable
- None - Implement later
```

**If Monorepo:**

**Question: Monorepo Tool**
```markdown
Question: Monorepo tooling?
Header: Monorepo
Options:
- Turborepo - Fast, caching, simple (Recommended)
- Nx - Powerful, generators, complex
- pnpm Workspaces - Simple, efficient
- Lerna - Classic, mature
```

**Question: Package Manager**
```markdown
Question: Which package manager?
Header: Package Manager
Options:
- pnpm - Fast, efficient, workspace-native (Recommended for monorepos)
- npm - Standard, built-in
- yarn - Fast, mature
- bun - Ultra-fast, all-in-one
```

### Phase 3: Development Tooling

**Question: Package Manager** (if not already asked)
```markdown
Question: Package manager preference?
Header: Package Manager
Options:
- pnpm - Fast, disk-efficient (Recommended)
- npm - Built-in, standard
- yarn - Mature, fast
- bun - Ultra-fast, modern
```

**Question: Linting**
```markdown
Question: Code linting setup?
Header: Linting
Options:
- ESLint (Strict) - Max rules, enforce quality (Recommended)
- ESLint (Recommended) - Balanced rules
- ESLint (Minimal) - Basic rules only
- Biome - Fast, all-in-one linter+formatter
- None - No linting
```

**Question: Formatting**
```markdown
Question: Code formatting?
Header: Formatting
Options:
- Prettier - Opinionated, consistent (Recommended)
- Biome - Fast, ESLint alternative
- ESLint (format rules) - Combined with linting
- None - Manual formatting
```

**Question: Type Checking** (if TypeScript)
```markdown
Question: TypeScript strictness?
Header: Type Strictness
Options:
- Strict Mode - All strict flags enabled (Recommended)
- Recommended - Core strict flags
- Loose - Minimal type checking
```

### Phase 4: Testing Strategy

**Question: Testing Frameworks**
```markdown
Question: Which testing frameworks? (Select multiple)
Header: Testing
MultiSelect: true
Options:
- Vitest / Jest - Unit + integration tests (Recommended)
- Playwright - E2E browser tests
- Cypress - E2E, component tests
- Testing Library - Component tests, user-centric
```

**Question: Test Coverage**
```markdown
Question: Code coverage target?
Header: Coverage
Options:
- 90%+ - Comprehensive (Recommended for production)
- 80%+ - Strong coverage
- 60%+ - Core functionality
- No target - Best effort
```

**Question: Test Placement**
```markdown
Question: Where should tests live?
Header: Test Location
Options:
- Co-located (__tests__/ next to source) (Recommended)
- Separate (tests/ directory)
- Mixed (unit co-located, e2e separate)
```

**Question: Test Running**
```markdown
Question: When should tests run?
Header: Test Cadence
Options:
- Pre-commit (via git hook) - Immediate feedback (Recommended)
- Pre-push (via git hook) - Before sharing
- CI only - On pull requests
- Manual - Developer discretion
```

### Phase 5: Git Workflow

**Question: Commit Convention**
```markdown
Question: Commit message style?
Header: Commits
Options:
- Conventional Commits - type(scope): message (Recommended)
- Semantic - feat/fix/chore prefixes
- Freeform - No strict convention
```

**Question: Git Hooks**
```markdown
Question: Which git hooks to enforce? (Select multiple)
Header: Git Hooks
MultiSelect: true
Options:
- pre-commit: lint + format - Catch style issues
- pre-commit: type check - Catch type errors
- pre-commit: unit tests - Fast tests only
- pre-push: all tests - Full test suite
- pre-push: build check - Ensure builds
- commit-msg: validate format - Enforce commit style
```

**Question: Hook Tool**
```markdown
Question: Git hooks implementation?
Header: Hook Tool
Options:
- Husky + lint-staged - Standard, reliable (Recommended)
- Lefthook - Fast, simple
- pre-commit - Python-based
- Manual scripts - Custom setup
```

**Question: Branch Strategy**
```markdown
Question: Git branching model?
Header: Branching
Options:
- Trunk-based - Main branch, short-lived feature branches (Recommended)
- Git Flow - develop, feature, release branches
- GitHub Flow - Main + feature branches
- Custom - Project-specific
```

### Phase 6: Code Conventions

**Question: File Naming**
```markdown
Question: File naming convention?
Header: File Naming
Options:
- kebab-case - user-service.ts (Recommended)
- camelCase - userService.ts
- PascalCase - UserService.ts
- snake_case - user_service.ts
```

**Question: Component/Class Naming**
```markdown
Question: Component/Class naming?
Header: Class Naming
Options:
- PascalCase - UserService, Button (Recommended)
- camelCase - userService, button
```

**Question: Function Naming**
```markdown
Question: Function naming convention?
Header: Function Naming
Options:
- camelCase, verb-first - getUserById, createUser (Recommended)
- camelCase, noun-verb - userGet, userCreate
- snake_case - get_user_by_id
```

**Question: Variable Naming**
```markdown
Question: Variable naming?
Header: Variable Naming
Options:
- camelCase - userName, isActive (Recommended)
- snake_case - user_name, is_active
```

**Question: Constants Naming**
```markdown
Question: Constants naming?
Header: Constants
Options:
- SCREAMING_SNAKE_CASE - MAX_RETRIES (Recommended for true constants)
- camelCase with const - maxRetries
- PascalCase - MaxRetries
```

**Question: Directory Structure**
```markdown
Question: Preferred directory structure?
Header: Structure
Options:
- Feature-based - Group by feature (auth/, users/, posts/)
- Type-based - Group by type (components/, services/, utils/)
- Hybrid - Mix of both based on context
```

### Phase 7: Project-Specific Deep Dive

**Based on answers, ask type-specific questions:**

**If Frontend + React:**
```markdown
Question: Routing library?
Options:
- React Router - Standard, mature
- TanStack Router - Type-safe, modern
- Wouter - Minimal, hooks
- None - Single page

Question: Data fetching?
Options:
- TanStack Query - Caching, optimistic updates (Recommended)
- SWR - Lightweight, React-focused
- Apollo (if GraphQL) - Full GraphQL client
- fetch/axios - Manual control

Question: Build tool?
Options:
- Vite - Fast, modern (Recommended)
- Webpack - Mature, configurable
- Turbopack - Next.js default, fast
- Rollup - Library builds
```

**If Backend + Node.js:**
```markdown
Question: Error handling pattern?
Options:
- Custom error classes - Structured, typed
- Error middleware - Express-style
- Result types - Functional approach
- try/catch - Traditional

Question: Logging?
Options:
- Pino - Fast, structured (Recommended)
- Winston - Feature-rich
- Console - Simple, built-in

Question: Validation middleware?
Options:
- Zod + middleware - Type-safe schemas
- express-validator - Middleware-first
- Joi - Schema-based
- Manual - Custom validation
```

**If CLI:**
```markdown
Question: Argument parsing?
Options:
- Commander.js - Full-featured (Recommended)
- yargs - Flexible, mature
- Inquirer - Interactive prompts
- minimist - Minimal parsing

Question: Output styling?
Options:
- Chalk - Colors, simple
- Ora - Spinners, progress
- Ink - React for CLIs
- Plain - No styling
```

### Phase 8: Documentation & Quality

**Question: Documentation**
```markdown
Question: Documentation approach?
Header: Docs
Options:
- JSDoc comments - Inline, type hints
- README + CONTRIBUTING - Essential docs
- Full docs site - Comprehensive (if library/open source)
- Minimal - Code is documentation
```

**Question: Code Review**
```markdown
Question: Code review requirements?
Header: Reviews
Options:
- Required on all PRs - Enforce quality
- Recommended - Flexible
- Self-review - Solo projects
```

**Question: CI/CD**
```markdown
Question: CI/CD platform?
Header: CI/CD
Options:
- GitHub Actions - Integrated, YAML
- GitLab CI - Powerful, flexible
- CircleCI - Fast, cached
- None - Manual deployment
```

## Synthesis Phase

After all questions, synthesize answers into structured data:

```json
{
  "project": {
    "type": "Web Application (Frontend)",
    "goal": "Production Application",
    "team": "Small Team (2-5)"
  },
  "techStack": {
    "framework": "Next.js 14+",
    "language": "TypeScript (Strict)",
    "styling": "Tailwind CSS",
    "stateManagement": "Zustand",
    "formHandling": "React Hook Form",
    "validation": "Zod",
    "routing": "Next.js App Router",
    "dataFetching": "TanStack Query",
    "buildTool": "Turbopack"
  },
  "tooling": {
    "packageManager": "pnpm",
    "linting": "ESLint (Strict)",
    "formatting": "Prettier",
    "typeChecking": "Strict Mode"
  },
  "testing": {
    "frameworks": ["Vitest", "Playwright", "Testing Library"],
    "coverage": "90%+",
    "placement": "Co-located",
    "cadence": ["Pre-commit (unit)", "Pre-push (all)"]
  },
  "git": {
    "commitStyle": "Conventional Commits",
    "hooks": ["pre-commit: lint + format", "pre-commit: type check", "pre-push: all tests"],
    "hookTool": "Husky + lint-staged",
    "branchStrategy": "Trunk-based"
  },
  "conventions": {
    "fileNaming": "kebab-case",
    "componentNaming": "PascalCase",
    "functionNaming": "camelCase, verb-first",
    "variableNaming": "camelCase",
    "constantsNaming": "SCREAMING_SNAKE_CASE",
    "structure": "Feature-based"
  },
  "quality": {
    "documentation": "JSDoc comments",
    "codeReview": "Required on all PRs",
    "cicd": "GitHub Actions"
  }
}
```

## Generation Phase

Use synthesized answers to generate:

### 1. Comprehensive PRD.md

```markdown
# Product Requirements Document: {Project Name}

## Project Overview

**Type**: {project.type}
**Goal**: {project.goal}
**Team**: {project.team}

## Tech Stack

### Core
- **Framework**: {techStack.framework}
- **Language**: {techStack.language}
- **Styling**: {techStack.styling}

### Libraries
- **State Management**: {techStack.stateManagement}
- **Form Handling**: {techStack.formHandling}
- **Validation**: {techStack.validation}
- **Data Fetching**: {techStack.dataFetching}

### Tooling
- **Package Manager**: {tooling.packageManager}
- **Linter**: {tooling.linting}
- **Formatter**: {tooling.formatting}
- **Type Checking**: {tooling.typeChecking}

## Testing Strategy

### Frameworks
{List testing.frameworks}

### Coverage Target
{testing.coverage}

### Test Location
{testing.placement}

### Test Cadence
{List testing.cadence}

## Git Workflow

### Commit Convention
{git.commitStyle}

Example:
\`\`\`
feat(auth): add OAuth2 login
fix(api): handle null user case
chore(deps): update dependencies
\`\`\`

### Git Hooks
{List git.hooks}

**Tool**: {git.hookTool}

### Branch Strategy
{git.branchStrategy}

## Code Conventions

### File Naming
**Convention**: {conventions.fileNaming}

Examples:
- Components: \`user-profile.tsx\`
- Services: \`auth-service.ts\`
- Utils: \`format-date.ts\`

### Component/Class Naming
**Convention**: {conventions.componentNaming}

Examples:
- \`UserProfile\`
- \`AuthService\`
- \`DateFormatter\`

### Function Naming
**Convention**: {conventions.functionNaming}

Examples:
- \`getUserById\`
- \`createPost\`
- \`validateEmail\`

### Variable Naming
**Convention**: {conventions.variableNaming}

Examples:
- \`userName\`
- \`isLoggedIn\`
- \`postCount\`

### Constants
**Convention**: {conventions.constantsNaming}

Examples:
- \`MAX_RETRIES\`
- \`API_BASE_URL\`
- \`DEFAULT_TIMEOUT\`

### Directory Structure
**Pattern**: {conventions.structure}

\`\`\`
src/
├── features/              # Feature-based organization
│   ├── auth/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── __tests__/
│   ├── posts/
│   └── users/
├── shared/                # Shared utilities
│   ├── components/
│   ├── hooks/
│   └── utils/
└── app/                   # App-level config
\`\`\`

## Quality Standards

### Documentation
{quality.documentation}

### Code Review
{quality.codeReview}

### CI/CD
{quality.cicd}

## Requirements

### Functional Requirements
{Generate based on project goal and type}

### Non-Functional Requirements
- **Performance**: Based on {project.goal}
- **Testing**: {testing.coverage} coverage minimum
- **Code Quality**: All linting rules must pass
- **Type Safety**: {tooling.typeChecking} - no \`any\` types
- **Documentation**: {quality.documentation} required

## Success Criteria
1. All functional requirements implemented
2. {testing.coverage} test coverage achieved
3. All lint/type checks passing
4. Git hooks configured and working
5. CI/CD pipeline green
6. Code follows all conventions
7. Documentation complete
```

### 2. Custom MANIFEST.md

Generate issues specific to the tech stack:

```markdown
# Project Manifest

## Metadata
Project: {Project Name}
Type: {project.type}
Tech Stack: {techStack.framework}, {techStack.language}
Created: {timestamp}

## Current Status
Current Issue: 001
Total Issues: {N}
Completed Issues: 0

## Issues

### 001 - Project Setup & Tooling
Status: NOT_STARTED
File: issues/001-setup.md
Context: Configure {tooling.packageManager}, {tooling.linting}, {tooling.formatting}, git hooks

### 002 - Core Architecture & Structure
Status: NOT_STARTED
File: issues/002-architecture.md
Context: Set up {conventions.structure} structure, configure {techStack.framework}

### 003 - {Feature-specific based on project type}
...
```

### 3. Custom Work Prompt

Use conventions in work prompt:

```markdown
# Custom Work Prompt

You are implementing a {project.type} using {techStack.framework} and {techStack.language}.

## CRITICAL: Follow Project Conventions

This project has **strict conventions**. You MUST follow them exactly.

### File Naming: {conventions.fileNaming}
**Examples**:
- ✅ \`user-profile.tsx\`
- ❌ \`UserProfile.tsx\`
- ❌ \`user_profile.tsx\`

### Component Naming: {conventions.componentNaming}
**Examples**:
- ✅ \`export function UserProfile()\`
- ❌ \`export function userProfile()\`

### Function Naming: {conventions.functionNaming}
**Examples**:
- ✅ \`getUserById\`
- ✅ \`createPost\`
- ❌ \`userGet\`
- ❌ \`postCreate\`

### Tech Stack Requirements

**State Management**: Use {techStack.stateManagement}
\`\`\`typescript
// Example for Zustand:
import { create } from 'zustand'

const useStore = create((set) => ({
  user: null,
  setUser: (user) => set({ user })
}))
\`\`\`

**Validation**: Use {techStack.validation}
\`\`\`typescript
// Example for Zod:
import { z } from 'zod'

const userSchema = z.object({
  email: z.string().email(),
  age: z.number().min(18)
})
\`\`\`

**Forms**: Use {techStack.formHandling}
\`\`\`typescript
// Example for React Hook Form:
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

const { register, handleSubmit } = useForm({
  resolver: zodResolver(userSchema)
})
\`\`\`

### Testing Requirements

**Coverage**: {testing.coverage} minimum
**Framework**: {testing.frameworks[0]}
**Location**: {testing.placement}

\`\`\`typescript
// Test template:
describe('UserProfile', () => {
  it('should render user name', () => {
    // Arrange
    const user = { name: 'John' }

    // Act
    render(<UserProfile user={user} />)

    // Assert
    expect(screen.getByText('John')).toBeInTheDocument()
  })
})
\`\`\`

### Git Workflow

**Commits**: {git.commitStyle}
\`\`\`
feat(auth): add login form
fix(ui): correct button alignment
test(auth): add login form tests
\`\`\`

**Before Committing**:
{List git.hooks that run on pre-commit}

**Before Pushing**:
{List git.hooks that run on pre-push}

### Constitutional Requirements

**NON-NEGOTIABLE**:
1. **{tooling.typeChecking}** - No \`any\` types allowed
2. **{testing.coverage} coverage** - All code must have tests
3. **{conventions.fileNaming}** - All files must follow naming
4. **{git.commitStyle}** - All commits must follow format
5. **{tooling.linting}** - All lint rules must pass

## Current Task

READ: {CURRENT_ISSUE_FILE}
IMPLEMENT: Task #{CURRENT_TASK_NUMBER}
FOLLOW: All conventions above

Begin working now.
```

### 4. Verification Commands

Based on tooling choices:

```bash
# Package manager: {tooling.packageManager}
{tooling.packageManager} install
{tooling.packageManager} test
{tooling.packageManager} run lint
{tooling.packageManager} run type-check

# Testing: {testing.frameworks}
{tooling.packageManager} test -- --coverage
{tooling.packageManager} run test:e2e

# Building
{tooling.packageManager} run build
```

### 5. Config Files

Generate actual config files:

**package.json**:
```json
{
  "name": "{project-name}",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "test:e2e": "playwright test",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write .",
    "type-check": "tsc --noEmit",
    "prepare": "husky install"
  },
  "dependencies": {
    // Based on techStack answers
  },
  "devDependencies": {
    // Based on tooling answers
  }
}
```

**.eslintrc.js**:
```javascript
// Based on tooling.linting answer
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier'
  ],
  // ... strict rules if "ESLint (Strict)"
}
```

**tsconfig.json**:
```json
// Based on tooling.typeChecking answer
{
  "compilerOptions": {
    "strict": true,              // if "Strict Mode"
    "noUncheckedIndexedAccess": true,
    "noImplicitAny": true,
    // ... all strict flags
  }
}
```

**.husky/pre-commit**:
```bash
#!/bin/bash
# Based on git.hooks answers

npx lint-staged

# If "pre-commit: type check" selected:
npm run type-check

# If "pre-commit: unit tests" selected:
npm test
```

**lint-staged.config.js**:
```javascript
// Based on git.hooks answers
module.exports = {
  '*.{ts,tsx}': [
    'eslint --fix',      // if lint hook enabled
    'prettier --write',  // if format hook enabled
    'vitest related --run'  // if test hook enabled
  ]
}
```

## Output Summary

After generation, show summary:

```markdown
# Plan Complete ✓

## Generated Files

### Documentation
- ✓ PRD.md (comprehensive requirements)
- ✓ MANIFEST.md ({N} issues)
- ✓ issues/001-setup.md (tooling setup)
- ✓ issues/002-architecture.md (structure)
- ✓ issues/003-{feature}.md
- ... ({N} total issues)

### Configuration
- ✓ package.json (with scripts for {tooling.packageManager})
- ✓ tsconfig.json ({tooling.typeChecking})
- ✓ .eslintrc.js ({tooling.linting})
- ✓ .prettierrc ({tooling.formatting})
- ✓ vitest.config.ts ({testing.frameworks})
- ✓ playwright.config.ts ({if E2E selected})

### Git Hooks
- ✓ .husky/pre-commit (lint, format, type-check, tests)
- ✓ .husky/pre-push (full test suite, build)
- ✓ .husky/commit-msg ({git.commitStyle} validation)
- ✓ lint-staged.config.js

### Custom Prompts
- ✓ .claude/smarter-wiggum/work-prompt.md (with your conventions)
- ✓ .claude/smarter-wiggum/progress-prompt.md
- ✓ .claude/smarter-wiggum/audit-prompt.md

## Your Configuration Summary

**Project**: {project.type} - {project.goal}
**Stack**: {techStack.framework}, {techStack.language}, {techStack.styling}
**Tooling**: {tooling.packageManager}, {tooling.linting}, {tooling.formatting}
**Testing**: {testing.frameworks} @ {testing.coverage} coverage
**Git**: {git.commitStyle}, {git.hookTool}

## Conventions Enforced

- Files: {conventions.fileNaming}
- Components: {conventions.componentNaming}
- Functions: {conventions.functionNaming}
- Variables: {conventions.variableNaming}
- Structure: {conventions.structure}

## Next Steps

1. Review generated PRD.md
2. Review issues/ directory
3. Install dependencies:
   \`\`\`bash
   {tooling.packageManager} install
   \`\`\`
4. Run the loop:
   \`\`\`bash
   smarter-wiggum
   \`\`\`

The loop will follow your exact conventions and use your chosen tools!
```

## Important Notes

- **Progressive questioning** - Drill down based on answers
- **Skip irrelevant questions** - Don't ask backend questions for frontend projects
- **Provide examples** - Show what each option means
- **Recommend defaults** - Mark recommended options
- **Allow multi-select** - For things like testing frameworks, git hooks
- **Generate real configs** - Not just documentation, but actual working files
- **Enforce in prompts** - Work prompt uses their conventions

## Success Criteria

A successful /plan run produces:
1. **Comprehensive PRD** - Every decision documented
2. **Custom work prompts** - Using user's exact conventions
3. **Working configs** - package.json, tsconfig, eslint, etc.
4. **Git hooks configured** - Based on user preferences
5. **Detailed issues** - Tool-specific tasks
6. **Verification commands** - Using user's chosen tools

The generated code should **perfectly match** the user's preferences because the loop knows exactly what they want.
