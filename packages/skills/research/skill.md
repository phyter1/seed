---
name: research
description: Research a topic using web search, then optionally summarize with a local model. Save findings to notes/.
category: identity
invocable: false
argument-hint: <topic> [--local] [--save]
capabilities:
  - shell
  - read-files
  - write-files
  - web-fetch
  - web-search
---

# Research

Deep research on any topic. Combines web search with optional local model summarization for $0 analysis.

## Arguments

- `<topic>` — what to research
- `--local` — after gathering sources, send to a local fleet model for summarization/analysis
- `--save` — save the research output to `notes/inbox/` for future reference
- `--deep` — more thorough: 10+ sources, cross-reference findings, identify contradictions

## Execution

### Step 1: Web Research

Use WebSearch to find relevant sources. Strategy depends on topic type:

**Technical (library, API, framework):**
- Search for official docs
- Search for "best practices" / "production" / "gotchas"
- Search for recent issues/changelogs (last 6 months)

**Incident/Event:**
- Search for primary sources (official post-mortems, vendor statements)
- Search for independent analysis
- Search for related incidents (pattern matching)

**Conceptual/Opinion:**
- Search for strongest arguments on multiple sides
- Search for empirical evidence
- Search for expert commentary

### Step 2: Fetch and Extract

Use WebFetch on the most promising URLs. Extract:
- Key facts and claims
- Source credibility (official docs > blog posts > forum comments)
- Publication date (is this current?)
- Contradictions between sources

### Step 3: Synthesize

Combine findings into a structured summary:

```markdown
# Research: <topic>
Date: <ISO date>

## Key Findings
- [Bullet points of the most important facts]

## Sources
1. [Title](URL) — <one-line summary of what this source contributed>

## Analysis
[Your synthesis — what the findings mean, what's uncertain, what's missing]

## Open Questions
- [What couldn't be answered from available sources]
```

### Step 4: Local Model Analysis (if --local)

Send the synthesized research to a local fleet model for additional analysis:

```bash
# Probe for available endpoint
ENDPOINT=""
curl -s --connect-timeout 3 http://$MACHINE3:3000/health >/dev/null 2>&1 && ENDPOINT="http://$MACHINE3:3000/v1/chat/completions"
[ -z "$ENDPOINT" ] && curl -s --connect-timeout 3 http://$MACHINE3:8080/v1/models >/dev/null 2>&1 && ENDPOINT="http://$MACHINE3:8080/v1/chat/completions"
[ -z "$ENDPOINT" ] && curl -s --connect-timeout 3 http://$MACHINE2:11434/api/tags >/dev/null 2>&1 && ENDPOINT="ollama://$MACHINE2:11434"

# Send to local model for analysis
curl -s "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mlx-community/Qwen3.5-9B-MLX-4bit",
    "messages": [
      {"role": "system", "content": "You are a research analyst. Analyze the following research findings. Identify patterns, contradictions, and implications the researcher may have missed."},
      {"role": "user", "content": "<synthesized research>"}
    ],
    "temperature": 0.7,
    "max_tokens": 2048
  }'
```

Append the local model's analysis as a `## Local Model Analysis` section.

### Step 5: Save (if --save)

```bash
SLUG=$(echo "<topic>" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g')
cp research-output.md notes/inbox/research-$SLUG-$(date +%Y%m%d).md
```

The note will be picked up at next boot when `notes/inbox/` is checked.

## Cost

- Web research: $0 (built into Claude Code)
- Local model analysis: $0 (fleet inference)
- Total: $0 for the full pipeline
