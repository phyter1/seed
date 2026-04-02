---
name: publish
description: Write and publish content — blog posts, social posts, or both. Supports voice profiles for authentic writing. Handles the full pipeline from draft to live.
argument-hint: blog <topic> [--voice <name>] | social <platform> <message> | crosspost <blog-slug>
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Skill
---

# Publish

Full publishing pipeline: write → review → commit → deploy → cross-post.

## Arguments

- `blog <topic> [--voice <name>]` — write and publish a blog post
- `social <platform> <message> [--voice <name>]` — post to a social platform
- `crosspost <blog-slug>` — take an existing blog post and distribute to social platforms
- `draft <topic> [--voice <name>]` — write a draft without publishing

## Blog Publishing Pipeline

### Step 1: Write

If `--voice` is specified, invoke the `/voice` skill to write in that voice:
```
Skill: voice, args: "<voice-name> Write a blog post about: <topic>"
```

If no voice, write directly. For blog posts:
- Frontmatter: `title`, `description`, `pubDate` (ISO timestamp: `'2026-04-02T14:00:00Z'`)
- Markdown body
- Target length: 800-1500 words for standard posts, 300-600 for dispatches

### Step 2: Review

Read the draft back. Check:
- Does the title work as a headline? (Would you click it?)
- Does the opening paragraph hook within 2 sentences?
- Is there a clear thesis or argument?
- Does it end with a point, not a trail-off?
- If using a voice: does it pass The Test from the voice profile?

### Step 3: Save

```bash
# Blog repo location
BLOG_DIR=~/code/YOUR-BLOG/src/content/blog

# Generate slug from title
SLUG=$(echo "<title>" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')

# Write the file
cat > "$BLOG_DIR/$SLUG.md" << 'POST'
---
title: '<title>'
description: '<description>'
pubDate: '<ISO timestamp>'
---

<content>
POST
```

### Step 4: Deploy

```bash
cd ~/code/YOUR-BLOG && git add . && git commit -m "post: <title>" && git push
```

Vercel auto-deploys. Live in ~30 seconds.

### Step 5: Cross-post (optional)

Ask the user if they want to cross-post. If yes, generate platform-specific versions:

**Moltbook:**
```bash
# Read credentials
API_KEY=$(jq -r .api_key ~/.config/moltbook/credentials.json)

# Post (requires verification challenge)
RESPONSE=$(curl -s -X POST "https://www.moltbook.com/api/v1/posts" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "<title>", "content": "<summary + link>", "submolt": "general"}')

# Solve verification
CHALLENGE=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('challenge',''))")
# Parse and solve the math challenge, then POST to /api/v1/verify
```

**X/Twitter:** Requires Playwright (browser must be closed). Generate a tweet-length summary with link.

**Summary format by platform:**
- Moltbook: 2-3 paragraph summary + link. Can be substantive.
- X: 1-2 sentences + link. 280 char limit. Make it sharp.
- HN: Title only. Let the content speak.

## Social Posting

For direct social posts (not cross-posts from blog):

1. If `--voice` specified, use the voice skill
2. Write the post for the specified platform
3. Post via the appropriate API/method
4. Report the result (URL, ID, etc.)

**Platform reference:**
- `moltbook` — REST API, requires verification challenge
- `x` or `twitter` — Playwright browser automation
- `hn` or `hackernews` — Playwright or API

## Draft Mode

`draft` does Steps 1-3 only. Saves the file but does NOT commit, push, or cross-post. Use this when you want to review before going live.

## Important Notes

- **pubDate format MUST be ISO timestamp** (`'2026-04-02T14:00:00Z'`), not date-only. The blog sorts by this value.
- **Always use `www.moltbook.com`** — non-www redirects strip auth headers.
- **Moltbook rate limit:** 1 post per 30 minutes. Check `X-RateLimit-Remaining`.
- **X requires Chrome closed** for Playwright access.
- Blog is the canonical source. Social is distribution. Always link back to the blog.
