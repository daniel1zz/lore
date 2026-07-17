# Git Workflow Mode: Branch

> Branching strategies, naming conventions, and branch lifecycle management.

## Scope

```yaml
scope:
  - Branch creation with proper naming
  - Branching strategy detection and guidance
  - Branch cleanup and lifecycle
  - Protected branch awareness

outputs:
  - Properly named branch
  - Strategy-aligned branch workflow
```

## Branching Strategies

```yaml
strategies:
  github_flow:
    description: "Simple: main + feature branches"
    best_for: "Small teams, continuous deployment"
    branches:
      - main: "Always deployable"
      - "feature/*": "Short-lived feature branches"
    workflow:
      1. Create feature branch from main
      2. Develop and commit
      3. Open PR to main
      4. Review and merge
      5. Deploy from main

  gitflow:
    description: "Structured: main + develop + feature/release/hotfix"
    best_for: "Scheduled releases, larger teams"
    branches:
      - main: "Production releases only"
      - develop: "Integration branch"
      - "feature/*": "New features (from develop)"
      - "release/*": "Release preparation (from develop)"
      - "hotfix/*": "Production fixes (from main)"
    workflow:
      feature: "develop → feature/* → develop"
      release: "develop → release/* → main + develop"
      hotfix: "main → hotfix/* → main + develop"

  trunk_based:
    description: "Everyone commits to main with feature flags"
    best_for: "Experienced teams, CI/CD mature"
    branches:
      - main: "Single source of truth"
      - "short-lived/*": "< 2 days, optional"
    workflow:
      1. Commit directly to main (or very short branch)
      2. Use feature flags for incomplete work
      3. Deploy continuously
```

## Branch Naming Conventions

```yaml
format: "<type>/<ticket>-<short-description>"

types:
  feature: "New functionality"
  fix: "Bug fixes"
  hotfix: "Urgent production fixes"
  refactor: "Code restructuring"
  docs: "Documentation changes"
  test: "Test additions/changes"
  chore: "Maintenance tasks"

examples:
  - "feature/AUTH-123-add-oauth-login"
  - "fix/BUG-456-null-pointer-payment"
  - "hotfix/PROD-789-memory-leak"
  - "refactor/TECH-101-extract-auth-service"
  - "docs/DOC-202-api-reference"

rules:
  - Lowercase only
  - Hyphens for word separation (no underscores, no spaces)
  - Include ticket number if available
  - Keep description short (3-5 words)
  - No special characters
```

## Workflow

### 1. Detect Current Strategy

```yaml
actions:
  - List all branches: "git branch -a"
  - Check for develop branch → likely gitflow
  - Check for release/* branches → likely gitflow
  - Only main + feature branches → likely github flow
  - Check branch protection rules if accessible
  - Read CONTRIBUTING.md for documented strategy
```

### 2. Create Branch

```yaml
actions:
  - Determine base branch (main/develop) based on strategy
  - Ensure base is up to date: "git fetch origin && git checkout <base> && git pull"
  - Generate branch name following conventions
  - Create and switch: "git checkout -b <branch-name>"
  - Push with tracking: "git push -u origin <branch-name>"

safety:
  - NEVER branch from a stale base
  - ALWAYS fetch before branching
  - Verify you're on the correct base branch
```

### 3. Branch Lifecycle

```yaml
maintenance:
  keep_updated:
    - Regularly rebase/merge from base branch
    - "git fetch origin && git rebase origin/main" (for local branches)
    - "git merge origin/main" (for shared branches)

  cleanup:
    - Delete merged branches: "git branch -d <branch>"
    - Delete remote merged branches: "git push origin --delete <branch>"
    - List merged branches: "git branch --merged main"
    - NEVER delete unmerged branches without confirmation

  stale_detection:
    - Branches with no commits in 30+ days
    - "git for-each-ref --sort=-committerdate refs/heads/ --format='%(committerdate:short) %(refname:short)'"
```

## Protected Branch Rules

```yaml
awareness:
  - NEVER force-push to main/develop
  - NEVER commit directly to protected branches
  - Always use PR workflow for protected branches
  - Check branch protection before attempting push
```
