# Stage Guide — PRD Elicitation Conversation

This file defines the 7 stages of the elicitation conversation. Work through them in order. Do not advance to the next stage until all advancement criteria for the current stage are satisfied.

---

## Stage 1: Anchoring

**Goal:** Understand the core problem and who experiences it.

**Opening question:**
"What problem are you trying to solve?"

**Questions to explore:**
- What problem are you trying to solve?
- Who has this problem? Can you describe a real person — someone you know or can picture — who runs into this?
- What does their day look like when they hit this problem?
- Why does this matter to them? What's the impact?
- How often does this problem come up for them?

**Probing follow-ups:**
- "Can you give me a specific example of when this happened?"
- "What do they feel when they run into this? Frustrated? Embarrassed? Stuck?"
- "Is this a problem they're aware they have, or something they just put up with?"

**Advancement criteria (ALL must be satisfied before moving on):**
- [ ] The problem is clearly articulated as a problem — not a solution description ("I want an app that does X" is a solution; "people struggle to do X because of Y" is a problem)
- [ ] At least one concrete person or type of person has been described with enough specificity to understand their context
- [ ] The emotional or practical impact of the problem is understood — why it matters
- [ ] The "why" behind the problem is clear — what causes it to exist

---

## Stage 2: Current State

**Goal:** Understand what people do today without this app.

**Opening question:**
"What does this person do right now when they run into this problem? How do they handle it today?"

**Questions to explore:**
- What tools or workarounds do they use?
- What does that process look like step by step?
- What parts of it take too long, cost too much, or frustrate them the most?
- Have they tried other solutions — apps, services, anything? Why didn't those work?
- What would they have to give up or change if they started using your app instead?

**Probing follow-ups:**
- "Walk me through exactly what they do. Start from the moment they realize they have this problem."
- "What's the most annoying part of how they deal with it today?"
- "Is the current workaround expensive? Time-consuming? Embarrassing?"

**Advancement criteria (ALL must be satisfied before moving on):**
- [ ] The current workflow or workaround is described in enough detail to understand the steps
- [ ] The specific pain points in the current approach are identified — what's broken, slow, or wrong
- [ ] Any failed alternatives have been discussed (or it's confirmed they haven't tried anything)
- [ ] The gap between what exists today and what's needed is clearly understood

---

## Stage 3: Success Definition

**Goal:** Define what "working" looks like from the user's perspective.

**Opening question:**
"If this app existed and worked perfectly, what would be different for the people using it?"

**Questions to explore:**
- How would you know it's working? What changes in their day, their life, their work?
- What's the one thing this app absolutely must do — the thing without which it's not worth building?
- What would make you say "this was worth building"?
- A year after launch, if the app succeeded, what would people say about it?
- Is there a feeling you want people to have when they use it?

**Probing follow-ups:**
- "Can you put a number on it? Like, instead of taking 2 hours, it takes 10 minutes?"
- "What's the 'wow moment' — the first time someone uses it and realizes it's exactly what they needed?"
- "What's the difference between 'good enough' and 'amazing' for this?"

**Advancement criteria (ALL must be satisfied before moving on):**
- [ ] A clear success vision is articulated — what's different when this works
- [ ] At least 3 specific outcomes or changes are identified
- [ ] A distinction is emerging between what's essential and what's nice to have
- [ ] At least one measurable or observable success indicator has been discussed

---

## Stage 4: Users

**Goal:** Build behavioral understanding of all user types.

**Opening question:**
"Who are all the different people who would use this? Walk me through each type."

**Questions to explore (for each user type):**
- What's their main goal when they open the app?
- What are they trying to accomplish? What's at stake for them?
- How comfortable are they with technology in general?
- How would they find out about this app? Where do they spend their time?
- What does their first experience with it look like?
- Are there people who manage or set it up, as opposed to people who just use it day to day?
- Are there people who look at the results but don't create anything themselves?

**Probing follow-ups:**
- "Is there anyone who would interact with this who isn't a primary user? Like an admin, a manager, a reviewer?"
- "Do these different types of people ever interact with each other through the app?"
- "Would someone with no technical background be comfortable using this?"

**Advancement criteria (ALL must be satisfied before moving on):**
- [ ] All user types are identified — not just primary users, but admins, reviewers, or others
- [ ] For each user type: their primary goal, context, and comfort with technology is understood
- [ ] The user journey from discovery to regular use is outlined at a high level
- [ ] Relationships between user types (if any) are understood — who creates, who reviews, who manages

---

## Stage 5: Scenarios

**Goal:** Walk through real usage scenarios, including what goes wrong.

**Opening question:**
"Let's walk through exactly what happens when [primary user] opens the app for the first time. What do they see? What do they do?"

**Questions to explore:**
- Walk me through the first time someone uses it, step by step
- What's the most common thing they'd do on a typical day using this app?
- Walk me through [specific action the user mentioned] — what happens exactly?
- What happens when something goes wrong? No internet connection, wrong input, something breaks?
- What happens in unusual situations — the edge cases? Things that don't happen often but are really important when they do?
- What should the app do when the user makes a mistake?

**For each scenario:**
- Where are they? (At home, at work, on their phone, at a desk?)
- What triggered this? (A notification, a habit, a specific need?)
- What do they do first?
- What does the app do in response?
- What happens next?
- How does it end — what's the success state?

**Advancement criteria (ALL must be satisfied before moving on):**
- [ ] At least 3 detailed usage scenarios are documented with step-by-step walkthroughs
- [ ] The happy path for the primary use case is fully described
- [ ] At least 2 failure or edge case scenarios are discussed — what goes wrong and how it's handled
- [ ] The first-time user experience is specifically addressed — what onboarding looks like

---

## Stage 6: Constraints

**Goal:** Identify hard limits and non-negotiable requirements.

**Opening question:**
"Are there any hard constraints we need to design around from the start? Like timing, budget, legal requirements, or things the app absolutely can't do?"

**Questions to explore:**
- Is there a deadline? Does this need to launch by a specific date?
- Are there budget constraints that affect what can be built?
- Are there any legal or regulatory requirements? (Privacy laws, industry regulations, age restrictions, accessibility requirements, etc.)
- Are there things this app should absolutely NOT do — features or behaviors that are off-limits?
- Does this need to connect to any existing systems, tools, or services?
- Who else needs to approve decisions about this? Are there other people involved in this project?
- Are there any existing brand, design, or product standards it needs to match?

**Probing follow-ups:**
- "Does this involve any personal or sensitive information? (Health data, financial data, children's data?)"
- "Does this need to work in specific countries or languages?"
- "Is there an existing product or platform this needs to fit into?"

**Agent accessibility probing (ask these naturally as part of exploring constraints and integrations):**
- "Will other software or automated tools need to interact with this application — not just humans?"
- "Should this application be able to verify that the software connecting to it is legitimate and authorized?"
- "Does this application need to maintain detailed audit trails of automated actions for compliance or review?"
- "Are there different levels of trust for different automated systems connecting to this application?"

**Advancement criteria (ALL must be satisfied before moving on):**
- [ ] Timeline and budget constraints are documented, or it's confirmed there are none
- [ ] Legal and regulatory requirements are identified, or it's confirmed there are none
- [ ] Explicit non-goals are listed — things the app should not do
- [ ] Integration requirements are identified — other systems this connects to — or confirmed none
- [ ] Decision-makers and stakeholders are identified
- [ ] Whether the app needs to be accessible to automated software agents is documented — including verification, audit, and trust level needs

---

## Stage 7: Validation Loop

**Goal:** Play back everything, confirm accuracy, resolve open questions.

**Process:**
1. Tell the user you're going to summarize everything you've heard to make sure you've captured it correctly
2. Use `playback-template.md` to structure the summary, populated with everything from Stages 1–6
3. Present the full summary and ask: "Is this accurate? Let's go through it section by section."
4. For each section, ask: "Did I get this right? Is there anything missing or wrong?"
5. Note all corrections and additions
6. If corrections are significant, revise the summary and present again
7. Explicitly list all open questions that remain unresolved
8. Ask for explicit confirmation before proceeding

**Advancement criteria (ALL must be satisfied before moving on):**
- [ ] The full playback has been presented to the user
- [ ] The user has confirmed or corrected each major section
- [ ] All open questions are explicitly listed
- [ ] The user has given explicit confirmation that the summary is accurate — "yes, that captures it" or equivalent
