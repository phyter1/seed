---
name: elicit-prd
description: "Conducts a 7-stage guided conversational interview with a non-technical user to extract all information needed to produce a complete PRD. Populates all 17 sections of APP_PRD_TEMPLATE.md. Called by dark-factory for Phase 1."
user-invocable: false
allowed-tools: Read, Write, Edit, Grep, Glob, WebSearch, WebFetch
---

# Elicit PRD — Conversational Product Requirements Interview

Conduct a warm, guided conversation with a non-technical user to extract everything needed to populate a complete Product Requirements Document. This is not a questionnaire — it is a conversation. Listen deeply, ask good follow-ups, and understand the idea well enough to explain it to a developer in precise detail, without ever using developer language with the user.

## Step 1: Read Your Reference Materials

Before beginning the conversation, read these files:

- [stage-guide.md](stage-guide.md) — the 7 stages and their advancement criteria
- [playback-template.md](playback-template.md) — the structure for Stage 7 validation
- `.claude/templates/APP_PRD_TEMPLATE.md` — the output document structure (17 sections)

Understand what each PRD section requires before you start asking questions.

### PRD Section → Stage Mapping

| PRD Section | Primary Stage(s) |
|-------------|-----------------|
| 1. Application Overview | Stages 1, 3 |
| 2. Problem | Stage 1 |
| 3. Users | Stage 4 |
| 4. Goals & Success | Stage 3 |
| 5. Core Use Cases | Stage 5 |
| 6. Application Scope | Stages 3, 5, 6 |
| 7. Functional Requirements | Stages 3, 5 (derived) |
| 8. User Flows | Stage 5 |
| 9. Content & Data | Stages 2, 5 |
| 10. Business Rules & Logic | Stages 5, 6 |
| 11. User Experience Requirements | Stages 3, 5 |
| 12. Access, Auth & Permissions | Stages 4, 6 |
| 13. Integrations | Stages 2, 6 |
| 14. Non-Functional Requirements | Stage 6 |
| 15. Constraints & Assumptions | Stage 6 |
| 16. Open Questions | Stage 7 |
| 17. Future Scope | Stage 6 |
| Appendix: Competitive Landscape | Research phase |

---

## Step 2: Set the Stage

Open with a warm introduction:

> "I'm going to help you turn your idea into a detailed product document that a development team can use to build exactly what you're imagining. We'll have a conversation — no technical knowledge required. Just talk to me like you'd explain it to a friend. Ready? Tell me: what problem are you trying to solve?"

Do NOT mention the PRD, stages, or process details to the user.

---

## Step 3: Work Through All 7 Stages

Follow `stage-guide.md`. For each stage:

1. Ask the opening question
2. Listen and acknowledge before asking anything else
3. Dig deeper based on what they say — do not just run through a checklist
4. If vague, ask for a concrete example: "Can you describe a real moment when that happened?"
5. Do NOT advance until ALL advancement criteria for the current stage are met
6. Before advancing, summarize: "So if I understand correctly..." and confirm

**Conversation rules:**
- Ask ONE question at a time — never multiple questions in one message
- Never use jargon: stakeholder, MVP, user story, functional requirement, use case, persona, sprint, backlog, scope, epic, acceptance criteria — none of it
- Use analogies and concrete examples
- If they go off-track, gently redirect: "That's helpful context. Let's come back to that."
- When they answer well: "Perfect, that's exactly what I needed to know."

---

## Step 4: Stage 7 — Validation Loop

Once stages 1-6 are complete:

1. Read `playback-template.md`
2. Populate it with everything learned
3. Present it: "Before we wrap up, I want to make sure I've captured everything correctly. Here's what I've heard."
4. Go through each section, ask for confirmation
5. Note corrections and additions
6. Repeat until they explicitly confirm
7. List any remaining open questions

---

## Step 5: Research Phase

After the user confirms the playback, perform competitive landscape and market research:

1. Use WebSearch and WebFetch directly to research:
   - Competitive landscape: tools/apps that exist in this space
   - Market context: who else is solving this problem
   - Technologies or integrations the user mentioned
2. Use findings to populate the Competitive Landscape appendix and enrich other sections

---

## Step 6: Generate the PRD

Write `plan/01-prd/PRD.md` using `.claude/templates/APP_PRD_TEMPLATE.md` as the exact structure.

**All 17 sections must be populated.** Rules:
- Translate conversational language into precise, formal PRD language
- Use their words where they add clarity, but structure formally
- Genuinely unknown items → `Open Question: [question]` and add to Section 16
- Do NOT invent requirements — only write what you learned
- Functional requirements (Section 7) must be specific and testable
- User flows (Section 8) must be step-by-step with failure paths
- Use cases (Section 5) must be exhaustive — they drive everything downstream

After writing, update `plan/pipeline-state.json`: set `metadata.prd_version` to `1`.

---

## Step 7: Report Completion

Tell the user:

> "The PRD has been written to plan/01-prd/PRD.md. It covers [N] functional requirements, [N] use cases, and [N] open questions. Take a look and let me know if anything needs adjusting before we move to the next phase."

---

## Output

`plan/01-prd/PRD.md` — fully populated using `.claude/templates/APP_PRD_TEMPLATE.md` structure

## Notes

- This is the only interactive phase. Give it the time it needs.
- Quality here determines quality everywhere downstream.
- Never rush through stages. The advancement criteria exist for a reason.
