# Development Workflow

Universal engineering standards. Non-negotiable.

**Pair with:** [Tooling System](./README.md) for language-specific tool configurations.

```
This document (process)  +  Tooling Stack (tools)  =  Complete setup
         ↓                         ↓
   How we work              What we use
```

---

## Core Principles

| Principle | Meaning |
|-----------|---------|
| **No Shortcuts** | Do it right the first time. Not perfect—*right*. |
| **TDD Always** | Red → Green → Refactor → Commit. Every feature. |
| **Security Built-In** | Not bolted on. Designed from day one. |
| **Review Everything** | No direct commits to main. Ever. |

**Never say:** "We'll fix it later" / "Good enough" / "Just a prototype" / "It's only internal"

---

## Security Standards

### Secrets

| Rule | Details |
|------|---------|
| Never hardcode | No secrets in code, logs, error messages, CLI args |
| Environment only | All secrets via `.env` files (never committed) |
| Validate at startup | Use Zod schemas, fail fast if missing |
| Rotate immediately | If any suspicion of compromise |

```typescript
// ✅ Correct pattern
const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  CONVEX_URL: z.string().url(),
});
export const config = envSchema.parse(process.env);
```

### Dependencies

| When | Do |
|------|----|
| Before adding | Verify authenticity, check `bun audit`, review maintenance |
| Every push | `bun audit` runs in pre-push hook |
| Weekly | Review and update, zero critical/high vulnerabilities |

### Input Validation

**Trust nothing.** All external input is untrusted—user input, API responses, file contents, database content.

```typescript
// ✅ Validate at boundaries with Zod
const CreatePostSchema = z.object({
  content: z.string().min(1).max(10000),
  threadId: z.string().uuid(),
});

export function createPost(input: unknown) {
  const validated = CreatePostSchema.parse(input);
  // Now safe to use
}
```

**Rules:** Whitelist allowed values. Reject early. Validate at boundaries, trust internally.

### API Security

| Requirement | Implementation |
|-------------|----------------|
| Rate limiting | All endpoints, per-IP and per-user |
| Request validation | Validate Content-Type, limit body size, timeout requests |
| Response security | Never expose stack traces. Generic errors to clients, details in logs. |
| Security headers | X-Content-Type-Options, X-Frame-Options, CSP, HSTS |

### Logging Security

| Never Log | Always Log |
|-----------|------------|
| Passwords, API keys, tokens | Auth events (success/failure) |
| PII, credit cards, SSNs | Authorization failures |
| Session tokens | Input validation failures |
| Full request bodies | Security config changes |

### OWASP Top 10

Know them. Design for them. [owasp.org/Top10](https://owasp.org/Top10/)

---

## TDD Cycle

```text
1. ACCEPTANCE CRITERIA  → Define "done"
2. RED                  → Write failing test
3. GREEN                → Minimum code to pass
4. REFACTOR             → Make it clean
5. COMMIT               → Atomic commit
6. REPEAT               → Next behavior
```

**Commit when:** One complete behavior, one edge case, or one significant piece of functionality.

**Verify before commit:**

```bash
bun test              # Tests pass
bun run lint:fix      # Linting clean
bun run typecheck     # Types valid
git commit            # NO FLAGS
```

---

## Code Review

### Requirements

| Change Type | Reviewers | Requirements |
|-------------|-----------|--------------|
| Standard | 1 | Tests, lint, types pass |
| Security-sensitive* | 2 | Explicit security sign-off |

*Auth, secrets, data access, input validation, crypto, external APIs, file/subprocess operations

### Author Checklist

- [ ] Self-reviewed before requesting review
- [ ] PR < 400 lines (< 800 max)
- [ ] Clear description with context
- [ ] Tests cover the change

### Reviewer Checklist

- [ ] TDD followed (test commits first)
- [ ] Security implications considered
- [ ] Error handling appropriate
- [ ] No `any` types or secrets

---

## Git Workflow

### Sacred Rules

```bash
# ❌ NEVER
git push --force          # Destroys history
git commit --no-verify    # Bypasses quality gates
# Direct push to main     # All changes via PR
```

### Commit Format

```text
type(scope): subject

feat(posts): add thread reply validation
fix(agent-loop): handle timeout on CLI spawn
test(knowledge): add vector search edge cases
```

**Types:** `feat` `fix` `docs` `style` `refactor` `perf` `test` `chore`

### Git Hooks

| Hook | Checks | Target |
|------|--------|--------|
| Pre-commit | Lint, types, secret scan, format | < 5s |
| Pre-push | Full tests, `bun audit`, build | < 60s |

**If a hook fails:** Fix the problem. Never `--no-verify`.

---

## Branching

```text
main                         # Always deployable, protected
├── feat/123-description     # Features
├── fix/456-description      # Bug fixes
├── hotfix/789-description   # Urgent production fixes
└── chore/description        # Maintenance
```

**Flow:** Branch from main → Work → Rebase on main → PR → Squash merge → Delete branch

---

## Quality Gates

| Gate | Requirement | Enforced By |
|------|-------------|-------------|
| Tests | All pass | Pre-push, CI |
| Coverage | > 80% on modified code | CI |
| Lint | Zero errors | Pre-commit |
| Types | Zero errors, no `any` | Pre-commit |
| Security | No critical vulnerabilities | Pre-push |
| Review | 1+ approval | Branch protection |
| Secrets | None in code | Pre-commit |

---

## Definition of Done

### Code

- [ ] Tests written and passing (> 80% coverage)
- [ ] Lint and type check pass
- [ ] No `any`, no `@ts-ignore`, no TODOs without issues

### Security

- [ ] No secrets in code or logs
- [ ] Input validation implemented
- [ ] Error messages don't leak internals

### Review

- [ ] Self-reviewed
- [ ] Peer reviewed and approved
- [ ] All comments addressed

### Documentation

- [ ] Complex logic documented (WHY)
- [ ] ADR for architectural decisions

---

## Environments

| Environment | Data | Secrets |
|-------------|------|---------|
| Local | Fake/seeded | `.env.local` |
| Development | Synthetic | Dev secrets |
| Staging | Anonymized | Staging secrets |
| Production | Real | Production secrets |

**Rules:** Never use production secrets locally. Never use real user data in non-production.

---

## Error Handling

```typescript
// Custom errors with context
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, context);
  }
}

// Usage
throw new ValidationError("Invalid post data", { errors: validated.error.flatten() });

// Logging
logger.error({ error, context: { userId, action, threadId }, requestId }, "Failed");
```

**Never:** Generic errors, swallowed errors, exposed stack traces, logs without context.

---

## Releases

### Versioning (SemVer)

| Change | Version Bump |
|--------|--------------|
| Bug fixes, no API changes | PATCH (1.0.x) |
| New features, backward compatible | MINOR (1.x.0) |
| Breaking changes | MAJOR (x.0.0) |

### Release Checklist

- [ ] All tests pass
- [ ] No critical vulnerabilities
- [ ] CHANGELOG updated
- [ ] Version bumped
- [ ] Staging verified
- [ ] Rollback procedure documented

---

## Incident Response

| Severity | Definition | Response |
|----------|------------|----------|
| P0 | Service down, data breach | Immediate |
| P1 | Major feature broken | < 1 hour |
| P2 | Minor feature broken | < 4 hours |
| P3 | Cosmetic | Next sprint |

**Process:** Detect → Assess → Communicate → Contain → Fix → Verify → Post-mortem (48h)

**Security incidents:** Escalate immediately. Rotate all potentially affected secrets. Preserve logs.

---

## Technical Debt

When incurring debt:

1. Create issue with `tech-debt` label
2. Document WHY it was necessary
3. Define the ideal solution
4. Set timeline for remediation

**Never:** Let debt compound silently or pretend it doesn't exist.

---

## Breaking Changes

1. Deprecation warning in release N
2. Migration guide documented
3. MAJOR version bump in release N+1
4. Minimum 2 minor versions before removal

---

## Summary

```text
TDD          → Red-Green-Refactor-Commit, every time
Security     → Built in, not bolted on
Review       → Every change, no exceptions
Quality      → Non-negotiable gates
Honesty      → Acknowledge debt, fix mistakes
```

Do it right. Not perfect—*right*.
