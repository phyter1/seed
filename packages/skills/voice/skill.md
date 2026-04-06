---
name: voice
description: Write content in a specific voice. Load a voice profile and generate text that sounds authentically like that person or persona.
category: identity
invocable: false
argument-hint: <voice-name> <what to write> | list | create <name>
capabilities:
  - shell
  - read-files
  - write-files
---

# Voice

Write content in a specific voice profile. Voice profiles are markdown files that define how someone writes — cadence, vocabulary, register, sign-offs, anti-patterns.

## Arguments

- `list` — show available voice profiles
- `create <name>` — create a new voice profile interactively
- `<voice-name> <what to write>` — write something in that voice

## Voice Profile Locations

Voice profiles are searched in order:
1. `voices/` in the current repo
2. `~/code/gmail-text-voice/` (Ryan's personal profiles)
3. `~/.claude/voices/` (global profiles)

A voice profile is any `.md` file with writing instructions. The file name (without extension) is the voice name.

## Execution

### list

```bash
echo "=== Local voices ===" && ls voices/*.md 2>/dev/null | sed 's|voices/||;s|\.md||'
echo "=== Personal voices ===" && ls ~/code/gmail-text-voice/VOICE_PROMPT.md 2>/dev/null && echo "  ryan"
echo "=== Global voices ===" && ls ~/.claude/voices/*.md 2>/dev/null | sed 's|.*/||;s|\.md||'
```

### create

Walk the user through building a voice profile:

1. **Who is this voice?** Name, context, relationship to the writing.
2. **Collect samples.** Ask for 3-5 writing samples from this person — emails, posts, messages. The more varied the better.
3. **Extract patterns.** Analyze the samples for:
   - Cadence (sentence rhythm, long vs short)
   - Vocabulary (formal vs casual, signature words)
   - Register (how they shift between contexts)
   - Openers and closers
   - Rhetorical habits (questions, lists, emphasis)
   - Anti-patterns (what they would NEVER say)
4. **Generate the profile.** Write a voice prompt following this structure:

```markdown
# <Name> — Voice Profile

## The Core
[1-2 sentences capturing the essence of how this person writes]

## How to Sound Like <Name>
[Specific patterns with YES/NO examples]

## Register Matching
[How the voice shifts by context: casual, professional, high-stakes]

## Vocabulary
[Word choices, formality level, signature phrases]

## What NOT to Do
[Anti-patterns — the things that would immediately sound wrong]

## Sign-Offs
[How they close messages in different contexts]

## The Test
Before delivering any writing as <Name>, ask: Would <Name> actually say this out loud?
```

5. Save to `voices/<name>.md` in the current repo, or `~/.claude/voices/<name>.md` for global.

### Write in a voice

1. **Load the profile.** Find the voice file matching `<voice-name>`. Read it fully.
2. **Understand the request.** What are they writing? Blog post, email, cover letter, social post, bio?
3. **Match register to context.** A tweet has different register than a cover letter, even in the same voice.
4. **Write the content.** Follow every instruction in the voice profile. The profile is law.
5. **Self-check.** Re-read what you wrote. Apply "The Test" from the profile. If any sentence sounds like generic AI output, rewrite it.
6. **Present the draft.** Show the full text. Offer to adjust tone, length, or register.

## Integration with /publish

When `/publish` specifies a voice, it invokes this skill to do the writing. The publish pipeline handles distribution; this skill handles the words.
