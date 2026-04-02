# pr-review-respond

Automatically respond to PR review comments by implementing requested changes.

## Usage

```bash
# Respond to comments on specific PR
/pr-review-respond <pr-number>

# Auto-detect PR from current branch
/pr-review-respond
```

## What This Skill Does

1. Fetches all review comments from the PR
2. Analyzes each comment for requested changes
3. Implements the changes
4. Commits with reference to the review
5. Pushes updates to the PR branch
6. Replies to comments confirming fixes

## Instructions

When invoked:

### 1. Determine PR Number

If PR number not provided:
- Get current branch: `git rev-parse --abbrev-ref HEAD`
- Get PR for branch: `gh pr list --head {branch} --json number --jq '.[0].number'`
- If no PR found, error with helpful message

### 2. Fetch PR Details

Get PR information:
```bash
gh pr view {pr-number} --json number,title,headRefName,baseRefName
```

Ensure we're on the correct branch:
```bash
git checkout {headRefName}
git pull origin {headRefName}
```

### 3. Fetch Review Comments

Get all review comments on specific lines:
```bash
gh api repos/{owner}/{repo}/pulls/{pr-number}/comments
```

Parse JSON response for each comment:
- `id`: Comment ID for replying
- `path`: File path
- `line`: Line number (or `null` if general)
- `body`: Comment text
- `user.login`: Commenter username
- `created_at`: When comment was made

Filter out:
- Comments you've already replied to (check for replies)
- Outdated comments (optional - may still want to address)

### 4. Process Each Comment

For each unresolved comment:

**a) Understand the Request**
- Read the file at the comment location
- Read surrounding context (±10 lines)
- Parse what change is requested
- Determine if it's:
  - Code change (implementation needed)
  - Question (needs response, not code)
  - Suggestion (optional vs required)

**b) Implement Changes**
- For code changes:
  - Use Read tool to get current file content
  - Use Edit or Write tool to make changes
  - If complex, consider spawning a task-developer subagent
  - Test changes if tests exist (`bun test` or similar)

**c) Commit the Change**
- Create atomic commit per comment or group related changes
- Commit message format:
  ```
  fix: address PR review feedback - {short description}

  {detailed description of what was changed}

  Addresses review comment by @{username} on {file}:{line}
  PR: #{pr-number}
  ```

**d) Reply to Comment** (optional but recommended)
- Use GitHub API to reply:
  ```bash
  gh pr comment {pr-number} --body "✓ Fixed in commit {commit-hash}

  {description of what was done}"
  ```
  Or reply directly to review comment if API supports it

### 5. Push All Changes

After processing all comments:
```bash
git push origin {headRefName}
```

### 6. Report Summary

Output to user:
```
✓ Processed 4 review comments on PR #{pr-number}

Fixed:
  - @reviewer on src/app/page.tsx:42 - Updated error handling
  - @reviewer on src/lib/utils.ts:15 - Added type annotations

Responded (no code change):
  - @reviewer on README.md:10 - Explained design choice

Skipped:
  - @reviewer on test.ts:5 - Already addressed in previous commit

Pushed 2 commits to {branch}
All comments addressed!
```

## Guidelines

### When to Make Code Changes
- Clear requests: "Add error handling", "Fix typo", "Update logic"
- Style feedback: "Use const instead of let"
- Performance suggestions: "Cache this value"

### When to Just Respond
- Questions: "Why did you choose this approach?"
- Discussions: "Have you considered X?"
- Approvals: "LGTM"
- Already fixed: Check if change exists in recent commits

### Comment Prioritization
Process in this order:
1. Critical bugs or security issues
2. Blocking feedback (required for approval)
3. Style and conventions
4. Suggestions and nice-to-haves
5. Questions and discussions

### Commit Strategy
**Option A: One commit per comment** (atomic, easy to track)
```
fix: add error handling to login function (PR #4 review)
fix: update type annotations in utils (PR #4 review)
```

**Option B: Group related changes** (cleaner history)
```
fix: address PR #4 review feedback

- Add error handling to login function (@reviewer)
- Update type annotations in utils (@reviewer)
- Fix typo in README (@reviewer)
```

Choose based on:
- Number of comments (many = group, few = atomic)
- Relationship between changes (related = group)
- Project conventions

### Safety Checks
- Always run linter after changes: `bun lint` or `biome check`
- Run tests if they exist: `bun test`
- Don't push if tests fail - report to user
- Don't make changes that conflict with other pending changes

### Edge Cases

**Multiple comments on same line:**
- Address all together in one fix
- Mention all reviewers in commit message

**Conflicting feedback:**
- Report to user: "Conflicting feedback from @user1 and @user2"
- Ask user which approach to take

**Unclear requests:**
- Add comment asking for clarification
- Don't guess - better to ask

**Already fixed:**
- Check git log for recent related commits
- Reply to comment: "Already addressed in commit {hash}"

**Out of scope:**
- Large refactors or architectural changes
- Report to user: "This requires manual attention"

## Example Session

Input:
```bash
/pr-review-respond 4
```

Output:
```
Fetching PR #4 details...
  Title: Add user authentication
  Branch: issue-42-add-auth
  Base: main

Checking out branch...
✓ On branch issue-42-add-auth
✓ Up to date with origin

Fetching review comments...
Found 3 unresolved comments:

1. @reviewer on src/auth/login.ts:15
   "Add error handling for invalid credentials"

2. @reviewer on src/auth/middleware.ts:42
   "This could be simplified using optional chaining"

3. @reviewer on README.md:10
   "Should we document the JWT expiry time?"

Processing comments...

[1/3] Fixing src/auth/login.ts:15...
  Reading file...
  Adding error handling...
  ✓ Changed: Added try-catch with specific error types
  ✓ Committed: 8f3a21c

[2/3] Fixing src/auth/middleware.ts:42...
  Reading file...
  Simplifying with optional chaining...
  ✓ Changed: Replaced if-check with ?.
  ✓ Committed: 9a4b33d

[3/3] Responding to README.md:10...
  ✓ Added comment explaining JWT config

Running checks...
  ✓ Lint passed
  ✓ Tests passed (15/15)

Pushing changes...
  ✓ Pushed 2 commits to origin/issue-42-add-auth

Summary:
  Fixed: 2 comments
  Responded: 1 comment
  Commits: 8f3a21c, 9a4b33d

PR updated! View at: https://github.com/org/repo/pull/4
```

## Dependencies

- `gh` CLI (GitHub CLI) - for fetching PR and comments
- Git - for commits and pushing
- Read/Edit/Write tools - for code changes
- Bash tool - for git operations
- Optional: Task tool for complex changes (spawn task-developer subagent)

## Configuration

Optional environment variables:
- `PR_REVIEW_AUTO_PUSH`: Set to `false` to review changes before pushing
- `PR_REVIEW_AUTO_REPLY`: Set to `false` to skip comment replies
- `PR_REVIEW_GROUP_COMMITS`: Set to `true` to group all changes in one commit

## Integration with Pipeline

This skill fits in the pipeline as:
```
/process-issue → ... → /pr-create → /pr-review-respond → merge
                                    ↑
                                feedback loop
```

Can be:
- Invoked manually after PR review
- Triggered automatically on PR review event (future: webhook integration)
- Part of automated pipeline (check for comments periodically)

## Future Enhancements

- Auto-detect when review is complete and all comments addressed
- Integration with GitHub Actions (trigger on review)
- Batch mode: process multiple PRs
- Interactive mode: ask user before each change
- Smart grouping: automatically group related comments
- AI-powered understanding: better parsing of ambiguous feedback
