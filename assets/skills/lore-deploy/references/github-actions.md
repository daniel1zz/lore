# GitHub Actions Quick Reference

## Action Versions (pin these)

| Action | Version |
|--------|---------|
| actions/checkout | v4 |
| actions/setup-node | v4 |
| actions/cache | v3 |
| actions/upload-artifact | v4 |
| actions/download-artifact | v4 |
| docker/setup-buildx-action | v3 |
| docker/login-action | v3 |
| docker/metadata-action | v5 |
| docker/build-push-action | v5 |
| aws-actions/configure-aws-credentials | v4 |
| codecov/codecov-action | v3 |
| softprops/action-gh-release | v1 |
| orhun/git-cliff-action | v2 |

## Project Conventions

### Docker Build+Push Pattern
```yaml
permissions: { contents: read, packages: write }
# login → metadata-action (tags: ref/branch, ref/pr, semver, sha) → build-push-action
# cache: type=gha, mode=max
# push only on non-PR: push: ${{ github.event_name != 'pull_request' }}
```

### OIDC for AWS
```yaml
permissions: { id-token: write, contents: read }
# role-to-assume: arn:aws:iam::<ACCOUNT>:role/GitHubActions
```

### Release via Tag Push
```yaml
on: push: tags: ['v*']
# Steps: checkout(fetch-depth:0) → build → npm publish (NODE_AUTH_TOKEN) → git-cliff changelog → gh-release
# prerelease: contains(github.ref, 'alpha') || contains(github.ref, 'beta')
```

### Reusable Workflow
```yaml
# Define: on.workflow_call with inputs + secrets
# Call: uses: ./.github/workflows/reusable-deploy.yml
```

### Composite Action
```yaml
# .github/actions/<name>/action.yml
# using: composite, steps must have shell: bash
```

## Key Patterns Cheatsheet

| Pattern | Syntax |
|---------|--------|
| Concurrency cancel | `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }` |
| Path filter | `on.push.paths: ['src/**']`, `paths-ignore: ['**.md']` |
| Job output | `echo "key=value" >> $GITHUB_OUTPUT` |
| Condition | `if: github.ref == 'refs/heads/main'` |
| Matrix exclude/include | `strategy.matrix.exclude` / `strategy.matrix.include` |
| Pin action to SHA | `uses: actions/checkout@<SHA>  # v4.1.1` |
| Secrets via env (not inline) | `env: { API_KEY: ${{ secrets.API_KEY }} }` |
| Timeout | `timeout-minutes: 30` (job) or per-step |
| Debug | `env: { ACTIONS_STEP_DEBUG: true }` |
