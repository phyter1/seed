# Application Product Requirements Document

> **Purpose:** This document defines *what* to build and *why* for a new application. It is technology-agnostic and implementation-agnostic. Downstream agents will make all decisions about architecture, stack, and implementation. Your job is to describe the product completely enough that nothing needs to be assumed or invented. Fill in every section. If something is unknown, say so explicitly.

---

## 1. Application Overview

**Application Name:**
**Author:**
**Date:**
**Version:**

### 1.1 Summary
In 2–3 sentences: what is this application, who is it for, and what core problem does it solve?

### 1.2 Vision
What does the world look like when this application exists and is being used successfully? What changes for the people using it?

### 1.3 Elevator Pitch
*"[App name] is a [app type] that helps [target user] [achieve outcome] by [core mechanism], unlike [current alternative]."*

### 1.4 Application Type
What kind of application is this? (e.g., consumer web app, internal business tool, marketplace, SaaS platform, mobile app, desktop utility, API-first service, etc.)

### 1.5 Deployment Context
Where and how will users access this? (e.g., browser, mobile device, desktop, embedded in another product) Is it used individually or collaboratively?

---

## 2. Problem

### 2.1 Problem Statement
What specific problem exists today that this application solves? Be concrete — describe the pain, not the solution.

### 2.2 Who Experiences This Problem
Who is the primary person affected? Describe them through their behaviors, context, and frustrations — not demographics.

### 2.3 How They Deal With It Today
What does the user do right now? (Manual workaround, competing product, cobbling together multiple tools, ignoring it entirely)

### 2.4 Why Existing Solutions Fall Short
What's wrong or missing with what they're doing today?

### 2.5 Why Now
What makes this the right moment to build this?

---

## 3. Users

### 3.1 Primary User
The main person this application is built for. Describe their goals, daily context, technical comfort level, and specific frustrations relevant to this problem.

### 3.2 Secondary Users
Other people who interact with the application in a supporting, administrative, or adjacent role. Describe each briefly.

### 3.3 User Needs
What does each user type fundamentally need from this application? Expressed as needs, not features.

**Primary user needs:**
- Need 1:
- Need 2:
- Need 3:

**Secondary user needs (if applicable):**
- Need 1:
- Need 2:

### 3.4 User Journey
Describe the lifecycle of a user's relationship with this application — from the moment they first hear about it to becoming a regular user. What are the key moments?

1. Discovery: How do they find out about it?
2. Onboarding: What does their first experience look like?
3. First value moment: When do they first get something meaningful out of it?
4. Regular use: What does their ongoing usage look like?
5. Expansion: How does their usage grow or deepen over time?

---

## 4. Goals & Success

### 4.1 Application Goals
What must this application achieve to be considered a success? Be specific.

- Goal 1:
- Goal 2:
- Goal 3:

### 4.2 Non-Goals
What is explicitly out of scope for this application? These are deliberate decisions, not oversights.

- Not doing:
- Not doing:
- Not doing:

### 4.3 Success Metrics
How will we measure whether this application is working?

| Metric | What It Measures | Target | Timeframe |
|--------|-----------------|--------|-----------|
| | | | |
| | | | |

---

## 5. Core Use Cases

The primary scenarios in which users interact with this application. Write these as narrative descriptions of real usage — not feature lists. These are the scenarios the entire application must be designed around.

### Use Case 1: [Descriptive Title]
**Who:** [User type]
**Context:** [Where are they, what triggered this, what are they trying to accomplish?]
**Walkthrough:** [Step-by-step narrative of what happens from the user's perspective]
**Success state:** [What's true when this goes well?]
**Failure state:** [What goes wrong, and what should happen?]

### Use Case 2: [Descriptive Title]
...

### Use Case 3: [Descriptive Title]
...

*(Include all primary use cases — these drive everything downstream)*

---

## 6. Application Scope

### 6.1 Core Capabilities
What are the fundamental things this application must be able to do? These are the capabilities without which the application doesn't exist.

- Capability 1:
- Capability 2:
- Capability 3:

### 6.2 Full Feature Set
All features the application must include at launch. Group by area.

#### [Feature Area 1]
- Feature:
- Feature:
- Feature:

#### [Feature Area 2]
- Feature:
- Feature:

*(Add as many areas as needed)*

### 6.3 MVP vs. Full Scope
If there's a phased approach, describe what the minimum viable product looks like versus the full vision.

**MVP — the smallest version that delivers real value:**
- Includes:
- Excludes:
- A user can do: [describe the core loop]

**Full scope — the complete application:**
- Additional capabilities beyond MVP:

---

## 7. Functional Requirements

Specific, testable statements of what the application must do. Use "must" for non-negotiable, "should" for strongly desired, "may" for optional.

### 7.1 [Functional Area]
- **FR-001:** The application must [requirement]
- **FR-002:** The application must [requirement]
- **FR-003:** The application should [requirement]

### 7.2 [Functional Area]
- **FR-004:** The application must [requirement]
- **FR-005:** The application must [requirement]

*(Group all requirements by functional area. Be exhaustive.)*

---

## 8. User Flows

Step-by-step descriptions of how users move through the application for every critical path. Include happy paths and failure paths. These define the behavioral contract of the application.

### Flow 1: [Name — e.g., "Account Creation"]
**Entry point:** [Where/how does this flow start?]

1. [What user does]
2. [What application shows/does]
3. [What user does next]
4. ...
5. [End state — what's true when complete]

**Failure paths:**
- If [X] happens: [what the application does]
- If [Y] happens: [what the application does]

### Flow 2: [Name — e.g., "Core Action Flow"]
...

### Flow 3: [Name]
...

*(Cover all critical paths — account creation, primary action, settings changes, deletion, error recovery, etc.)*

---

## 9. Content & Data

### 9.1 Data the Application Collects
Every piece of information the application needs to capture.

| Data | Why It's Needed | Source (user input / system generated / third party) |
|------|----------------|------------------------------------------------------|
| | | |

### 9.2 Data the Application Displays or Produces
What information does the application present to users, generate, or allow export of?

### 9.3 Data Relationships
How do the key entities in this application relate to each other? Describe in plain language.

Example: "A User can have many Projects. Each Project contains many Tasks. Tasks can be assigned to one User."

### 9.4 Data Lifecycle
How long is data retained? What happens when a user deletes something? Is anything recoverable?

### 9.5 Content & Copy
Any specific text, messaging, or media that is a defined part of the application experience — onboarding copy, empty states, error messages, email subjects, notification text, etc.

---

## 10. Business Rules & Logic

The rules that govern how the application behaves. Every "if this, then that" rule that isn't obvious from the features. Be exhaustive — agents will implement exactly what's written here and nothing more.

### 10.1 Access Rules
Who can do what, and under what conditions?

- **BR-001:** [e.g., "Only the creator of a project may delete it"]
- **BR-002:** [e.g., "Admin users can view all content regardless of ownership"]

### 10.2 Validation Rules
What inputs are valid or invalid, and what happens when invalid input is submitted?

- **BR-003:** [e.g., "Email addresses must be unique across all accounts"]
- **BR-004:** [e.g., "Passwords must be at least 8 characters"]

### 10.3 Limits & Thresholds
Caps, minimums, maximums, rate limits, quotas.

- **BR-005:** [e.g., "A free account may have no more than 3 active projects"]

### 10.4 Automation & Triggers
What happens automatically in response to events?

- **BR-006:** [e.g., "When a task is marked complete, the assigned user receives a notification"]

### 10.5 Calculations & Derived Values
Any values the application computes rather than stores directly.

- **BR-007:** [e.g., "Progress percentage is calculated as completed tasks / total tasks"]

---

## 11. User Experience Requirements

Defines the experience the product must deliver. Not visual design — the qualities, standards, and behaviors the experience must have.

### 11.1 Experience Principles
Non-negotiable qualities the experience must have.

- Principle 1: [e.g., "The application must never lose user input without warning"]
- Principle 2: [e.g., "Every action must have a visible, immediate result"]
- Principle 3: [e.g., "A new user must be able to complete the core action without instructions"]

### 11.2 Application Structure
What are the major sections or areas of the application? How are they organized? How does a user navigate between them?

Describe the full information architecture in plain language.

### 11.3 Key Screens & Views
Every distinct screen or view the application contains.

| Screen / View | Purpose | Primary Actions Available |
|---------------|---------|--------------------------|
| | | |
| | | |

### 11.4 Empty States
What does the application show when there's no content yet? (First-time use, no results, no data)

| Context | What the user sees / what they're prompted to do |
|---------|--------------------------------------------------|
| | |

### 11.5 Loading & Transition States
How does the application behave while data is loading or actions are processing?

### 11.6 Notifications & Communication
Every message the application sends to users — in-app, email, push, etc.

| Trigger | Message Purpose | Channel | Timing |
|---------|----------------|---------|--------|
| | | | |

---

## 12. Access, Auth & Permissions

### 12.1 Authentication
How do users prove who they are to access this application?

- Sign-up method(s): [e.g., email/password, social login, SSO, invite-only]
- Sign-in method(s):
- Account recovery:
- Session behavior: [e.g., how long before a user is logged out]

### 12.2 User Roles
If the application has different user types with different capabilities, define each.

| Role | Description | What They Can Do | What They Cannot Do |
|------|-------------|-----------------|---------------------|
| | | | |

### 12.3 Sharing & Collaboration
If users can share content or collaborate, describe how it works — what can be shared, with whom, and what level of access is granted.

---

## 13. Integrations

External systems, services, or data sources this application connects to. Described in terms of *what* needs to happen, not how.

### 13.1 Required Integrations
Integrations the application cannot function without.

| Service / System | What It's Needed For | What Data Flows In/Out |
|-----------------|---------------------|------------------------|
| | | |

*Note: If any consumers listed above are automated software agents or programmatic clients (not human users), describe them here. This informs downstream agent accessibility requirements.*

### 13.2 Optional Integrations
Integrations that enhance the application but aren't required for core function.

| Service / System | What It Enables | Priority |
|-----------------|----------------|---------|
| | | |

---

## 14. Non-Functional Requirements

How the application must perform and behave, independent of features.

### 14.1 Performance
- Acceptable load and response times from a user's perspective
- Volume of users and data the application must handle
- Behavior under high load
- Any offline or low-connectivity requirements

### 14.2 Reliability & Recovery
- Required uptime / availability
- What happens to users during downtime
- What data must never be lost under any circumstances
- Backup and recovery expectations

### 14.3 Security & Privacy
- What data is sensitive and requires protection
- Who must be prevented from seeing what
- Regulatory or compliance requirements (GDPR, HIPAA, SOC 2, COPPA, etc.)
- Audit logging requirements

### 14.4 Accessibility
- User groups that must be able to use this application, including people with disabilities
- Standards to meet (e.g., WCAG 2.1 AA)
- Any specific assistive technology support required

### 14.5 Localization & Internationalization
- Languages and locales the application must support
- Date, time, currency, and number format requirements
- Right-to-left language support (if applicable)

### 14.6 Scalability
- Expected user and data growth over time
- Any hard limits that must not be hit

### 14.7 Agent Accessibility
- Will automated software agents need to interact with this application?
- Should the application verify that connecting software is legitimate and authorized?
- Are detailed audit trails required for automated actions?
- Are there different levels of trust for different automated consumers?
- Any specific compliance requirements that mandate agent interaction logging?

*Note: Downstream pipeline phases will use these signals to determine the appropriate AAS (Agentic Accessibility Standard) conformance level. Non-technical users do not need to understand AAS — the pipeline handles this automatically.*

---

## 15. Constraints & Assumptions

### 15.1 Constraints
Hard limits that will shape what can be built.

- Timeline:
- Budget / resource:
- Legal / regulatory:
- Brand / consistency requirements (if this extends an existing product):
- Any third-party dependencies with their own constraints:

### 15.2 Assumptions
Things this document assumes to be true. If any of these are wrong, requirements may need to change.

- Assumption 1:
- Assumption 2:
- Assumption 3:

---

## 16. Open Questions

Everything that must be resolved before the application can be fully specified or built. Don't leave these implicit — surface them here.

| # | Question | Why It Matters | Owner | Status | Due |
|---|----------|---------------|-------|--------|-----|
| 1 | | | | Open | |
| 2 | | | | Open | |

---

## 17. Future Scope

Capabilities that are deliberately excluded from this version but should be tracked for future consideration.

| Idea | Why Deferred | Priority |
|------|-------------|---------|
| | | |

---

## Appendix

### Competitive Landscape
Applications or tools that currently exist in this space. What do they do well? What do they get wrong? What gap does this application fill?

| Competitor / Alternative | Strengths | Weaknesses | Our Differentiation |
|--------------------------|-----------|------------|---------------------|
| | | | |

### Glossary
Domain-specific terms used in this document.

| Term | Definition |
|------|------------|
| | |

### Reference Materials
Research, interviews, competitive analysis, sketches, prior work, or any other materials that informed this document.

- [Description + link]
- [Description + link]

### Change Log
| Version | Date | Author | Summary of Changes |
|---------|------|--------|--------------------|
| 1.0 | | | Initial draft |
