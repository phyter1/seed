---
epic_id: "EPIC-XXXX"
title: "[Epic Title]"
phase: "[Phase name — e.g., Phase 1: Auth, Phase 2: Core Domain]"
status: draft
# status options: draft | ready | in_progress | done
priority: medium
# priority options: critical | high | medium | low
complexity_estimate: M
# complexity options: S | M | L | XL
version: "1.0"
source_documents:
  - "[Path to PRD]"
  - "[Path to Implementation Plan]"
  - "[Path to relevant System Design or Architecture doc]"
---

# EPIC-XXXX: [Epic Title]

> **Purpose:** An epic defines a meaningful unit of user-facing value that spans multiple stories. It is the "why" and the "what" at a feature level — not the implementation detail. Every story in this epic should trace back to the business value and acceptance criteria here.

---

## Business Value

[Why does this epic matter? What user outcome does it enable? What business objective does it advance? Be specific — connect this work to a concrete user need or product goal from the PRD. If you cannot articulate the value clearly, the epic scope is wrong.]

**User outcome:** [e.g., "Users can collaborate on projects without emailing files back and forth."]

**Business objective:** [e.g., "Enable team use cases, expanding TAM beyond individual users."]

**Metric(s) this epic should move:**
- [Metric 1 — e.g., "Average collaborators per project > 2 within 30 days of launch"]
- [Metric 2 — e.g., "Team workspace creation rate > X per week"]

---

## Scope

### In Scope

[What is explicitly included in this epic. Be concrete — these are the boundaries engineers design to. Every item here should be traceable to an acceptance criterion.]

- [Item 1 — e.g., "Inviting a collaborator to a project by email"]
- [Item 2 — e.g., "Collaborator accepting or declining an invitation"]
- [Item 3 — e.g., "Collaborators can view and edit project content with the role assigned at invite"]
- [Item 4 — e.g., "Project owner can remove a collaborator"]
- [Item 5 — e.g., "Email notification to invitee when invited"]

### Out of Scope

[What is explicitly NOT included. These are deliberate decisions, not oversights. Out-of-scope items prevent scope creep and set clear expectations.]

- [Item 1 — e.g., "Granular per-resource permissions — all collaborators have project-level roles only"]
- [Item 2 — e.g., "Bulk invite by uploading a CSV of emails"]
- [Item 3 — e.g., "Real-time collaborative editing (tracked in EPIC-XXXX)"]
- [Item 4 — e.g., "SSO or directory-based provisioning"]

---

## Acceptance Criteria

[Numbered, testable criteria. Each criterion must be verifiable — either pass or fail, no grey area. These define when this epic is done. The QA engineer should be able to write a test for each one without asking for clarification.]

1. [Criterion — e.g., "A project owner can invite another registered user by email address, and the invitee receives an invitation email within 2 minutes."]
2. [Criterion — e.g., "An invited user can accept the invitation via a link in the email, after which they appear in the project's collaborator list with the assigned role."]
3. [Criterion — e.g., "An invited user can decline the invitation, after which no access is granted and the inviter sees the declined status."]
4. [Criterion — e.g., "A collaborator with 'viewer' role can view all project content but cannot create, edit, or delete anything."]
5. [Criterion — e.g., "A collaborator with 'editor' role can create, edit, and delete project content but cannot change project settings or manage collaborators."]
6. [Criterion — e.g., "A project owner can remove a collaborator at any time, immediately revoking their access."]
7. [Criterion — e.g., "Inviting an email that is not registered shows a clear error message and does not send an email."]
8. [Criterion — e.g., "An invitation link expires after 7 days. Clicking an expired link shows an appropriate error."]

---

## Dependencies

### Upstream (must be done before this epic can start)

| Dependency | Type | Notes |
|-----------|------|-------|
| [EPIC-XXXX: User Authentication] | Epic | Auth required — collaborator invite tied to verified user accounts |
| [Database: users table and projects table] | Infrastructure | Core entities must exist |
| [Email service integration] | Infrastructure | Invite email delivery depends on configured email provider |

### Downstream (blocked by this epic)

| Dependency | Type | Notes |
|-----------|------|-------|
| [EPIC-XXXX: Activity Feed] | Epic | Activity feed requires collaborator model to show per-user actions |
| [EPIC-XXXX: Billing Seats] | Epic | Billing per seat requires knowing who is a collaborator |

---

## Risks and Mitigations

| # | Risk | Probability | Impact | Mitigation |
|---|------|------------|--------|------------|
| R01 | [Risk — e.g., "Email deliverability issues delay invite reception"] | Med | High | [Mitigation — e.g., "Use reputable transactional email provider (Postmark). Monitor delivery rates. Provide resend invite button."] |
| R02 | [Risk] | [Prob] | [Impact] | [Mitigation] |
| R03 | [Risk] | [Prob] | [Impact] | [Mitigation] |

---

## Complexity Estimate

**Estimate:** [S / M / L / XL]

**Justification:**
[Explain why this complexity was chosen. Reference specific factors — number of stories, novel technical problems, dependencies, uncertainty, cross-cutting concerns. Be honest.]

**Size reference:**
- S = 1–3 stories, well-understood, low uncertainty
- M = 4–8 stories, moderate complexity, limited unknowns
- L = 9–15 stories, significant complexity or uncertainty
- XL = 15+ stories or major unknowns — consider splitting

---

## Stories

[List all story references that compose this epic. Stories are the implementation-level breakdown. Each story here maps to a STORY.md document.]

| Story ID | Title | Status | Points |
|----------|-------|--------|--------|
| [STORY-XXXX] | [e.g., Invite collaborator by email] | draft | [points] |
| [STORY-XXXX] | [e.g., Accept invitation via email link] | draft | [points] |
| [STORY-XXXX] | [e.g., Decline invitation] | draft | [points] |
| [STORY-XXXX] | [e.g., Collaborator permissions — viewer role] | draft | [points] |
| [STORY-XXXX] | [e.g., Collaborator permissions — editor role] | draft | [points] |
| [STORY-XXXX] | [e.g., Remove collaborator] | draft | [points] |
| [STORY-XXXX] | [e.g., Invitation expiry] | draft | [points] |
| [STORY-XXXX] | [e.g., API: Collaborators endpoint] | draft | [points] |

**Total estimate:** [Sum of story points]

---

## Technical Notes

[Implementation guidance for engineers picking up this epic. Relevant patterns to follow, files to be aware of, ADR references, non-obvious considerations. This is not the implementation spec — that's in the stories and context docs — but the epic-level context an engineer needs before diving in.]

- [Note 1 — e.g., "Collaboration permissions are enforced by a middleware applied to all project-scoped routes. See `src/middleware/projectAuth.ts`."]
- [Note 2 — e.g., "Invitations are stored in the `project_invitations` table (see Data Model). Do not store invitations in the sessions system."]
- [Note 3 — e.g., "The email service integration is in `src/services/email/`. Use the `sendInvitationEmail()` function — do not call the provider directly."]
- [Note 4 — e.g., "See ADR-0008 for the decision on invitation token format."]

---

### Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0 | YYYY-MM-DD | | Initial draft |
