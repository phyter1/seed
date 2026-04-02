---
story_id: "STORY-XXXX"
epic_id: "EPIC-XXXX"
title: "[Story Title]"
status: draft
# status options: draft | ready | in_progress | done
priority: medium
# priority options: critical | high | medium | low
points: 0
# points: story point estimate (Fibonacci: 1, 2, 3, 5, 8, 13)
version: "1.0"
source_documents:
  - "[Path to parent Epic]"
  - "[Path to PRD or relevant section]"
  - "[Path to API Design, Data Model, or System Design if relevant]"
---

# STORY-XXXX: [Story Title]

> **Purpose:** A story is the smallest unit of implementable, testable, user-visible behavior. It has a clear entry state, a clear done state, and acceptance criteria that can be verified without ambiguity. Stories are written so that a developer can pick one up cold and know exactly what to build, test, and ship.

---

## Description

[Use ONE of the following formats depending on the story type.]

**User story format** (for user-facing behavior):

> As a **[user role — e.g., project owner, collaborator, admin]**,
> I want to **[goal — what they're trying to accomplish]**,
> so that **[benefit — the value or outcome they get]**.

---

**OR — Technical story format** (for infrastructure, refactoring, or internal capabilities):

> **[Story title as a task statement]**
> [2–4 sentences describing what needs to be built, why it's needed, and what system or capability it enables. Reference the epic or downstream story that depends on this.]

---

## Acceptance Criteria

[Numbered, verifiable criteria in Given/When/Then format. Each criterion must be binary — pass or fail. No judgment calls. An engineer and QA should read the same criterion and agree whether it passes without discussion.]

**1. [Criterion title — e.g., Successful invitation]**

```
Given [initial state or precondition]
When [action taken by user or system]
Then [expected outcome]
  And [additional expected outcome, if needed]
  And [additional expected outcome, if needed]
```

**2. [Criterion title — e.g., Invalid email address]**

```
Given [initial state]
When [action]
Then [expected outcome]
  And [additional outcome]
```

**3. [Criterion title — e.g., Rate limit enforcement]**

```
Given [state]
When [action]
Then [outcome]
```

**4. [Criterion title]**

```
Given [state]
When [action]
Then [outcome]
```

*(Include all meaningful scenarios — happy path, validation failures, edge cases, permission boundaries. If you are uncertain whether a scenario belongs here or in another story, resolve it before the story is marked Ready.)*

---

## Technical Notes

[Implementation guidance for the developer. Relevant files, patterns, approaches, and gotchas. This is not a spec — use engineering judgment — but it surfaces everything the developer needs to know that isn't obvious from the acceptance criteria.]

**Relevant files:**
- `[path/to/file.ts]` — [What this file does and how it relates to this story]
- `[path/to/file.ts]` — [What this file does]

**Patterns to follow:**
- [Pattern 1 — e.g., "Input validation: use the Zod schema pattern from `src/api/schemas/`. See `src/api/schemas/projectSchema.ts` for example."]
- [Pattern 2 — e.g., "Service calls: handler → service → repository. Do not call the DB directly from a handler."]
- [Pattern 3 — e.g., "Error handling: throw typed errors from the service layer (`ValidationError`, `NotFoundError`). Handler middleware converts them to response format."]

**Data model:**
- [e.g., "Creates a row in `project_invitations`. See Data Model doc for full schema."]
- [e.g., "The `expires_at` field is computed as `now() + 7 days`. Store as `timestamptz`."]

**API contract:**
- [e.g., "Endpoint: `POST /projects/:id/invitations`. See API Design doc §4.X."]
- [e.g., "Response: 201 with the created invitation object. 409 if already invited."]

**Non-obvious behavior:**
- [e.g., "Inviting an email with a pending (not yet accepted) invitation should return 409, not send a second email."]
- [e.g., "Inviting yourself (same email as project owner) should return 400."]

---

## Test Requirements

[Specify what tests are required for this story. These are not optional — a story is not Done without them. Be specific about what each test covers.]

### Unit Tests

- [ ] [Test — e.g., "`InvitationService.createInvitation()` — creates invitation with correct token and expiry"]
- [ ] [Test — e.g., "`InvitationService.createInvitation()` — throws `ConflictError` if pending invitation already exists"]
- [ ] [Test — e.g., "`InvitationService.createInvitation()` — throws `ValidationError` if invitee email equals owner email"]
- [ ] [Test — e.g., "Invitation schema validation — rejects missing email, invalid email format"]

### Integration Tests

- [ ] [Test — e.g., "`POST /projects/:id/invitations` — 201 with invitation object when valid email and authorized owner"]
- [ ] [Test — e.g., "`POST /projects/:id/invitations` — 401 when unauthenticated"]
- [ ] [Test — e.g., "`POST /projects/:id/invitations` — 403 when authenticated but not the project owner"]
- [ ] [Test — e.g., "`POST /projects/:id/invitations` — 409 when invitation already exists for that email"]
- [ ] [Test — e.g., "`POST /projects/:id/invitations` — enqueues email job in background queue"]

### E2E Tests (if applicable)

- [ ] [Test — e.g., "User can invite a collaborator, collaborator receives email, accepts, and appears in project member list"]

---

## Dependencies

[What must exist or be done before this story can be started or completed.]

| Dependency | Type | Notes |
|-----------|------|-------|
| [STORY-XXXX: Title] | Story | [Why this story depends on it] |
| [EPIC-XXXX complete] | Epic | [Why] |
| [API endpoint: `GET /projects/:id`] | API | [Required to validate project existence in handler] |
| [Database: `project_invitations` table] | Schema | [Migration must be applied before this story can run] |
| [Email service configured] | Infrastructure | [Required for invitation email delivery in integration tests] |

---

## Definition of Done

[This story is complete when ALL of the following are true. No exceptions.]

- [ ] All acceptance criteria pass — manually verified in local or staging environment
- [ ] All required unit tests written and passing in CI
- [ ] All required integration tests written and passing in CI
- [ ] E2E test written and passing (if applicable for this story)
- [ ] Unit test coverage > 80% for all new code in this story
- [ ] No TypeScript errors and no lint warnings
- [ ] No `TODO` or `FIXME` comments left in story code
- [ ] Code reviewed and approved by at least one other engineer
- [ ] API documentation updated (if this story adds or changes an endpoint)
- [ ] Deployed to staging and acceptance criteria manually verified in staging

---

## Out of Scope

[What this story explicitly does NOT cover. These are guardrails for the developer — if you think of something not listed above, it probably belongs here or in another story.]

- [Item 1 — e.g., "The invitation email template design — handled in STORY-XXXX"]
- [Item 2 — e.g., "Collaborator permissions enforcement — handled in STORY-XXXX"]
- [Item 3 — e.g., "Resend invitation functionality — tracked in STORY-XXXX, deferred to Phase 2"]
- [Item 4 — e.g., "Inviting users not yet registered — not in scope for this epic"]

---

### Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0 | YYYY-MM-DD | | Initial draft |
