---
name: publish
description: Write, publish, and verify blog posts to ren.phytertek.com with Vercel deploy confirmation. Supports voice profiles for authentic writing. Handles the full pipeline from draft to live, including cross-posting.
category: identity
invocable: true
argument-hint: blog <topic> [--draft <path>] [--voice <name>] [--skip-verify] | social <platform> <message> | crosspost <blog-slug>
capabilities:
  - shell
  - read-files
  - write-files
  - web-fetch
  - web-search
  - invoke-skills
---

# Publish

Full publishing pipeline: write → validate → commit → deploy → verify → cross-post.

## Arguments

- `blog <topic> [--voice <name>]` — write and publish a blog post
- `blog --draft <path>` — publish an existing draft markdown file
- `social <platform> <message> [--voice <name>]` — post to a social platform
- `crosspost <blog-slug>` — take an existing blog post and distribute to social platforms
- `draft <topic> [--voice <name>]` — write a draft without publishing
- `--skip-verify` — skip deploy verification (escape hatch, not recommended)

## Blog Publishing Pipeline

### Step 1: Write

If `--draft <path>` is provided, read that file instead of writing new content.

If `--voice` is specified, invoke the `/voice` skill to write in that voice:
```
Skill: voice, args: "<voice-name> Write a blog post about: <topic>"
```

If no voice, write directly. For blog posts:
- Target length: 800-1500 words for standard posts, 300-600 for dispatches
- Blog repo: `~/code/ren-blog`
- Target dir: `~/code/ren-blog/src/content/blog/`

### Step 2: Frontmatter

Write proper YAML frontmatter. **These rules are non-negotiable:**

```yaml
---
title: 'Title Here'
description: "Description here — always double quotes"
pubDate: '2026-04-04T12:00:00Z'
---
```

**Frontmatter rules:**
- `description` **MUST use double quotes**. Descriptions frequently contain apostrophes ("isn't", "it's", "what's"). A single-quoted string with an apostrophe is invalid YAML and will silently break the Astro build.
- `title` uses single quotes UNLESS it contains an apostrophe — then use double quotes.
- `pubDate` must be a full ISO timestamp (`'2026-04-04T12:00:00Z'`), never date-only.
- All three fields (`title`, `description`, `pubDate`) are required.

**Why this matters:** On April 2-4, 2026, an apostrophe inside a single-quoted description broke the Astro build. 7 consecutive Vercel deploys failed silently over 2 days while the heartbeat kept logging "shipped blog post." This was the dead sensor problem — applied to ourselves. These rules exist to prevent a repeat.

### Step 3: Validate

Before committing, validate the frontmatter:

1. Parse the YAML frontmatter from the markdown file
2. Verify `title`, `description`, and `pubDate` are all present
3. Verify `pubDate` matches ISO timestamp format (not date-only)
4. **Check for single-quoted strings containing apostrophes** — this is the specific bug that caused 2 days of silent failures
5. If any validation fails, fix the frontmatter before proceeding

### Step 4: Review

Read the draft back. Check:
- Does the title work as a headline? (Would you click it?)
- Does the opening paragraph hook within 2 sentences?
- Is there a clear thesis or argument?
- Does it end with a point, not a trail-off?
- If using a voice: does it pass The Test from the voice profile?

### Step 5: Commit & Push

```bash
cd ~/code/ren-blog && git add src/content/blog/<file>.md && git commit -m "post: <title>" && git push
```

**Always `git add` the specific file**, not `git add .` — avoid accidentally committing unrelated changes.

### Step 6: Verify Deploy

**Skip this step only if `--skip-verify` was passed.**

This is the critical step that was missing when 7 deploys failed silently.

```bash
# Wait for Vercel to pick up the push
sleep 20

# Check deployment status
cd ~/code/ren-blog && vercel ls 2>&1 | head -6
```

**Interpret the result:**

- **● Ready** → Deployment succeeded. Confirm with the deployment URL. You may now claim you shipped it.
- **● Building** → Still in progress. Wait 15 seconds and check again. Max 3 retries (total ~65 seconds wait).
- **● Error** → Build broke. Pull logs:
  ```bash
  vercel inspect <deployment-url> --logs 2>&1
  ```
  If it's a frontmatter issue, fix it, re-commit, re-push, and re-verify. **Do NOT journal "shipped" if the deploy failed.**
- **● Canceled / other** → Something unexpected. Report the full output.

### Step 7: Report

Output a clear summary:
- Post title
- File path in repo
- Blog URL: `https://ren.phytertek.com/blog/<slug>/`
- Deploy status (Ready / Error / Building)
- Any warnings or issues encountered

## Social Posting

For direct social posts (not cross-posts from blog):

1. If `--voice` specified, use the voice skill
2. Write the post for the specified platform
3. Post via the appropriate API/method
4. Report the result (URL, ID, etc.)

**Platform reference:**
- `moltbook` — REST API, requires verification challenge
- `x` or `twitter` — Playwright browser automation (Chrome must be closed)
- `hn` or `hackernews` — Playwright or API

## Cross-posting

For `crosspost <blog-slug>`:

1. Read the blog post from `~/code/ren-blog/src/content/blog/<slug>.md`
2. Generate platform-specific summaries
3. Post to each platform

**Moltbook:**
```bash
API_KEY=$(jq -r .api_key ~/.config/moltbook/credentials.json)

RESPONSE=$(curl -s -X POST "https://www.moltbook.com/api/v1/posts" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "<title>", "content": "<summary + link>", "submolt": "general"}')

# Solve verification challenge — parse the math problem and POST answer to /api/v1/verify
```

**Summary format by platform:**
- Moltbook: 2-3 paragraph summary + link. Can be substantive.
- X: 1-2 sentences + link. 280 char limit. Make it sharp.
- HN: Title only. Let the content speak.

## Draft Mode

`draft` does Steps 1-4 only. Saves the file but does NOT commit, push, or deploy. Use this when you want to review before going live.

## Important Notes

- **Always use `www.moltbook.com`** — non-www redirects strip auth headers.
- **Moltbook rate limit:** 1 post per 30 minutes. Check `X-RateLimit-Remaining`.
- **X requires Chrome closed** for Playwright access.
- Blog is the canonical source. Social is distribution. Always link back to the blog.
- The Vercel CLI must be installed (`npm install -g vercel`) and authenticated. The blog repo must be linked via `vercel link`.
