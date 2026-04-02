---
name: release
description: Manage releases including preparation, deployment, rollback, and environment promotion. Use this skill when preparing releases, deploying to environments, rolling back deployments, or checking DORA metrics.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch, Task
argument-hint: [action: prepare|deploy|rollback|status|promote|hotfix|metrics]
user-invocable: true
---

# Release Management

**Input**: `$ARGUMENTS` (action and parameters)
**Output**: Release artifacts, deployment status, or metrics

## Actions

| Action | Description | Example |
|--------|-------------|---------|
| `prepare` | Prepare new release | `/release prepare v1.2.0` |
| `deploy` | Deploy to environment | `/release deploy staging` |
| `rollback` | Rollback deployment | `/release rollback production` |
| `status` | Check deployment status | `/release status` |
| `promote` | Promote to next environment | `/release promote staging` |
| `hotfix` | Start hotfix procedure | `/release hotfix "fix bug"` |
| `metrics` | Show DORA metrics | `/release metrics` |

## Action: prepare

1. Determine version bump from commits (major/minor/patch)
2. Generate changelog from conventional commits
3. Update version in package.json/pyproject.toml/Cargo.toml
4. Create release branch (if using release trains)
5. Generate release notes
6. Output release checklist

## Action: deploy

1. Validate environment target (staging/production)
2. Run pre-deployment checks
3. Execute deployment pipeline
4. Run post-deployment verification
5. Update deployment status

## Action: rollback

1. Identify previous stable version
2. Validate rollback target
3. Execute rollback
4. Verify rollback success
5. Create incident ticket if needed

## Action: status

Show deployment status across all environments:
- Current version per environment
- Last deployment time
- Health status
- Active feature flags

## Action: promote

1. Validate source environment health
2. Run promotion checks
3. Deploy to next environment
4. Run smoke tests
5. Update status

## Action: hotfix

1. Create hotfix branch from production
2. Cherry-pick or implement fix
3. Fast-track through testing
4. Deploy to production
5. Backport to main branch

## Action: metrics

Display DORA metrics:
- **Deployment Frequency**: How often code is deployed
- **Lead Time**: Time from commit to production
- **MTTR**: Mean time to recovery
- **Change Failure Rate**: Percentage of failed deployments

## Environment Promotion Path

```
Development → Staging → Canary → Production
```

## Release Checklist

- [ ] All tests passing
- [ ] Changelog generated
- [ ] Version bumped
- [ ] Release notes drafted
- [ ] Security scan passed
- [ ] Performance baseline met
- [ ] Rollback plan documented

---

**Begin release action. Parse the action argument and execute.**
